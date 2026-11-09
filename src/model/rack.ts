/* The racks, as in Live: a group of consecutive devices of the chain (with the instrument it's an
 * Instrument Rack, with effects only an Audio Effect Rack) with 8 macros. Each macro moves the
 * mapped parameters, each between its minimum and its maximum. The sound doesn't change: the rack
 * is a group over the chain, which stays a single row (no parallel chains). Racks also go
 * one inside the other: a macro moves the parameters of all the devices of its rack, also
 * of those in the racks it has inside, and those racks' macros. Here are the data and the pure
 * operations, on the order of the chain's devices. */
import { countOf } from '../core/math';
import type { DeviceId } from '../core/id';
import { INSTRUMENT_DEVICE } from './envelope';

/** A device of the chain: the instrument or an effect (by id). */
export type DeviceKey = DeviceId | typeof INSTRUMENT_DEVICE;

export const MACRO_COUNT = 8;
/** Macros go from 0 to 127, as in Live and on MIDI knobs. */
export const MACRO_MAX = 127;

export interface MacroMapping {
  readonly device: DeviceKey;
  readonly param: string;
  /** The parameter's value with the macro at 0 and at 127 (min > max: the macro moves it in reverse). */
  readonly min: number;
  readonly max: number;
}

/** How a macro is played: knob (as in Live), toggle (one click turns it on, another
 *  turns it off), button (on only while it's held down) or spring (a knob that, released,
 *  returns to its rest by itself). Toggle and button are only 0 or MACRO_MAX: they take each
 *  mapped parameter from one end of its travel to the other. */
export type MacroMode = 'knob' | 'toggle' | 'button' | 'spring';

export const MACRO_MODES: readonly (readonly [mode: MacroMode, label: string])[] = [
  ['knob', 'Knob'], ['toggle', 'Toggle'], ['button', 'Button'], ['spring', 'Spring'],
];

/** Where a released spring macro returns and in how long: `time` in beats if `sync`, otherwise in
 *  milliseconds (from wherever it is, always in the same time). */
export interface MacroSpring {
  /** 0 … MACRO_MAX. */
  readonly rest: number;
  readonly time: number;
  readonly sync: boolean;
}

/** The return times to choose from: synced (in beats) and free (in milliseconds). */
export const SPRING_TIMES: readonly (readonly [time: number, sync: boolean, label: string])[] = [
  [0.25, true, '1/16'], [0.5, true, '1/8'], [1, true, '1/4'], [2, true, '1/2'],
  [4, true, '1 bar'], [8, true, '2 bars'], [16, true, '4 bars'],
  [50, false, '50 ms'], [100, false, '100 ms'], [250, false, '250 ms'], [500, false, '500 ms'],
  [1000, false, '1 s'], [2000, false, '2 s'], [5000, false, '5 s'],
];
export const SPRING_MS_MAX = 60_000;
export const SPRING_BEATS_MAX = 64;

/** The return time in words: "1/4", "2 bars", "300 ms". */
export function springTimeLabel({ time, sync }: MacroSpring): string {
  const named = SPRING_TIMES.find(([t, s]) => t === time && s === sync);
  if (named) return named[2];
  if (!sync) return time >= 1000 ? `${+(time / 1000).toFixed(2)} s` : `${Math.round(time)} ms`;
  return time % 4 === 0 ? countOf(time / 4, 'bar') : `${+time.toFixed(2)} beats`;
}

/** A return time written by hand: "300 ms", "1.5 s", "3/16" (of a note), "2 bars",
 *  "3 beats"; a number alone is in milliseconds. null: it can't be understood. */
export function parseSpringTime(text: string): { time: number; sync: boolean } | null {
  const t = text.trim().toLowerCase().replace(',', '.');
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (fraction) return Number(fraction[2]) > 0 ? { time: (4 * Number(fraction[1])) / Number(fraction[2]), sync: true } : null;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|secs?|seconds?|bars?|beats?)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]), unit = m[2] ?? 'ms';
  if (!(n > 0)) return null;
  if (unit === 'ms') return { time: n, sync: false };
  if (unit.startsWith('s')) return { time: n * 1000, sync: false };
  if (unit.startsWith('bar')) return { time: n * 4, sync: true };
  return { time: n, sync: true };
}

/** A valid spring (rest within the travel, positive and not huge time). */
export function springFor(rest: number, time: number, sync: boolean): MacroSpring {
  const max = sync ? SPRING_BEATS_MAX : SPRING_MS_MAX;
  const fine = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
  return {
    rest: Math.max(0, Math.min(MACRO_MAX, fine(rest, 0))),
    time: Math.max(sync ? 1 / 16 : 1, Math.min(max, fine(time, sync ? 1 : 250))),
    sync,
  };
}

