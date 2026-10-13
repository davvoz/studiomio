/* Sovracampionamento per le non linearità (saturazione, distorsione): il suono passa a 2, 4 o 8
 * volte la frequenza di campionamento, si distorce lì, e torna giù filtrato. Le armoniche che la
 * distorsione crea sopra la metà della frequenza originale vengono tolte invece di ripiegarsi
 * (aliasing) in note stonate e sporche.
 *
 * Ogni raddoppio usa un filtro FIR "a mezza banda" a fase lineare (finestra di Kaiser): metà dei
 * coefficienti sono zero e il ramo dispari è solo il centro, quindi in forma polifase costa
 * metà di un FIR normale. Fase lineare = ritardo costante (`latency`), lo stesso per tutte le
 * frequenze: un segnale che passa su e giù senza modifiche esce identico, solo ritardato. */

/** Funzione di Bessel modificata I0 (serie), per la finestra di Kaiser. */
function besselI0(x: number): number {
  let sum = 1, term = 1;
  for (let k = 1; k < 40; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

/** I coefficienti pari di un filtro a mezza banda lungo `taps` (della forma 4K+3), con guadagno 1
 *  in continua; il centro (dispari) vale 0.5 e gli altri dispari 0. */
export function halfbandEvenTaps(taps: number, beta: number): Float64Array {
  if ((taps - 3) % 4 !== 0) throw new RangeError(`un filtro a mezza banda ha 4K+3 coefficienti, non ${taps}`);
  const c = (taps - 1) / 2, even = new Float64Array((taps + 1) / 2), i0 = besselI0(beta);
  let sum = 0;
  for (let k = 0; k < even.length; k++) {
    const i = 2 * k, t = (i - c) / 2;
    const window = besselI0(beta * Math.sqrt(Math.max(0, 1 - ((2 * i) / (taps - 1) - 1) ** 2))) / i0;
    even[k] = (Math.sin(Math.PI * t) / (Math.PI * t)) * 0.5 * window;
    sum += even[k];
  }
  // guadagno 1 in continua: i pari sommano a 0.5 (l'altro 0.5 è il centro)
  for (let k = 0; k < even.length; k++) even[k] *= 0.5 / sum;
  return even;
}

/** Un raddoppio: su (inserisce un campione ogni due e filtra) e giù (filtra e ne tiene uno ogni due). */
class HalfbandStage {
  private readonly taps: Float64Array;
  private readonly m: number;
  /** Ritardo del ramo dispari, in campioni della frequenza bassa: (taps − 3) / 4. */
  private readonly k: number;
  // storie doppie (ogni campione scritto due volte): la finestra si legge senza modulo
  private readonly upHist: Float64Array;
  private upPos = 0;
  private readonly evenHist: Float64Array;
  private readonly oddHist: Float64Array;
  private downPos = 0;

  constructor(taps: number, beta: number) {
    this.taps = halfbandEvenTaps(taps, beta);
    this.m = this.taps.length;
    this.k = (taps - 3) / 4;
    this.upHist = new Float64Array(2 * this.m);
    this.evenHist = new Float64Array(2 * this.m);
    this.oddHist = new Float64Array(2 * this.m);
  }

  /** Ritardo di un passaggio su e giù, in campioni della frequenza alta. */
  get delay(): number {
    return 2 * (2 * this.k + 1);
  }

  /** `n` campioni di `input` → 2n campioni in `out`. */
  up(input: Float32Array, out: Float32Array, n: number): void {
    const { taps, m, upHist: h } = this;
    let pos = this.upPos;
    for (let i = 0; i < n; i++) {
      pos = (pos === 0 ? m : pos) - 1;
      h[pos] = h[pos + m] = input[i];
      // h[pos + j] è x[n − j]
      let acc = 0;
      for (let j = 0; j < m; j++) acc += taps[j] * h[pos + j];
      out[2 * i] = 2 * acc;
      out[2 * i + 1] = h[pos + this.k];
    }
    this.upPos = pos;
  }

  /** 2n campioni di `input` → `n` campioni in `out`. */
  down(input: Float32Array, out: Float32Array, n: number): void {
    const { taps, m, evenHist: e, oddHist: o } = this;
    let pos = this.downPos;
    for (let i = 0; i < n; i++) {
      pos = (pos === 0 ? m : pos) - 1;
      e[pos] = e[pos + m] = input[2 * i];
      let acc = 0;
      for (let j = 0; j < m; j++) acc += taps[j] * e[pos + j];
      // il centro tocca il campione dispari di K + 1 coppie fa
      out[i] = acc + 0.5 * o[pos + this.k + 1];
      o[pos] = o[pos + m] = input[2 * i + 1];
    }
    this.downPos = pos;
  }
}

/** Coefficienti e forma della finestra per ogni stadio: il primo raddoppio (il più vicino alla
 *  frequenza originale) deve tagliare più netto, i seguenti lavorano su un suono già filtrato. */
const STAGES: readonly (readonly [taps: number, beta: number])[] = [[47, 8], [23, 7], [15, 6]];

/** Sovracampionamento di un canale per un fattore 1, 2, 4 o 8. */
export class Oversampler {
  readonly factor: number;
  private readonly stages: HalfbandStage[];
  /** I buffer di ogni livello (0 = frequenza originale). */
  private levels: Float32Array[] = [];

  constructor(factor: 1 | 2 | 4 | 8, block = 128) {
    this.factor = factor;
    this.stages = STAGES.slice(0, Math.log2(factor)).map(([t, b]) => new HalfbandStage(t, b));
    this.ensure(block);
  }

  /** Ritardo di un passaggio su e giù, in campioni della frequenza originale (può essere frazionario). */
  get latency(): number {
    return this.stages.reduce((sum, s, i) => sum + s.delay / 2 ** (i + 1), 0);
  }

  /** Porta su `n` campioni: restituisce il buffer alla frequenza alta (n × factor campioni,
   *  valido fino alla prossima chiamata). */
  up(input: Float32Array, n: number): Float32Array {
    this.ensure(n);
    if (!this.stages.length) {
      this.levels[0].set(input.subarray(0, n));
      return this.levels[0];
    }
    let src = input, len = n;
    this.stages.forEach((s, i) => {
      s.up(src, this.levels[i + 1], len);
      src = this.levels[i + 1];
      len *= 2;
    });
    return src;
  }

  /** Riporta giù `high` (n × factor campioni) in `out` (n campioni). */
  down(high: Float32Array, out: Float32Array, n: number): void {
    if (!this.stages.length) {
      out.set(high.subarray(0, n));
      return;
    }
    let src = high;
    for (let i = this.stages.length - 1; i >= 0; i--) {
      const len = n * 2 ** i, dst = i === 0 ? out : this.levels[i];
      this.stages[i].down(src, dst, len);
      src = dst;
    }
  }

  private ensure(n: number): void {
    if (this.levels[0]?.length >= n) return;
    this.levels = Array.from({ length: this.stages.length + 1 }, (_, i) => new Float32Array(n * 2 ** i));
  }
}
