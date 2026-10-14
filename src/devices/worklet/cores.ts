import type { CoreFactory, EffectFactory } from '../dsp/core';
import { CompressorCore } from '../effects/compressor/compressor-core';
import { DelayCore } from '../effects/delay/delay-core';
import { DriveCore } from '../effects/drive/drive-core';
import { EqCore } from '../effects/eq/eq-core';
import { LimiterCore } from '../effects/limiter/limiter-core';
import { MultibandCore } from '../effects/multiband/multiband-core';
import { ReverbCore } from '../effects/reverb/reverb-core';
import { AnalogCore } from '../instruments/analog/analog-core';
import { DrumCore } from '../instruments/drums/drums-core';

/** I motori DSP degli strumenti, per tipo: aggiungere un synth è aggiungere una riga qui e
 *  la sua descrizione in registry.ts. */
export const INSTRUMENT_CORES: Readonly<Record<string, CoreFactory>> = {
  analog: sampleRate => new AnalogCore(sampleRate),
  drums: sampleRate => new DrumCore(sampleRate),
};

/** I motori DSP degli effetti, per tipo (stesso schema degli strumenti). */
export const EFFECT_CORES: Readonly<Record<string, EffectFactory>> = {
  compressor: sampleRate => new CompressorCore(sampleRate),
  delay: sampleRate => new DelayCore(sampleRate),
  drive: sampleRate => new DriveCore(sampleRate),
  eq: sampleRate => new EqCore(sampleRate),
  limiter: sampleRate => new LimiterCore(sampleRate),
  multiband: sampleRate => new MultibandCore(sampleRate),
  reverb: sampleRate => new ReverbCore(sampleRate),
};
