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
import { NOISE_GATE } from './effects/noise-gate/noise-gate';
import { MULTIBAND } from './effects/multiband/multiband';
import { PHASER } from './effects/phaser/phaser';
import { PITCH_SHIFTER } from './effects/pitch-shifter/pitch-shifter';
import { REDUX } from './effects/redux/redux';
import { REVERB } from './effects/reverb/reverb';
import { REVERSE } from './effects/reverse/reverse';
import { STEREO } from './effects/stereo/stereo';
import { TAPE_STOP } from './effects/tape-stop/tape-stop';
import { ANALOG } from './instruments/analog/analog';
import { DRUMS } from './instruments/drums/drums';
import { CYMBALS } from './instruments/cymbals/cymbals';
import { KICK } from './instruments/kick/kick';
import { SNARE } from './instruments/snare/snare';
import { NEURO } from './instruments/neuro/neuro';
import { PRISMA } from './instruments/prisma/prisma';
import { SAMPLER } from './instruments/sampler/sampler';
import { WAVETABLE } from './instruments/wavetable/wavetable';
import { ARP } from './arp/arp';
import { ENVELOPE_DEVICE, LFO_DEVICE } from './modulators/modulators';

/** The available instruments (interface side). Each one's DSP engine is registered with
 *  the same name in worklet/cores.ts. */
export const INSTRUMENT_TYPES: readonly DeviceType[] = [ANALOG, WAVETABLE, PRISMA, NEURO, SAMPLER, DRUMS, KICK, SNARE, CYMBALS];

/** The available effects, as above. */
export const EFFECT_TYPES: readonly DeviceType[] = [EQ, COMPRESSOR, NOISE_GATE, MULTIBAND, DRIVE, CLIPPER, REDUX, AUTO_FILTER, AUTO_PAN, CHORUS, PHASER, PITCH_SHIFTER, GATE, BEAT_REPEAT, TAPE_STOP, REVERSE, DELAY, REVERB, STEREO, LIMITER, LFO_DEVICE, ENVELOPE_DEVICE, ARP];

/** The effects that can be added to a chain: the note ones only if there's an instrument. */
export const chainEffectTypes = (midi: boolean): readonly DeviceType[] => (midi ? EFFECT_TYPES : EFFECT_TYPES.filter(t => !t.notes));

const instruments = new Map(INSTRUMENT_TYPES.map(t => [t.type, t]));
const effects = new Map(EFFECT_TYPES.map(t => [t.type, t]));

export const instrumentType = (type: string): DeviceType | undefined => instruments.get(type);
export const effectType = (type: string): DeviceType | undefined => effects.get(type);
