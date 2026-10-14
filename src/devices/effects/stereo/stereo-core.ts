/* Il suono dello Stereo, in mezzo e lato:
 *
 *   M = (L + R) / 2, S = (L − R) / 2
 *   S' = S × larghezza, e con i bassi mono passa prima da un passa-alto Linkwitz-Riley a 24 dB
 *        (due Butterworth): sotto la frequenza il lato sparisce, il mezzo non si tocca
 *   L = (M + S') × guadagno, R = (M − S') × guadagno
 *
 * Il mezzo non passa da nessun filtro: un suono già mono esce identico. Gira nell'AudioWorklet;
 * qui niente Web Audio, così si prova anche in Node. */
import { dbToGain, type EffectCore } from '../../dsp/core';
import { Tpt } from '../../dsp/tpt';

const BUTTERWORTH_Q = Math.SQRT1_2;
const SMOOTH = 0.02;

export class StereoCore implements EffectCore {
  private readonly hp1 = new Tpt();
  private readonly hp2 = new Tpt();
  private bassMono = true;
  private width = 1;
  private targetWidth = 1;
  private gain = 1;
  private targetGain = 1;
  private fresh = true;
  private readonly smoothK: number;

  constructor(private readonly sampleRate: number) {
    this.smoothK = 1 - Math.exp(-1 / (SMOOTH * sampleRate));
    this.setParams({});
  }

  setParams(p: Readonly<Record<string, number>>): void {
    this.bassMono = (p.bassMono ?? 1) === 1;
    const f = p.monoFreq ?? 120;
    this.hp1.set(f, BUTTERWORTH_Q, this.sampleRate);
    this.hp2.set(f, BUTTERWORTH_Q, this.sampleRate);
    this.targetWidth = Math.max(0, (p.width ?? 100) / 100);
    this.targetGain = dbToGain(p.gain ?? 0);
    if (this.fresh) {
      this.width = this.targetWidth;
      this.gain = this.targetGain;
    }
  }

  setTempo(): void {}

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    this.fresh = false;
    const { hp1, hp2, bassMono, smoothK: k } = this;
    let width = this.width, gain = this.gain;
    for (let i = 0; i < n; i++) {
      width += (this.targetWidth - width) * k;
      gain += (this.targetGain - gain) * k;
      const m = (inL[i] + inR[i]) * 0.5;
      let s = (inL[i] - inR[i]) * 0.5;
      if (bassMono) {
        hp1.tick(s);
        hp2.tick(hp1.high);
        s = hp2.high;
      }
      s *= width;
      outL[i] = (m + s) * gain;
      outR[i] = (m - s) * gain;
    }
    this.width = width;
    this.gain = gain;
  }
}
