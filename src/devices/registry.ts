import type { DeviceType } from './device-type';
import { DELAY } from './effects/delay/delay';
import { EQ } from './effects/eq/eq';
import { ANALOG } from './instruments/analog/analog';

/** Gli strumenti disponibili (lato interfaccia). Il motore DSP di ciascuno è registrato con
 *  lo stesso nome in worklet/cores.ts. */
export const INSTRUMENT_TYPES: readonly DeviceType[] = [ANALOG];

/** Gli effetti disponibili, come sopra. */
export const EFFECT_TYPES: readonly DeviceType[] = [EQ, DELAY];

const instruments = new Map(INSTRUMENT_TYPES.map(t => [t.type, t]));
const effects = new Map(EFFECT_TYPES.map(t => [t.type, t]));

export const instrumentType = (type: string): DeviceType | undefined => instruments.get(type);
export const effectType = (type: string): DeviceType | undefined => effects.get(type);
