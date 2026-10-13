import { ANALOG } from './analog/analog';
import type { InstrumentType } from './instrument-type';

/** I tipi di strumento disponibili (lato interfaccia). Il motore DSP di ciascuno è registrato
 *  con lo stesso nome in worklet/cores.ts. */
export const INSTRUMENT_TYPES: readonly InstrumentType[] = [ANALOG];

const byType = new Map(INSTRUMENT_TYPES.map(t => [t.type, t]));

export const instrumentType = (type: string): InstrumentType | undefined => byType.get(type);
