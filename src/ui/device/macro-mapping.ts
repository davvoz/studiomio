/* The macros' mapping in the device view, without the DOM: "Map" on a rack (with a macro chosen
 * or not), what a click on a parameter does, how the controls are marked. */
import type { DeviceId } from '../../core/id';
import type { ParamValues } from '../../model/device';
import { findRack, macroOf, outerRacks, rackName, racksWith, type DeviceKey, type RackList } from '../../model/rack';

/** "Map" on on a rack, with the chosen macro (null: none yet). */
export interface MapMode {
  readonly rack: DeviceId;
  readonly macro: number | null;
}

/** A macro chosen for mapping: the parameters clicked go to it. */
export interface MacroChoice {
  readonly rack: DeviceId;
  readonly macro: number;
}

/** Rack `outer` has device or rack `key` inside (its macros can move it). */
export function mapsInto(racks: RackList, outer: DeviceId, key: DeviceKey): boolean {
  const inner = findRack(racks, key as DeviceId);
  return (inner ? outerRacks(racks, inner) : racksWith(racks, key)).some(r => r.id === outer);
}

/** With "Map" on on a macro of a rack around `key`: that macro (null otherwise). */
export function mappingInto(map: MapMode | null, racks: RackList, key: DeviceKey): MacroChoice | null {
  if (typeof map?.macro !== 'number' || !mapsInto(racks, map.rack, key)) return null;
  return { rack: map.rack, macro: map.macro };
}

/** What a mouse or key event on a control does:
 *  'key' with KEY on (the control waits for its key), 'map' with a macro chosen around it (it's
 *  mapped there), 'block' if a macro moves it (it isn't touched), 'pass' otherwise (it works). */
export type ControlClick = 'key' | 'map' | 'block' | 'pass';

export function controlClick(keyMapping: boolean, map: MapMode | null, racks: RackList, key: DeviceKey, param: string): ControlClick {
  if (keyMapping) return 'key';
  if (mappingInto(map, racks, key)) return 'map';
  return macroOf(racks, key, param) ? 'block' : 'pass';
}

/** How a control is marked: dimmed if a macro moves it, with the macro's number and who moves it;
 *  `chosen` if it's mapped to the macro being mapped (null: leave the mark as it is). */
export interface ControlMark {
  readonly mapped: boolean;
  readonly chosen: boolean | null;
  readonly macro: string | null;
  readonly title: string | null;
}

/** A device's parameter. */
export function paramMark(racks: RackList, key: DeviceKey, param: string, map: MapMode | null): ControlMark {
  const found = macroOf(racks, key, param);
  return {
    mapped: !!found,
    chosen: !!found && !!map && found.rack.id === map.rack && found.index === map.macro,
    macro: found ? String(found.index + 1) : null,
    title: found ? `Moved by macro ${found.index + 1} of ${rackName(found.rack)} (right click to remove it)` : null,
  };
}

/** A rack's macro mapped to a macro of a surrounding rack (`outer`: the macro being mapped, if
 *  it can take this one). Its title gets the line, after its own. */
export function macroMark(racks: RackList, rack: DeviceId, param: string, outer: MacroChoice | null): ControlMark {
  const found = macroOf(racks, rack, param);
  return {
    mapped: !!found,
    chosen: outer ? !!found && found.rack.id === outer.rack && found.index === outer.macro : null,
    macro: found ? String(found.index + 1) : null,
    title: found ? `\nMoved by macro ${found.index + 1} of ${rackName(found.rack)} (right click to remove it).` : null,
  };
}

/** A device's panel can take the chosen macro's mappings. */
export const deviceMappable = (map: MapMode | null, racks: RackList, key: DeviceKey): boolean =>
  !!map && map.macro !== null && mapsInto(racks, map.rack, key);

/** The values from a graphic panel that a macro doesn't move (those it moves aren't touched, like their knobs). */
export function freeParams(racks: RackList, key: DeviceKey, values: ParamValues): ParamValues {
  return Object.fromEntries(Object.entries(values).filter(([param]) => !macroOf(racks, key, param)));
}

/** With KEY on, a parameter a macro moves doesn't take a key: the message saying so (null if no macro moves it). */
export function keyGoesToMacro(racks: RackList, device: DeviceKey, param: string): string | null {
  const found = macroOf(racks, device, param);
  return found ? `Macro ${found.index + 1} of ${rackName(found.rack)} moves it: give the key to the macro.` : null;
}
