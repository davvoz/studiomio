/* Il suono del Clipper. Per canale, alla frequenza sovracampionata:
 *
 *   ingresso × Ingresso → curva (|x| fino al ginocchio passa com'è, poi entra nel tetto con una
 *   tanh che parte con pendenza 1: niente spigoli) → giù con il filtro a mezza banda → × Uscita
 *
 * La curva, con u = |x| / tetto e k = 1 − ginocchio: u fino a k, poi k + (1 − k)·tanh((u − k) / (1 − k)).
 * Con il ginocchio a 0 è il taglio netto (min(u, 1)), a 100 una tanh intera. Dopo il ritorno
 * alla frequenza originale il filtro può ricostruire picchi appena sopra il tetto: dietro va il
 * Limiter. Gira nell'AudioWorklet; qui niente Web Audio, così si prova anche in Node. */
import { dbToGain, type EffectCore } from '../../dsp/core';
import { Oversampler } from '../../dsp/oversampler';
import { CLIPPER_OVERSAMPLING } from './clipper';

const SMOOTH = 0.02;

/** La curva del clipper su un valore già diviso per il tetto. */
export function clipCurve(u: number, knee: number): number {
  const a = Math.abs(u), k = 1 - knee;
  if (a <= k) return u;
  const y = k >= 1 ? 1 : k + (1 - k) * Math.tanh((a - k) / (1 - k));
  return u < 0 ? -y : y;
}

export class ClipperCore implements EffectCore {
  private factor: 2 | 4 | 8 = 4;
  private osL = new Oversampler(4);
  private osR = new Oversampler(4);
  private drive = 1;
  private targetDrive = 1;
  private output = 1;
  private targetOutput = 1;
  private ceiling = 1;
  private knee = 0.3;
  private fresh = true;
  private readonly smoothK: number;
  private scratchL = new Float32Array(128);
  private scratchR = new Float32Array(128);
  /** Il taglio più forte dall'ultima lettura (rapporto tra uscita e ingresso della curva). */
  private minRatio = 1;

  constructor(sampleRate: number) {
    this.smoothK = 1 - Math.exp(-1 / (SMOOTH * sampleRate));
  }

  /** Ritardo dell'effetto in campioni (il giro su e giù del sovracampionamento). */
  get latency(): number {
    return this.osL.latency;
  }

  /** Quanti dB ha tagliato al massimo dall'ultima lettura (la lettura la azzera). */
  takeReduction(): number {
    const db = -20 * Math.log10(Math.max(this.minRatio, 1e-6));
    this.minRatio = 1;
    return db;
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const factor = CLIPPER_OVERSAMPLING[p.oversampling ?? 1] ?? 4;
    if (factor !== this.factor) {
      this.factor = factor;
      this.osL = new Oversampler(factor);
      this.osR = new Oversampler(factor);
    }
    this.targetDrive = dbToGain(p.drive ?? 0);
    this.targetOutput = dbToGain(p.output ?? 0);
    this.ceiling = dbToGain(p.ceiling ?? -0.3);
    this.knee = Math.max(0, Math.min(1, (p.knee ?? 30) / 100));
    if (this.fresh) {
      this.drive = this.targetDrive;
      this.output = this.targetOutput;
    }
  }

  setTempo(): void {}

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    this.fresh = false;
    if (this.scratchL.length < n) [this.scratchL, this.scratchR] = [new Float32Array(n), new Float32Array(n)];
    const xl = this.scratchL, xr = this.scratchR, k = this.smoothK;
    let drive = this.drive;
    for (let i = 0; i < n; i++) {
      drive += (this.targetDrive - drive) * k;
      xl[i] = inL[i] * drive;
      xr[i] = inR[i] * drive;
    }
    this.drive = drive;
    const F = this.factor, upL = this.osL.up(xl, n), upR = this.osR.up(xr, n);
    const c = this.ceiling, inv = 1 / c, knee = this.knee;
    let minRatio = this.minRatio;
    for (let j = 0, m = n * F; j < m; j++) {
      const a = upL[j], b = upR[j];
      const ya = c * clipCurve(a * inv, knee), yb = c * clipCurve(b * inv, knee);
      if (Math.abs(a) > c * (1 - knee)) {
        const r = Math.abs(ya / a);
        if (r < minRatio) minRatio = r;
      }
      upL[j] = ya;
      upR[j] = yb;
    }
    this.minRatio = minRatio;
    this.osL.down(upL, outL, n);
    this.osR.down(upR, outR, n);
    let output = this.output;
    for (let i = 0; i < n; i++) {
      output += (this.targetOutput - output) * k;
      outL[i] *= output;
      outR[i] *= output;
    }
    this.output = output;
  }
}
