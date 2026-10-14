/* Il suono della Multibanda. Per canale:
 *
 *   ingresso → crossover LR4 a xLow → basse ─ allpass a xHigh (per restare in fase) ─┐
 *                                  → resto → crossover LR4 a xHigh → medie ───────────┤ ognuna × il suo guadagno
 *                                                                  → alte ────────────┘ → somma → mix → uscita
 *
 * Il guadagno di ogni banda viene da un rilevatore di picco legato tra i canali: sopra la
 * soglia alta comprime verso il basso (rapporto forte), sotto quella bassa alza verso l'alto
 * (rapporto 4:1, fino a +18 dB, e niente sotto il pavimento: il rumore resta giù). Profondità
 * scala tutto; il guadagno si leviga in dB con attacco e rilascio. Con Profondità 0 e le bande
 * a 0 dB esce il suono intero (le tre bande risommate sono un allpass); il dry del mix è quella
 * stessa somma, così mescolando non nascono buchi attorno ai tagli. Gira nell'AudioWorklet;
 * qui niente Web Audio, così si prova anche in Node. */
import { dbToGain, type EffectCore } from '../../dsp/core';
import { Tpt } from '../../dsp/tpt';

const BUTTERWORTH_Q = Math.SQRT1_2;
/** Soglie (dBFS) e rapporti delle due compressioni, per banda (basse, medie, alte): quelle
 *  dell'OTT, più o meno. */
const DOWN_THRESHOLD = [-30, -30, -32];
const UP_THRESHOLD = [-40, -42, -41];
const DOWN_RATIO = 20, UP_RATIO = 4;
const MAX_UP = 18;
/** Sotto il pavimento non si alza nulla (in 10 dB la spinta verso l'alto si spegne). */
const FLOOR = -70;
/** Quanto tiene il picco il rilevatore di ogni banda (secondi): almeno qualche periodo, sennò
 *  ai passaggi per lo zero il livello crollerebbe e il guadagno tremerebbe a ogni ciclo. */
const PEAK_HOLD = [0.03, 0.01, 0.005];
/** Attacco e rilascio con Tempo a 0 e a 100 (secondi). */
const ATTACK = [0.0008, 0.03], RELEASE = [0.02, 0.5];
const SMOOTH = 0.02;
const LOG_TO_DB = 20 / Math.LN10;

/** Un crossover Linkwitz-Riley di quarto ordine: due Butterworth in fila. */
class Crossover {
  private readonly a = new Tpt();
  private readonly lo = new Tpt();
  private readonly hi = new Tpt();
  low = 0;
  high = 0;

  set(freq: number, sampleRate: number): void {
    for (const f of [this.a, this.lo, this.hi]) f.set(freq, BUTTERWORTH_Q, sampleRate);
  }

  tick(x: number): void {
    this.a.tick(x);
    this.lo.tick(this.a.low);
    this.hi.tick(this.a.high);
    this.low = this.lo.low;
    this.high = this.hi.high;
  }
}

/** Le tre bande di un canale. */
class Bands {
  private readonly first = new Crossover();
  private readonly second = new Crossover();
  /** L'allpass delle basse: lo stesso crossover del secondo taglio, risommato. */
  private readonly lowAllpass = new Crossover();
  readonly out = new Float64Array(3);

  set(xLow: number, xHigh: number, sampleRate: number): void {
    this.first.set(xLow, sampleRate);
    this.second.set(xHigh, sampleRate);
    this.lowAllpass.set(xHigh, sampleRate);
  }

  split(x: number): void {
    this.first.tick(x);
    this.second.tick(this.first.high);
    this.lowAllpass.tick(this.first.low);
    this.out[0] = this.lowAllpass.low + this.lowAllpass.high;
    this.out[1] = this.second.low;
    this.out[2] = this.second.high;
  }
}

