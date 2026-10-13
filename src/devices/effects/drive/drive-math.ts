/* La matematica del Drive, comune al suono (drive-core.ts) e al disegno della curva nel pannello:
 * così la curva che si vede è esattamente quella che si sente. Funzioni pure.
 *
 * Ogni curva ha anche la sua primitiva (antiderivata) esatta: il motore la usa per l'antialiasing
 * "ADAA" — al posto di f(x) a ogni campione si prende la pendenza media della curva tra il
 * campione prima e questo, (F(x) − F(x₋₁)) / (x − x₋₁). Le armoniche altissime che la distorsione
 * crea si attenuano prima di ripiegarsi; insieme al sovracampionamento l'aliasing sparisce. */

export interface Shape {
  readonly id: string;
  readonly label: string;
  /** La curva: per segnali piccoli quasi una retta, poi satura. */
  readonly fn: (x: number) => number;
  /** La sua primitiva (F' = fn), per l'antialiasing. */
  readonly integral: (x: number) => number;
}

const LN2 = Math.LN2;
/** ln(cosh x) senza traboccare per x grandi. */
const logCosh = (x: number): number => {
  const a = Math.abs(x);
  return a + Math.log1p(Math.exp(-2 * a)) - LN2;
};

/** Il clip "duro": lineare fino a KNEE, poi un ginocchio corto fino a 1. */
const KNEE = 0.9, SOFT = 0.1;
const hard = (x: number): number => {
  const a = Math.abs(x);
  return a <= KNEE ? x : Math.sign(x) * (KNEE + SOFT * Math.tanh((a - KNEE) / SOFT));
};
const hardIntegral = (x: number): number => {
  const a = Math.abs(x);
  return a <= KNEE ? (a * a) / 2 : (KNEE * KNEE) / 2 + KNEE * (a - KNEE) + SOFT * SOFT * logCosh((a - KNEE) / SOFT);
};

/** La valvola: tanh più una parte pari (tanh²) che rende la curva asimmetrica. */
const TUBE_EVEN = 0.25;

/** Le curve, nell'ordine dei valori del parametro "Forma". */
export const SHAPES: readonly Shape[] = [
  // simmetrica: armoniche dispari, morbida
  { id: 'soft', label: 'Morbida', fn: x => Math.tanh(x), integral: logCosh },
  // asimmetrica: il lato positivo arriva più in alto, nascono le armoniche pari (calde)
  {
    id: 'tube', label: 'Valvola',
    fn: x => { const t = Math.tanh(x); return t + TUBE_EVEN * t * t; },
    integral: x => logCosh(x) + TUBE_EVEN * (x - Math.tanh(x)),
  },
  // ginocchio larghissimo: comprime piano, come il nastro
  { id: 'tape', label: 'Nastro', fn: x => x / Math.sqrt(1 + x * x), integral: x => Math.sqrt(1 + x * x) },
  { id: 'hard', label: 'Dura', fn: hard, integral: hardIntegral },
  // molto asimmetrica: il lato positivo urla, il negativo si schiaccia prima
  {
    id: 'fuzz', label: 'Fuzz',
    fn: x => (x >= 0 ? 1 - Math.exp(-2 * x) : -0.7 * (1 - Math.exp(1.4 * x))),
    integral: x => (x >= 0 ? x + (Math.exp(-2 * x) - 1) / 2 : -0.7 * x + 0.5 * (Math.exp(1.4 * x) - 1)),
  },
  // ripiegamento: oltre il massimo il suono torna indietro, armoniche ovunque
  { id: 'fold', label: 'Fold', fn: x => Math.sin(x), integral: x => 1 - Math.cos(x) },
];

/** La primitiva in tabella, per il motore: interpolazione cubica di Hermite che usa i valori di
 *  F e della sua pendenza esatta (la curva) a ogni nodo, quindi resta liscia e coerente con la
 *  curva anche sulle differenze minuscole dell'antialiasing; fuori dalla tabella la curva è
 *  ormai piatta e la primitiva prosegue in linea retta. Molto più veloce di log, exp e tanh. */
