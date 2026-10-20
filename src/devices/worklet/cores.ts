import type { CoreFactory, EffectFactory } from '../dsp/core';
import { AutoFilterCore } from '../effects/auto-filter/auto-filter-core';
import { BeatRepeatCore } from '../effects/beat-repeat/beat-repeat-core';
import { ClipperCore } from '../effects/clipper/clipper-core';
import { CompressorCore } from '../effects/compressor/compressor-core';
import { DelayCore } from '../effects/delay/delay-core';
import { DriveCore } from '../effects/drive/drive-core';
import { EqCore } from '../effects/eq/eq-core';
import { GateCore } from '../effects/gate/gate-core';
import { LimiterCore } from '../effects/limiter/limiter-core';
import { MultibandCore } from '../effects/multiband/multiband-core';
import { PhaserCore } from '../effects/phaser/phaser-core';
import { ReverbCore } from '../effects/reverb/reverb-core';
import { ReverseCore } from '../effects/reverse/reverse-core';
import { StereoCore } from '../effects/stereo/stereo-core';
import { TapeStopCore } from '../effects/tape-stop/tape-stop-core';
import { AnalogCore } from '../instruments/analog/analog-core';
import { DrumCore } from '../instruments/drums/drums-core';
import { NeuroCore } from '../instruments/neuro/neuro-core';
import { PrismaCore } from '../instruments/prisma/prisma-core';
import { SamplerCore } from '../instruments/sampler/sampler-core';
import { WavetableCore } from '../instruments/wavetable/wavetable-core';

/** I motori DSP degli strumenti, per tipo: aggiungere un synth è aggiungere una riga qui e
 *  la sua descrizione in registry.ts. */
export const INSTRUMENT_CORES: Readonly<Record<string, CoreFactory>> = {
  analog: sampleRate => new AnalogCore(sampleRate),
  drums: sampleRate => new DrumCore(sampleRate),
  neuro: sampleRate => new NeuroCore(sampleRate),
  prisma: sampleRate => new PrismaCore(sampleRate),
  sampler: sampleRate => new SamplerCore(sampleRate),
  wavetable: sampleRate => new WavetableCore(sampleRate),
};

/** I motori DSP degli effetti, per tipo (stesso schema degli strumenti). */
export const EFFECT_CORES: Readonly<Record<string, EffectFactory>> = {
  autoFilter: sampleRate => new AutoFilterCore(sampleRate),
  beatRepeat: sampleRate => new BeatRepeatCore(sampleRate),
  clipper: sampleRate => new ClipperCore(sampleRate),
  compressor: sampleRate => new CompressorCore(sampleRate),
  delay: sampleRate => new DelayCore(sampleRate),
  drive: sampleRate => new DriveCore(sampleRate),
  eq: sampleRate => new EqCore(sampleRate),
  gate: sampleRate => new GateCore(sampleRate),
  limiter: sampleRate => new LimiterCore(sampleRate),
  multiband: sampleRate => new MultibandCore(sampleRate),
  phaser: sampleRate => new PhaserCore(sampleRate),
  reverb: sampleRate => new ReverbCore(sampleRate),
  reverse: sampleRate => new ReverseCore(sampleRate),
  stereo: sampleRate => new StereoCore(sampleRate),
  tapeStop: sampleRate => new TapeStopCore(sampleRate),
};
