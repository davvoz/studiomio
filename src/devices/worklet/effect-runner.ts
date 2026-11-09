import type { EffectCore } from '../dsp/core';

/** Length of the crossfade between effect and direct sound, in seconds. */
const FADE = 0.01;

/** Runs an effect and handles turning it off for all types: on/off goes
 *  with a short crossfade (no clicks); off, the effect doesn't work and the sound passes. */
export class EffectRunner {
  /** How much effect is heard: 1 on, 0 off, in between during the fade. */
  private amount: number;
  private target: number;
  private readonly step: number;

  constructor(private readonly core: EffectCore, sampleRate: number, enabled: boolean) {
    this.amount = this.target = enabled ? 1 : 0;
    this.step = 1 / Math.max(1, FADE * sampleRate);
  }

  setEnabled(on: boolean): void {
    this.target = on ? 1 : 0;
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array): void {
    const n = outL.length;
    if (this.amount === 0 && this.target === 0) {
      outL.set(inL.subarray(0, n));
      outR.set(inR.subarray(0, n));
      return;
    }
    this.core.process(inL, inR, outL, outR, n);
    if (this.amount === 1 && this.target === 1) return;
    let a = this.amount;
    const dir = Math.sign(this.target - a), step = this.step;
    for (let i = 0; i < n; i++) {
      a = dir > 0 ? Math.min(1, a + step) : Math.max(0, a - step);
      outL[i] = inL[i] + (outL[i] - inL[i]) * a;
      outR[i] = inR[i] + (outR[i] - inR[i]) * a;
    }
    this.amount = a;
  }
}