export interface Macro {
  /** null: the name comes from the first mapped parameter, or it's "Macro N". */
  readonly name: string | null;
  /** 0 … MACRO_MAX. */
  readonly value: number;
  readonly mappings: readonly MacroMapping[];
  /** Missing: knob. */
  readonly mode?: MacroMode;
  /** Only for springs. */
  readonly spring?: MacroSpring;
}

export const macroMode = (m: Macro): MacroMode => m.mode ?? 'knob';

/** The spring of a spring macro (null for the other kinds). */
export const springOf = (m: Macro): MacroSpring | null =>
  (macroMode(m) === 'spring' ? m.spring ?? springFor(0, 1, true) : null);

/** Toggle or button: on or off, nothing in between. */
export const isSwitchMacro = (m: Macro): boolean => macroMode(m) === 'toggle' || macroMode(m) === 'button';

/** The value a macro can have: for toggle and button, on (from halfway up) or off. */
export function macroValueFor(mode: MacroMode, value: number): number {
  const v = Math.max(0, Math.min(MACRO_MAX, Number.isFinite(value) ? value : 0));
  if (mode === 'knob' || mode === 'spring') return v;
  return v >= MACRO_MAX / 2 ? MACRO_MAX : 0;
}

export interface Rack {
  readonly id: DeviceId;
  /** null: "Instrument Rack" o "Audio Effect Rack". */
  readonly name: string | null;
  /** The rack's devices in chain order, always consecutive, also those of the racks
   *  it has inside. */
  readonly devices: readonly DeviceKey[];
  readonly macros: readonly Macro[];
}

/** A chain's racks, each before those it has inside (from the biggest to the smallest). */
export type RackList = readonly Rack[];

/** No racks (always the same list: changes are recognized by reference). */
export const NO_RACKS: RackList = Object.freeze([]);

/** A macro's name as a parameter of the rack (in the targets of the clip modulations). */
export const macroParam = (index: number): string => `macro${index + 1}`;

/** The macro index of a rack parameter, or −1. */
export function macroIndex(param: string): number {
  const m = /^macro([1-8])$/.exec(param);
  return m ? Number(m[1]) - 1 : -1;
}

export const EMPTY_MACRO: Macro = { name: null, value: 0, mappings: [] };

export const newRack = (id: DeviceId, devices: readonly DeviceKey[]): Rack =>
  ({ id, name: null, devices: [...devices], macros: Array<Macro>(MACRO_COUNT).fill(EMPTY_MACRO) });

export const findRack = (racks: RackList, id: DeviceId): Rack | undefined => racks.find(r => r.id === id);

/** `inner` is inside `outer`: its devices are among those of `outer`. With the same
 *  devices (a rack having only another one inside) the one coming first is outside. */
export function isInside(racks: RackList, inner: Rack, outer: Rack): boolean {
  if (inner === outer || inner.devices.length > outer.devices.length || !inner.devices.every(k => outer.devices.includes(k))) return false;
  return inner.devices.length < outer.devices.length || racks.indexOf(outer) < racks.indexOf(inner);
}

/** From the outermost to the innermost. */
const outside = (racks: RackList) => (a: Rack, b: Rack) => b.devices.length - a.devices.length || racks.indexOf(a) - racks.indexOf(b);

/** The racks containing a device, from the outermost to the innermost. */
export const racksWith = (racks: RackList, key: DeviceKey): Rack[] => racks.filter(r => r.devices.includes(key)).sort(outside(racks));

/** The innermost rack containing a device. */
export const rackOf = (racks: RackList, key: DeviceKey): Rack | undefined => racksWith(racks, key).at(-1);

/** The racks containing a rack, from the outermost to the one having it inside. */
export const outerRacks = (racks: RackList, rack: Rack): Rack[] => racks.filter(r => isInside(racks, rack, r)).sort(outside(racks));

/** The rack a rack sits in, if it sits in one. */
export const parentOf = (racks: RackList, rack: Rack): Rack | undefined => outerRacks(racks, rack).at(-1);

/** The racks inside a rack, at every depth. */
export const innerRacks = (racks: RackList, rack: Rack): Rack[] => racks.filter(r => isInside(racks, r, rack));

/** How many racks there are around a rack (0: it's in the chain). */
export const rackDepth = (racks: RackList, rack: Rack): number => outerRacks(racks, rack).length;

