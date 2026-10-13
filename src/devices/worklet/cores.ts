import type { CoreFactory, EffectFactory } from '../dsp/core';
import { DelayCore } from '../effects/delay/delay-core';
import { EqCore } from '../effects/eq/eq-core';
import { AnalogCore } from '../instruments/analog/analog-core';

/** I motori DSP degli strumenti, per tipo: aggiungere un synth è aggiungere una riga qui e
 *  la sua descrizione in registry.ts. */
export const INSTRUMENT_CORES: Readonly<Record<string, CoreFactory>> = {
  analog: sampleRate => new AnalogCore(sampleRate),
};

/** I motori DSP degli effetti, per tipo (stesso schema degli strumenti). */
export const EFFECT_CORES: Readonly<Record<string, EffectFactory>> = {
  delay: sampleRate => new DelayCore(sampleRate),
  eq: sampleRate => new EqCore(sampleRate),
};
