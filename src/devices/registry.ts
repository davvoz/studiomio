import type { DeviceType } from './device-type';
import { COMPRESSOR } from './effects/compressor/compressor';
import { DELAY } from './effects/delay/delay';
import { DRIVE } from './effects/drive/drive';
import { EQ } from './effects/eq/eq';
import { LIMITER } from './effects/limiter/limiter';
import { MULTIBAND } from './effects/multiband/multiband';
import { PHASER } from './effects/phaser/phaser';
import { REVERB } from './effects/reverb/reverb';
import { ANALOG } from './instruments/analog/analog';
import { DRUMS } from './instruments/drums/drums';
import { NEURO } from './instruments/neuro/neuro';

/** Gli strumenti disponibili (lato interfaccia). Il motore DSP di ciascuno è registrato con
 *  lo stesso nome in worklet/cores.ts. */
export const INSTRUMENT_TYPES: readonly DeviceType[] = [ANALOG, NEURO, DRUMS];

/** Gli effetti disponibili, come sopra. */
export const EFFECT_TYPES: readonly DeviceType[] = [EQ, COMPRESSOR, MULTIBAND, DRIVE, PHASER, DELAY, REVERB, LIMITER];

const instruments = new Map(INSTRUMENT_TYPES.map(t => [t.type, t]));
const effects = new Map(EFFECT_TYPES.map(t => [t.type, t]));

export const instrumentType = (type: string): DeviceType | undefined => instruments.get(type);
export const effectType = (type: string): DeviceType | undefined => effects.get(type);
