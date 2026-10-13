/* Il suono del Drive. Per ogni canale, alla frequenza sovracampionata:
 *
 *   ingresso ─┬─ crossover LR4 ─ bassi ─────────────────────────────┐ (la parte pulita)
 *             │                  alti + bassi non puliti            │
 *             │                    → colore (enfasi) → drive → curva (+ bias, con antialiasing ADAA)
 *             │                    → via la continua → colore inverso → tono → auto gain ─┤
 *             └─ dry ────────────────────────────────────── mix ──────────────────────────┘ → uscita
 *
 * Tutto (anche il dry e i bassi puliti) passa per lo stesso sovracampionamento, quindi i rami
 * restano allineati al campione: il mix parallelo e il crossover non fanno filtri a pettine.
 * Il ciclo per campione è scritto per la velocità (filtri in linea, niente chiamate indirette):
 * gira 4 volte per campione e per canale. Gira nell'AudioWorklet; qui niente Web Audio, così si
 * prova anche in Node. */
import { dbToGain, type EffectCore } from '../../dsp/core';
import { Oversampler } from '../../dsp/oversampler';
import { OVERSAMPLING } from './drive';
import { autoGain, fastIntegral, MAX_BIAS, SHAPES, type Shape } from './drive-math';

/** Il Q di un Butterworth: due in fila fanno un Linkwitz-Riley (bassi + alti = suono intero). */
const BUTTERWORTH_Q = Math.SQRT1_2;
/** Il "Colore" inclina lo spettro attorno a questa frequenza, fino a ±COLOR_DB tra bassi e alti. */
const COLOR_HZ = 700, COLOR_DB = 9;
/** Il filtro che toglie la continua lasciata dalla curva asimmetrica. */
const DC_HZ = 8;
/** Tempo con cui i guadagni seguono le manopole. */
const SMOOTH = 0.02;
/** Dopo quanto silenzio in ingresso (secondi) il Drive smette di calcolare: le code dei filtri
 *  sono finite da un pezzo. Torna a lavorare al primo campione non nullo. */
const IDLE_AFTER = 0.5;
const ADAA_EPS = 1e-5;

/** Le primitive in tabella, fatte una volta per forma (servono a tutte le istanze). */
const INTEGRALS = new Map<string, (x: number) => number>();
const integralOf = (s: Shape) => {
  let F = INTEGRALS.get(s.id);
  if (!F) INTEGRALS.set(s.id, (F = fastIntegral(s)));
  return F;
};

/** Un filtro a variabili di stato (TPT) che dà passa-basso e passa-alto insieme. */
class Tpt {
  low = 0;
  high = 0;
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 1;
  private a2 = 0;
  private a3 = 0;
  private k = Math.SQRT2;

  set(cutoff: number, q: number, sampleRate: number): void {
    const g = Math.tan((Math.PI * Math.min(cutoff, sampleRate * 0.45)) / sampleRate);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  tick(v0: number): void {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.high = v0 - this.k * v1 - v2;
  }
}

/** I valori che scorrono senza scalini: dove sono e dove vanno. */
class Gains {
  constructor(
    public drive = 1,
    /** Compensazione del ramo distorto. */
    public wet = 1,
    public mix = 1,
    public output = 1,
    public clean = 0,
    public bias = 0,
  ) {}

  copy(): Gains {
    return new Gains(this.drive, this.wet, this.mix, this.output, this.clean, this.bias);
  }

  /** Un passo verso `target`, di una frazione `k`. */
  approach(target: Gains, k: number): void {
    this.drive += (target.drive - this.drive) * k;
    this.wet += (target.wet - this.wet) * k;
    this.mix += (target.mix - this.mix) * k;
    this.output += (target.output - this.output) * k;
    this.clean += (target.clean - this.clean) * k;
    this.bias += (target.bias - this.bias) * k;
  }
}

class Channel {
  readonly os: Oversampler;
  /** Il crossover: il primo filtro dà bassi e alti, il secondo li rende ripidi (LR4). */
  readonly split1 = new Tpt();
  readonly splitLow = new Tpt();
  readonly splitHigh = new Tpt();
  readonly tone = new Tpt();
  pre = 0;
  post = 0;
  dcX = 0;
  dcY = 0;
  /** Il campione prima della curva (per l'antialiasing). */
  u = 0;

  constructor(factor: 2 | 4 | 8) {
    this.os = new Oversampler(factor);
  }

  setFilters(split: number, tone: number, rate: number): void {
    for (const f of [this.split1, this.splitLow, this.splitHigh]) f.set(split, BUTTERWORTH_Q, rate);
    this.tone.set(tone, BUTTERWORTH_Q, rate);
  }
}

export class DriveCore implements EffectCore {
  private factor: 2 | 4 | 8 = 4;
  private channels: Channel[] = [];
  private shape: Shape = SHAPES[1];
  private readonly target = new Gains();
  private current: Gains | null = null;
  private colorHigh = 1;
  private split = 120;
  private tone = 16000;
  /** Campioni di silenzio in ingresso di fila. */
  private silent = 0;