export class IntegralTable {
  private readonly F: Float64Array;
  private readonly f: Float64Array;
  private readonly step: number;
  private readonly last: number;

  constructor(shape: Shape, readonly range = 24, perUnit = 64) {
    const n = Math.round(2 * range * perUnit) + 1;
    this.step = 1 / perUnit;
    this.last = n - 1;
    this.F = Float64Array.from({ length: n }, (_, i) => shape.integral(-range + i * this.step));
    this.f = Float64Array.from({ length: n }, (_, i) => shape.fn(-range + i * this.step));
  }

  at(x: number): number {
    const { F, f, step, last, range } = this;
    const pos = (x + range) / step;
    if (pos <= 0) return F[0] + f[0] * (x + range);
    if (pos >= last) return F[last] + f[last] * (x - range);
    const i = pos | 0, t = pos - i, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * F[i] + (t3 - 2 * t2 + t) * step * f[i] + (-2 * t3 + 3 * t2) * F[i + 1] + (t3 - t2) * step * f[i + 1];
  }
}

/** Le forme che girano in tondo (il fold) non si possono mettere in una tabella finita. */
const PERIODIC = new Set(['fold']);

/** La primitiva più veloce per il motore: in tabella, o quella esatta per le forme periodiche. */
export const fastIntegral = (shape: Shape): ((x: number) => number) => {
  if (PERIODIC.has(shape.id)) return shape.integral;
  // il nastro si appiattisce piano: tabella più lunga
  const table = new IntegralTable(shape, shape.id === 'tape' ? 96 : 24);
  return x => table.at(x);
};

/** Sotto questa distanza tra due campioni la pendenza media è la curva nel punto di mezzo. */
const ADAA_EPS = 1e-5;

/** Un passo di antialiasing: il valore "medio" della curva tra `prev` e `x`. */
export function adaa(shape: Shape, x: number, prev: number, fPrev: number, fx: number): number {
  const d = x - prev;
  return Math.abs(d) > ADAA_EPS ? (fx - fPrev) / d : shape.fn((x + prev) / 2);
}

/** Lo spostamento massimo del bias (asimmetria), sul segnale già amplificato. */
export const MAX_BIAS = 0.5;

export interface DriveSettings {
  readonly shape: number;
  /** Guadagno prima della curva, lineare. */
  readonly drive: number;
  /** −1 … +1. */
  readonly bias: number;
}

/** La curva con drive e bias, senza scalino in continua: y(0) = 0. */
export function transfer(s: DriveSettings): (x: number) => number {
  const f = (SHAPES[s.shape] ?? SHAPES[0]).fn, b = s.bias * MAX_BIAS, g = s.drive, f0 = f(b);
  return x => f(g * x + b) - f0;
}

/** Livello di riferimento della compensazione: un seno a −6 dBFS esce allo stesso volume. */
const REF_AMPLITUDE = 0.5;
const REF_POINTS = 256;

/** Il guadagno che riporta un seno di riferimento al suo volume dopo la curva (RMS, senza la
 *  continua che il bias lascia). Alzare il drive cambia il colore, non (molto) il volume. */
export function autoGain(s: DriveSettings): number {
  const t = transfer(s);
  let sum = 0, sum2 = 0;
  for (let i = 0; i < REF_POINTS; i++) {
    const y = t(REF_AMPLITUDE * Math.sin((2 * Math.PI * (i + 0.5)) / REF_POINTS));
    sum += y;
    sum2 += y * y;
  }
  const mean = sum / REF_POINTS, rms = Math.sqrt(Math.max(1e-12, sum2 / REF_POINTS - mean * mean));
  return Math.max(0.05, Math.min(4, REF_AMPLITUDE / Math.SQRT2 / rms));
}
