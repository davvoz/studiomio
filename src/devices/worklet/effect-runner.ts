import type { EffectCore } from '../dsp/core';

/** Durata della dissolvenza tra effetto e suono diretto, in secondi. */
const FADE = 0.01;

/** Fa lavorare un effetto e ne gestisce lo spegnimento per tutti i tipi: acceso/spento passa
 *  con una breve dissolvenza (niente click); spento, l'effetto non lavora e il suono passa. */
export class EffectRunner {
  /** Quanto effetto si sente: 1 acceso, 0 spento, in mezzo durante la dissolvenza. */
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
