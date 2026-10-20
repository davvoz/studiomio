import type { DeviceType } from './device-type';
import { AUTO_FILTER } from './effects/auto-filter/auto-filter';
import { AUTO_PAN } from './effects/auto-pan/auto-pan';
import { BEAT_REPEAT } from './effects/beat-repeat/beat-repeat';
import { CHORUS } from './effects/chorus/chorus';
import { CLIPPER } from './effects/clipper/clipper';
import { COMPRESSOR } from './effects/compressor/compressor';
import { DELAY } from './effects/delay/delay';
import { DRIVE } from './effects/drive/drive';
import { EQ } from './effects/eq/eq';
import { GATE } from './effects/gate/gate';
import { LIMITER } from './effects/limiter/limiter';
import { MULTIBAND } from './effects/multiband/multiband';
import { PHASER } from './effects/phaser/phaser';
import { REDUX } from './effects/redux/redux';
import { REVERB } from './effects/reverb/reverb';
import { REVERSE } from './effects/reverse/reverse';
import { STEREO } from './effects/stereo/stereo';
import { TAPE_STOP } from './effects/tape-stop/tape-stop';
import { ANALOG } from './instruments/analog/analog';
import { DRUMS } from './instruments/drums/drums';
import { NEURO } from './instruments/neuro/neuro';
import { PRISMA } from './instruments/prisma/prisma';
import { SAMPLER } from './instruments/sampler/sampler';
import { WAVETABLE } from './instruments/wavetable/wavetable';

/** Gli strumenti disponibili (lato interfaccia). Il motore DSP di ciascuno è registrato con
 *  lo stesso nome in worklet/cores.ts. */
export const INSTRUMENT_TYPES: readonly DeviceType[] = [ANALOG, WAVETABLE, PRISMA, NEURO, SAMPLER, DRUMS];

/** Gli effetti disponibili, come sopra. */
export const EFFECT_TYPES: readonly DeviceType[] = [EQ, COMPRESSOR, MULTIBAND, DRIVE, CLIPPER, REDUX, AUTO_FILTER, AUTO_PAN, CHORUS, PHASER, GATE, BEAT_REPEAT, TAPE_STOP, REVERSE, DELAY, REVERB, STEREO, LIMITER];

const instruments = new Map(INSTRUMENT_TYPES.map(t => [t.type, t]));
const effects = new Map(EFFECT_TYPES.map(t => [t.type, t]));

export const instrumentType = (type: string): DeviceType | undefined => instruments.get(type);
export const effectType = (type: string): DeviceType | undefined => effects.get(type);