/** Each rack before those it has inside: after a rack has grown, it stays before those
 *  that had its same devices. */
function outerFirst(racks: RackList): RackList {
  if (racks.every((r, i) => i === 0 || racks[i - 1].devices.length >= r.devices.length)) return racks;
  return [...racks].sort((a, b) => b.devices.length - a.devices.length);
}

/** The macro moving a parameter, if any (a parameter goes to a single macro). The parameter is
 *  of a device, or it's a rack's macro (`device` the rack, `param` "macroN"), which a
 *  macro of a surrounding rack can move. */
export function macroOf(racks: RackList, device: DeviceKey, param: string): { rack: Rack; index: number } | null {
  for (const rack of racks) {
    const index = rack.macros.findIndex(m => m.mappings.some(x => x.device === device && x.param === param));
    if (index >= 0) return { rack, index };
  }
  return null;
}

/** A rack's name as it's shown. */
export const rackName = (r: Rack): string =>
  r.name ?? (r.devices.includes(INSTRUMENT_DEVICE) ? 'Instrument Rack' : 'Audio Effect Rack');

/** A macro's name as it's shown: its own, or that of the first mapped parameter (as in
 *  Live), or "Macro N". `paramLabel` gives a parameter's name. */
export const macroName = (m: Macro, index: number, paramLabel: (x: MacroMapping) => string | undefined): string =>
  m.name ?? (m.mappings.length ? paramLabel(m.mappings[0]) : undefined) ?? `Macro ${index + 1}`;

/** The rules: a rack's devices exist and are consecutive in the chain; two racks are either
 *  one inside the other or have no devices in common; each rack has MACRO_COUNT macros, which
 *  map only devices of the rack or the macros of the racks it has inside. */
export function checkRacks(order: readonly DeviceKey[], racks: RackList): void {
  for (const r of racks) {
    if (!r.devices.length) throw new Error(`rack ${r.id} is empty`);
    if (r.macros.length !== MACRO_COUNT) throw new Error(`rack ${r.id} has ${r.macros.length} macros`);
    if (new Set(r.devices).size !== r.devices.length) throw new Error(`rack ${r.id} has the same device twice`);
    const first = order.indexOf(r.devices[0]);
    r.devices.forEach((k, i) => {
      if (first < 0 || order[first + i] !== k) throw new Error(`the devices of rack ${r.id} aren't consecutive in the chain`);
    });
  }
  for (const a of racks) {
    for (const b of racks) {
      const shared = a.devices.filter(k => b.devices.includes(k)).length;
      if (a !== b && shared && shared < a.devices.length && shared < b.devices.length) throw new Error(`racks ${a.id} and ${b.id} overlap`);
    }
  }
  for (const r of racks) {
    for (const m of r.macros) {
      for (const x of m.mappings) {
        if (r.devices.includes(x.device)) continue;
        const inner = findRack(racks, x.device as DeviceId);
        if (!inner || !isInside(racks, inner, r) || macroIndex(x.param) < 0) throw new Error(`a macro of rack ${r.id} moves a device outside the rack`);
      }
    }
  }
}

/** After some devices have been removed: they leave the racks (and the mappings); a rack
 *  left empty disappears, and with it the mappings on its macros. */
export function pruneRacks(order: readonly DeviceKey[], racks: RackList): RackList {
  const present = new Set(order);
  if (racks.every(r => r.devices.every(k => present.has(k)))) return racks;
  const kept = racks
    .map(r => (r.devices.every(k => present.has(k)) ? r : { ...r, devices: r.devices.filter(k => present.has(k)) }))
    .filter(r => r.devices.length);
  const ids = new Set<DeviceKey>(kept.map(r => r.id));
  return kept.map(r => withoutMappings(r, x => !present.has(x.device) && !ids.has(x.device)));
}

/** The rack without the mappings `gone` says (the same rack if there were none). */
function withoutMappings(r: Rack, gone: (x: MacroMapping) => boolean): Rack {
  if (!r.macros.some(m => m.mappings.some(gone))) return r;
  return { ...r, macros: r.macros.map(m => ({ ...m, mappings: m.mappings.filter(x => !gone(x)) })) };
}

/** Removes the mappings of a device (e.g. the instrument changed: the parameters are different) or
 *  of a rack's macros. */
export const withoutMappingsOf = (racks: RackList, device: DeviceKey): RackList =>
  racks.some(r => r.macros.some(m => m.mappings.some(x => x.device === device)))
    ? racks.map(r => withoutMappings(r, x => x.device === device))
    : racks;