  constructor(private readonly sampleRate: number) {
    this.build();
  }

  /** Ritardo dell'effetto in campioni (dal sovracampionamento). */
  get latency(): number {
    return this.channels[0].os.latency;
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    const factor = OVERSAMPLING[v('oversampling', 1)] ?? 4;
    const shape = v('shape', 1), drive = dbToGain(v('drive', 12)), bias = v('bias', 0) / 100;
    this.shape = SHAPES[shape] ?? SHAPES[1];
    const t = this.target;
    t.drive = drive;
    t.bias = bias;
    t.wet = v('auto', 1) ? autoGain({ shape, drive, bias }) : 1;
    t.mix = v('mix', 100) / 100;
    t.output = dbToGain(v('output', 0));
    t.clean = v('low', 50) / 100;
    this.colorHigh = Math.pow(10, (v('color', 0) / 100) * (COLOR_DB / 40));
    this.split = v('split', 120);
    this.tone = v('tone', 16000);
    if (factor !== this.factor) {
      this.factor = factor;
      this.build();
    }
    for (const c of this.channels) c.setFilters(this.split, this.tone, this.sampleRate * this.factor);
  }

  setTempo(): void {}

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    if (isSilent(inL, n) && isSilent(inR, n)) this.silent += n;
    else this.silent = 0;
    if (this.silent > IDLE_AFTER * this.sampleRate) {
      outL.fill(0, 0, n);
      outR.fill(0, 0, n);
      return;
    }
    const from = this.current ?? this.target.copy();
    const to = from.copy();
    to.approach(this.target, 1 - Math.exp(-n / (SMOOTH * this.sampleRate)));
    this.current = to;
    this.run(this.channels[0], inL, outL, n, from, to);
    this.run(this.channels[1], inR, outR, n, from, to);
  }

  private build(): void {
    this.channels = [new Channel(this.factor), new Channel(this.factor)];
    for (const c of this.channels) c.setFilters(this.split, this.tone, this.sampleRate * this.factor);
  }

  private run(ch: Channel, input: Float32Array, output: Float32Array, n: number, from: Gains, to: Gains): void {
    const up = ch.os.up(input, n), m = n * this.factor, rate = this.sampleRate * this.factor;
    const shape = this.shape, F = integralOf(shape);
    const preK = 1 - Math.exp((-2 * Math.PI * COLOR_HZ) / rate), dcR = Math.exp((-2 * Math.PI * DC_HZ) / rate);
    const gHigh = this.colorHigh, gLow = 1 / gHigh;
    // il bias cambia per blocchi (la sua continua la toglie il filtro): la curva in 0 una volta sola
    const b = to.bias * MAX_BIAS, f0 = shape.fn(b);
    // rampe lineari lungo il blocco: valore all'inizio e passo per campione
    let drive = from.drive, clean = from.clean, mix = from.mix, wetGain = from.wet, out = from.output;
    const dDrive = (to.drive - drive) / m, dClean = (to.clean - clean) / m, dMix = (to.mix - mix) / m;
    const dWet = (to.wet - wetGain) / m, dOut = (to.output - out) / m;
    const { split1, splitLow, splitHigh, tone } = ch;
    let { pre, post, dcX, dcY, u: uPrev } = ch;
    // la primitiva del campione prima, con la curva di adesso (la forma può essere appena cambiata)
    let fPrev = F(uPrev);
    for (let i = 0; i < m; i++) {
      drive += dDrive;
      clean += dClean;
      mix += dMix;
      wetGain += dWet;
      out += dOut;
      const x = up[i];
      split1.tick(x);
      splitLow.tick(split1.low);
      splitHigh.tick(split1.high);
      const low = splitLow.low, high = splitHigh.high;
      // colore: alti su e bassi giù (o il contrario) prima della curva…
      let d = high + low * (1 - clean);
      pre += preK * (d - pre);
      d = pre * gLow + (d - pre) * gHigh;
      // antialiasing: la pendenza media della curva tra il campione prima e questo
      const u = drive * d + b, fu = F(u), du = u - uPrev;
      const y = (du > ADAA_EPS || du < -ADAA_EPS ? (fu - fPrev) / du : shape.fn((u + uPrev) * 0.5)) - f0;
      uPrev = u;
      fPrev = fu;
      const dc = y - dcX + dcR * dcY;
      dcX = y;
      dcY = dc;
      // …e il contrario dopo: il timbro torna, la distorsione resta dove si è scelto
      post += preK * (dc - post);
      tone.tick(post * gHigh + (dc - post) * gLow);
      const wet = tone.low * wetGain + low * clean;
      up[i] = (x + (wet - x) * mix) * out;
    }
    ch.pre = pre;
    ch.post = post;
    ch.dcX = dcX;
    ch.dcY = Math.abs(dcY) < 1e-20 ? 0 : dcY;
    ch.u = uPrev;
    ch.os.down(up, output, n);
  }
}

const isSilent = (x: Float32Array, n: number): boolean => {
  for (let i = 0; i < n; i++) if (x[i] !== 0) return false;
  return true;
};
