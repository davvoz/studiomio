/* The parameters of a chain's devices by key ("instrument" or the effect's id), and
 * the value a macro gives a mapped parameter. Used by the rack edits, the
 * engine, the controller and the interface. */
import { paramSpec, type DeviceType } from './device-type';
import { clampParam, paramFromUnit, paramToUnit, type NumberParam, type ParamSpec } from './params';
import { effectType, instrumentType } from './registry';
import type { DeviceId } from '../core/id';
import type { DeviceSettings } from '../model/device';
import { INSTRUMENT_DEVICE } from '../model/envelope';
import { MASTER, type ChainOwner, type Project } from '../model/project';
import { findRack, MACRO_MAX, macroIndex, macroName, macroParam, type DeviceKey, type MacroMapping, type Rack } from '../model/rack';
import { MidiTrack } from '../model/track';

/** The settings of a device of the chain, or undefined. */
export function deviceAt(p: Project, owner: ChainOwner, key: DeviceKey): DeviceSettings | undefined {
  if (key !== INSTRUMENT_DEVICE) return p.effectsOf(owner).find(e => e.id === key);
  const track = owner === MASTER ? undefined : p.track(owner);
  return track instanceof MidiTrack ? track.instrument : undefined;
}

/** The type of a device of the chain (undefined if unknown). */
export function deviceTypeAt(p: Project, owner: ChainOwner, key: DeviceKey): DeviceType | undefined {
  const s = deviceAt(p, owner, key);
  if (!s) return undefined;
  return key === INSTRUMENT_DEVICE ? instrumentType(s.type) : effectType(s.type);
}

/** The mapped parameter: of a device, or a rack's macro (inside another rack). */
export const mappingSpec = (p: Project, owner: ChainOwner, m: Pick<MacroMapping, 'device' | 'param'>): ParamSpec | undefined => {
  const rack = findRack(p.racksOf(owner), m.device as DeviceId);
  if (rack) return rack.macros[macroIndex(m.param)] && macroSpec(p, owner, rack, macroIndex(m.param));
  const type = deviceTypeAt(p, owner, m.device);
  return type && paramSpec(type, m.param);
};

/** A macro as a parameter (0 … 127), with its name: without steps, so that a surrounding
 *  rack's macro moves it without steps. */
export function macroSpec(p: Project, owner: ChainOwner, rack: Rack, index: number): NumberParam {
  return {
    kind: 'number', id: macroParam(index), min: 0, max: MACRO_MAX, default: 0,
    label: macroName(rack.macros[index], index, x => mappingSpec(p, owner, x)?.label),
  };
}

/** The value of a mapped parameter as it is now (undefined if it doesn't exist). */
export function mappedParamValue(p: Project, owner: ChainOwner, m: Pick<MacroMapping, 'device' | 'param'>): number | undefined {
  const rack = findRack(p.racksOf(owner), m.device as DeviceId);
  return rack ? rack.macros[macroIndex(m.param)]?.value : deviceAt(p, owner, m.device)?.params[m.param];
}

/** The value of a mapped parameter with the macro at `value` (0 … 127): the parameter's knob
 *  goes in a straight line from the minimum's position to the maximum's. */
export function mappedValue(spec: ParamSpec, m: MacroMapping, value: number): number {
  const a = paramToUnit(spec, clampParam(spec, m.min)), b = paramToUnit(spec, clampParam(spec, m.max));
  return paramFromUnit(spec, a + ((b - a) * Math.max(0, Math.min(MACRO_MAX, value))) / MACRO_MAX);
}

/** How much of the parameter knob's travel the macro's whole travel makes (−1 … +1: negative
 *  if the minimum is above the maximum). */
export const mappingTravel = (spec: ParamSpec, m: MacroMapping): number =>
  paramToUnit(spec, clampParam(spec, m.max)) - paramToUnit(spec, clampParam(spec, m.min));