export class MultibandCore implements EffectCore {
  private readonly left = new Bands();
  private readonly right = new Bands();
  /** Il guadagno attuale di ogni banda (dB) e quello delle manopole. */
  private readonly gainDb = new Float64Array(3);
  private readonly bandGain = new Float64Array(3);
  /** Il picco inseguito di ogni banda e quanto in fretta ricade. */
  private readonly peak = new Float64Array(3);
  private readonly peakK: number[];
  private depth = 0.5;
  private up = 1;
  private down = 1;
  private attackK = 0;
  private releaseK = 0;
  private input = 1;
  private output = 1;
  private mix = 1;
  private targetOutput = 1;
  private targetMix = 1;
  private readonly smoothK: number;
  private fresh = true;

  constructor(private readonly sampleRate: number) {
    this.smoothK = 1 - Math.exp(-1 / (SMOOTH * sampleRate));
    this.peakK = PEAK_HOLD.map(t => Math.exp(-1 / (t * sampleRate)));
    this.setParams({});
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    const t = v('time', 50) / 100;
    const between = ([a, b]: readonly number[]) => a * Math.pow(b / a, t);
    this.attackK = Math.exp(-1 / (between(ATTACK) * this.sampleRate));
    this.releaseK = Math.exp(-1 / (between(RELEASE) * this.sampleRate));
    this.depth = v('depth', 50) / 100;
    this.up = v('upward', 100) / 100;
    this.down = v('downward', 100) / 100;
    this.input = dbToGain(v('input', 0));
    ['low', 'mid', 'high'].forEach((id, b) => { this.bandGain[b] = dbToGain(v(id, 0)); });
    const xLow = v('xLow', 120), xHigh = Math.max(xLow * 2, v('xHigh', 2500));
    this.left.set(xLow, xHigh, this.sampleRate);
    this.right.set(xLow, xHigh, this.sampleRate);
    this.targetOutput = dbToGain(v('output', 0));
    this.targetMix = v('mix', 100) / 100;
    if (this.fresh) {
      this.output = this.targetOutput;
      this.mix = this.targetMix;
    }
  }

  setTempo(): void {}

  /** Il guadagno (dB) che la banda `b` vorrebbe per un livello `x` (dBFS). */
  private wanted(b: number, x: number): number {
    let g = 0;
    if (x > DOWN_THRESHOLD[b]) g -= (x - DOWN_THRESHOLD[b]) * (1 - 1 / DOWN_RATIO) * this.down;
    else if (x < UP_THRESHOLD[b] && x > FLOOR - 10) {
      const fade = x < FLOOR ? (x - (FLOOR - 10)) / 10 : 1;
      g += Math.min(MAX_UP, (UP_THRESHOLD[b] - x) * (1 - 1 / UP_RATIO)) * this.up * fade;
    }
    return g * this.depth;
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    this.fresh = false;
    const { left, right, gainDb, bandGain, attackK, releaseK, input, smoothK, peak, peakK } = this;
    const L = left.out, R = right.out;
    for (let i = 0; i < n; i++) {
      const xl = inL[i] * input, xr = inR[i] * input;
      left.split(xl);
      right.split(xr);
      let yl = 0, yr = 0;
      const dl = (L[0] + L[1] + L[2]) / input, dr = (R[0] + R[1] + R[2]) / input;
      for (let b = 0; b < 3; b++) {
        const level = Math.max(Math.abs(L[b]), Math.abs(R[b]), peak[b] * peakK[b]);
        peak[b] = level < 1e-20 ? 0 : level;
        const want = this.wanted(b, level > 1e-7 ? Math.log(level) * LOG_TO_DB : -140);
        // il guadagno scende con l'attacco, risale con il rilascio
        const k = want < gainDb[b] ? attackK : releaseK;
        gainDb[b] = k * gainDb[b] + (1 - k) * want;
        const g = Math.exp(gainDb[b] / LOG_TO_DB) * bandGain[b];
        yl += L[b] * g;
        yr += R[b] * g;
      }
      this.output += (this.targetOutput - this.output) * smoothK;
      this.mix += (this.targetMix - this.mix) * smoothK;
      const o = this.output, m = this.mix;
      outL[i] = (dl + (yl - dl) * m) * o;
      outR[i] = (dr + (yr - dr) * m) * o;
    }
  }
}
