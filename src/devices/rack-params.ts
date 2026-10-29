/* I parametri dei dispositivi di una catena per chiave ("instrument" o l'id dell'effetto), e
 * il valore che una macro dà a un parametro mappato. Usato dalle modifiche dei rack, dal
 * motore, dal controller e dall'interfaccia. */
import { paramSpec, type DeviceType } from './device-type';
import { clampParam, paramFromUnit, paramToUnit, type NumberParam, type ParamSpec } from './params';
import { effectType, instrumentType } from './registry';
import type { DeviceId } from '../core/id';
import type { DeviceSettings } from '../model/device';
import { INSTRUMENT_DEVICE } from '../model/envelope';
import { MASTER, type ChainOwner, type Project } from '../model/project';
import { findRack, MACRO_MAX, macroIndex, macroName, macroParam, type DeviceKey, type MacroMapping, type Rack } from '../model/rack';
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

/** Il parametro mappato: di un dispositivo, o la macro di un rack (dentro un altro rack). */
export const mappingSpec = (p: Project, owner: ChainOwner, m: Pick<MacroMapping, 'device' | 'param'>): ParamSpec | undefined => {
  const rack = findRack(p.racksOf(owner), m.device as DeviceId);
  if (rack) return rack.macros[macroIndex(m.param)] && macroSpec(p, owner, rack, macroIndex(m.param));
  const type = deviceTypeAt(p, owner, m.device);
  return type && paramSpec(type, m.param);
};

/** Una macro come parametro (0 … 127), con il suo nome: senza passi, perché quella di un rack
 *  intorno la muova senza scalini. */
export function macroSpec(p: Project, owner: ChainOwner, rack: Rack, index: number): NumberParam {
  return {
    kind: 'number', id: macroParam(index), min: 0, max: MACRO_MAX, default: 0,
    label: macroName(rack.macros[index], index, x => mappingSpec(p, owner, x)?.label),
  };
}

/** Il valore di un parametro mappato com'è ora (undefined se non c'è). */
export function mappedParamValue(p: Project, owner: ChainOwner, m: Pick<MacroMapping, 'device' | 'param'>): number | undefined {
  const rack = findRack(p.racksOf(owner), m.device as DeviceId);
  return rack ? rack.macros[macroIndex(m.param)]?.value : deviceAt(p, owner, m.device)?.params[m.param];
}

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
