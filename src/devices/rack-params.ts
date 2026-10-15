/* I parametri dei dispositivi di una catena per chiave ("instrument" o l'id dell'effetto), e
 * il valore che una macro dà a un parametro mappato. Usato dalle modifiche dei rack, dal
 * motore, dal controller e dall'interfaccia. */
import { paramSpec, type DeviceType } from './device-type';
import { clampParam, paramFromUnit, paramToUnit, type ParamSpec } from './params';
import { effectType, instrumentType } from './registry';
import type { DeviceSettings } from '../model/device';
import { INSTRUMENT_DEVICE } from '../model/envelope';
import { MASTER, type ChainOwner, type Project } from '../model/project';
import { MACRO_MAX, type DeviceKey, type MacroMapping } from '../model/rack';
import { MidiTrack } from '../model/track';

/** Le impostazioni di un dispositivo della catena, o undefined. */
export function deviceAt(p: Project, owner: ChainOwner, key: DeviceKey): DeviceSettings | undefined {
  if (key !== INSTRUMENT_DEVICE) return p.effectsOf(owner).find(e => e.id === key);
  const track = owner === MASTER ? undefined : p.track(owner);
  return track instanceof MidiTrack ? track.instrument : undefined;
}

/** Il tipo di un dispositivo della catena (undefined se sconosciuto). */
export function deviceTypeAt(p: Project, owner: ChainOwner, key: DeviceKey): DeviceType | undefined {
  const s = deviceAt(p, owner, key);
  if (!s) return undefined;
  return key === INSTRUMENT_DEVICE ? instrumentType(s.type) : effectType(s.type);
}

export const mappingSpec = (p: Project, owner: ChainOwner, m: Pick<MacroMapping, 'device' | 'param'>): ParamSpec | undefined => {
  const type = deviceTypeAt(p, owner, m.device);
  return type && paramSpec(type, m.param);
};

/** Il valore di un parametro mappato con la macro a `value` (0 … 127): la manopola del
 *  parametro va in linea retta dalla posizione del minimo a quella del massimo. */
export function mappedValue(spec: ParamSpec, m: MacroMapping, value: number): number {
  const a = paramToUnit(spec, clampParam(spec, m.min)), b = paramToUnit(spec, clampParam(spec, m.max));
  return paramFromUnit(spec, a + ((b - a) * Math.max(0, Math.min(MACRO_MAX, value))) / MACRO_MAX);
}

/** Quanta corsa della manopola del parametro fa tutta la corsa della macro (−1 … +1: negativa
 *  se il minimo è sopra il massimo). */
export const mappingTravel = (spec: ParamSpec, m: MacroMapping): number =>
  paramToUnit(spec, clampParam(spec, m.max)) - paramToUnit(spec, clampParam(spec, m.min));
