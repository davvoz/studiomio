import { AnalogCore } from '../analog/analog-core';
import type { CoreFactory } from '../dsp/core';

/** I motori DSP degli strumenti, per tipo: aggiungere un synth è aggiungere una riga qui e
 *  la sua descrizione in instruments/registry.ts. */
export const CORES: Readonly<Record<string, CoreFactory>> = {
  analog: sampleRate => new AnalogCore(sampleRate),
};