/** Removes a parameter's mapping from the racks' macros, except those of rack `except`. */
export const withoutParam = (racks: RackList, device: DeviceKey, param: string, except?: DeviceId): RackList =>
  racks.map(r => (r.id === except ? r : withoutMappings(r, x => x.device === device && x.param === param)));

export function updateRack(racks: RackList, id: DeviceId, fn: (r: Rack) => Rack): RackList {
  if (!findRack(racks, id)) throw new RangeError(`rack ${id} not found`);
  return racks.map(r => (r.id === id ? { ...fn(r), id } : r));
}

export function updateMacro(r: Rack, index: number, fn: (m: Macro) => Macro): Rack {
  if (!Number.isInteger(index) || index < 0 || index >= MACRO_COUNT) throw new RangeError(`macro ${index + 1} doesn't exist`);
  return { ...r, macros: r.macros.map((m, i) => (i === index ? fn(m) : m)) };
}

/** Groups into a new rack some consecutive devices: free ones, of the same rack (the new one goes
 *  inside it) or whole racks (they go inside the new one), like Ctrl+G in Live. */
export function group(order: readonly DeviceKey[], racks: RackList, keys: readonly DeviceKey[], id: DeviceId): RackList {
  const sorted = [...new Set(keys)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (!sorted.length) throw new RangeError('no devices to group');
  if (sorted.some(k => !order.includes(k))) throw new RangeError('device not found');
  const first = order.indexOf(sorted[0]);
  if (sorted.some((k, i) => order[first + i] !== k)) throw new Error('only consecutive devices can be grouped');
  for (const r of racks) {
    const shared = r.devices.filter(k => sorted.includes(k)).length;
    if (shared && shared < r.devices.length && shared < sorted.length) {
      throw new Error('devices of the same rack can be grouped, or whole racks: not a piece of a rack with something outside');
    }
  }
  // with the same devices as an existing rack, the new one goes around it
  return outerFirst([newRack(id, sorted), ...racks]);
}

/** Ungroups a rack: those it had inside stay, its macros and the mappings on its macros disappear. */
export const ungroup = (racks: RackList, id: DeviceId): RackList => {
  if (!findRack(racks, id)) throw new RangeError(`rack ${id} not found`);
  return withoutMappingsOf(racks.filter(r => r.id !== id), id);
};

/** An element of the chain as it's seen: a device alone or a rack with its own. */
export type ChainItem =
  | { readonly kind: 'device'; readonly key: DeviceKey }
  | { readonly kind: 'rack'; readonly rack: Rack };

/** The elements of the chain, or those right inside a rack (`within`): the devices outside the
 *  racks and the outermost racks, each with its own. */
export function chainItems(order: readonly DeviceKey[], racks: RackList, within?: Rack): ChainItem[] {
  const keys = within ? within.devices : order;
  const level = within ? innerRacks(racks, within) : racks;
  const items: ChainItem[] = [];
  for (let i = 0; i < keys.length;) {
    const rack = level.filter(r => r.devices.includes(keys[i])).sort(outside(racks))[0];
    if (rack) {
      items.push({ kind: 'rack', rack });
      i += rack.devices.length;
    } else items.push({ kind: 'device', key: keys[i++] });
  }
  return items;
}

const keysOf = (item: ChainItem): readonly DeviceKey[] => (item.kind === 'rack' ? item.rack.devices : [item.key]);

/** The result of a move: the new order and the racks. */
export interface Layout {
  readonly order: readonly DeviceKey[];
  readonly racks: RackList;
}

/** Moves a device by one place (◂ ▸). Inside a rack it moves among its devices; from the rack's
 *  edge it leaves it (into the surrounding one, if any), and next to a rack it enters it, without changing the order
 *  of the sound (like dragging it in and out in Live). The only device of a rack drags
 *  the rack along. The instrument stays first. */
export function moveDevice(order: readonly DeviceKey[], racks: RackList, key: DeviceKey, dir: -1 | 1): Layout {
  const i = order.indexOf(key);
  if (i < 0) throw new RangeError(`device ${key} not found`);
  if (key === INSTRUMENT_DEVICE) return { order, racks };
  const rack = rackOf(racks, key);
  if (rack?.devices.length === 1) return moveRack(order, racks, rack.id, dir);
  const items = chainItems(order, racks, rack);
  const next = items[items.findIndex(x => x.kind === 'device' && x.key === key) + dir];
  if (!next) return rack ? { order, racks: updateRack(racks, rack.id, r => withoutMembers(r, [key])) } : { order, racks };
  if (next.kind === 'device' && next.key === INSTRUMENT_DEVICE) return { order, racks };
  // next to a rack it enters it, also an Instrument Rack with only the instrument
  if (next.kind === 'rack') {
    const devices = dir > 0 ? [key, ...next.rack.devices] : [...next.rack.devices, key];
    return { order, racks: outerFirst(updateRack(racks, next.rack.id, r => ({ ...r, devices }))) };
  }
  const moved = swap(order, i, order.indexOf(next.key));
  return { order: moved, racks: inOrder(moved, racks) };
}

/** Moves a whole rack past the element next to it (a device or another rack); from the edge
 *  of the rack it sits in it leaves it. The only rack of a rack drags the surrounding one along. */
export function moveRack(order: readonly DeviceKey[], racks: RackList, id: DeviceId, dir: -1 | 1): Layout {
  const rack = findRack(racks, id);
  if (!rack) throw new RangeError(`rack ${id} not found`);
  const parent = parentOf(racks, rack);
  const items = chainItems(order, racks, parent);
  const i = items.findIndex(x => x.kind === 'rack' && x.rack === rack);
  const next = items[i + dir];
  if (!next) {
    if (!parent) return { order, racks };
    if (parent.devices.length === rack.devices.length) return moveRack(order, racks, parent.id, dir);
    const gone = [...rack.devices, rack.id, ...innerRacks(racks, rack).map(r => r.id)];
    return { order, racks: updateRack(racks, parent.id, r => withoutMembers(r, gone)) };
  }
  const blocked = (x: ChainItem) => keysOf(x).includes(INSTRUMENT_DEVICE);
  if (blocked(items[i]) || blocked(next)) return { order, racks };
  const start = parent ? order.indexOf(parent.devices[0]) : 0;
  const region = swap(items, i, i + dir).flatMap(keysOf);
  const moved = [...order.slice(0, start), ...region, ...order.slice(start + region.length)];
  return { order: moved, racks: inOrder(moved, racks) };
}

/** Puts a rack inside the rack next to it (before or after, `dir`), at the end or at the start of its own: the
 *  sound doesn't change order. Without a rack next to it nothing changes. */
export function nestRack(order: readonly DeviceKey[], racks: RackList, id: DeviceId, dir: -1 | 1): Layout {
  const rack = findRack(racks, id);
  if (!rack) throw new RangeError(`rack ${id} not found`);
  const items = chainItems(order, racks, parentOf(racks, rack));
  const next = items[items.findIndex(x => x.kind === 'rack' && x.rack === rack) + dir];
  if (next?.kind !== 'rack') return { order, racks };
  const devices = dir > 0 ? [...rack.devices, ...next.rack.devices] : [...next.rack.devices, ...rack.devices];
  return { order, racks: outerFirst(updateRack(racks, next.rack.id, r => ({ ...r, devices }))) };
}

/** Adds a device at the end of a rack (and of the surrounding racks), right after the last of its own
 *  in the order `order`, which already has it. */
export function appendTo(racks: RackList, id: DeviceId, key: DeviceKey): RackList {
  const rack = findRack(racks, id);
  if (!rack) throw new RangeError(`rack ${id} not found`);
  const last = rack.devices.at(-1)!;
  const grows = new Set([rack, ...outerRacks(racks, rack)]);
  return outerFirst(racks.map(r => {
    if (!grows.has(r)) return r;
    const at = r.devices.indexOf(last) + 1;
    return { ...r, devices: [...r.devices.slice(0, at), key, ...r.devices.slice(at)] };
  }));
}

/** The rack without some devices or racks, and without their mappings. */
function withoutMembers(r: Rack, keys: readonly DeviceKey[]): Rack {
  const gone = new Set(keys);
  return withoutMappings({ ...r, devices: r.devices.filter(k => !gone.has(k)) }, x => gone.has(x.device));
}

/** The racks' devices in the new order of the chain. */
function inOrder(order: readonly DeviceKey[], racks: RackList): RackList {
  const at = new Map(order.map((k, i) => [k, i]));
  const sorted = (r: Rack) => r.devices.every((k, i) => i === 0 || at.get(r.devices[i - 1])! < at.get(k)!);
  return racks.map(r => (sorted(r) ? r : { ...r, devices: [...r.devices].sort((a, b) => at.get(a)! - at.get(b)!) }));
}

function swap<T>(list: readonly T[], i: number, j: number): T[] {
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
