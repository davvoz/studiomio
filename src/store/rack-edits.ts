/* Rack edits: grouping and ungrouping devices, moving them in and out, turning the
 * macros and mapping them to parameters. A macro writes the parameters it moves into the devices (and the
 * macros of the racks it has inside, which in turn move theirs): the engine plays the parameters
 * as always and knows nothing of the racks. */
import type { DeviceId } from '../core/id';
import { clampParam, paramToUnit } from '../devices/params';
import { mappedParamValue, mappedValue, mappingSpec } from '../devices/rack-params';
import { newEffect, withParams, type ParamValues } from '../model/device';
import * as chain from '../model/effect-list';
import { INSTRUMENT_DEVICE } from '../model/envelope';
import { MASTER, type ChainOwner, type Project } from '../model/project';
import {
  appendTo, findRack, group, innerRacks, MACRO_MAX, MACRO_MODES, macroIndex, macroMode, macroOf, macroParam, macroValueFor,
  moveDevice as moveInLayout, moveRack as moveRackInLayout, nestRack as nestRackInLayout, springFor, springOf, ungroup, updateMacro,
  updateRack, withoutParam, type DeviceKey, type Layout, type Macro, type MacroMapping, type MacroMode, type MacroSpring, type Rack,
  type RackList,
} from '../model/rack';
import { MidiTrack } from '../model/track';
import { edit, type Edit } from './project-store';

/** Writes some parameters into a device of the chain. */
function withDeviceParams(p: Project, owner: ChainOwner, key: DeviceKey, values: ParamValues): Project {
  if (key !== INSTRUMENT_DEVICE) return p.updatingEffects(owner, list => chain.update(list, key, e => withParams(e, values)));
  if (owner === MASTER) throw new TypeError('the master has no instrument');
  return p.updatingTrack(owner, t => {
    if (!(t instanceof MidiTrack)) throw new TypeError(`the track ${t.name} has no instrument`);
    return t.withInstrument(withParams(t.instrument, values));
  });
}

/** Brings a macro's mapped parameters to the value the macro gives them; the macros of the inner racks
 *  in turn bring theirs. */
function applyMacro(p: Project, owner: ChainOwner, macro: Macro): Project {
  const byDevice = new Map<DeviceKey, Record<string, number>>();
  const inner: [rack: DeviceId, index: number, value: number][] = [];
  for (const m of macro.mappings) {
    const spec = mappingSpec(p, owner, m);
    if (!spec) continue;
    const value = mappedValue(spec, m, macro.value);
    if (findRack(p.racksOf(owner), m.device as DeviceId)) inner.push([m.device as DeviceId, macroIndex(m.param), value]);
    else {
      if (!byDevice.has(m.device)) byDevice.set(m.device, {});
      byDevice.get(m.device)![m.param] = value;
    }
  }
  for (const [key, values] of byDevice) p = withDeviceParams(p, owner, key, values);
  for (const [id, index, value] of inner) {
    p = withValue(p, owner, id, index, value);
    p = applyMacro(p, owner, requireRack(p, owner, id).macros[index]);
  }
  return p;
}

/** The macro at `value` (a toggle or a button snaps), without touching the parameters. */
const withValue = (p: Project, owner: ChainOwner, id: DeviceId, index: number, value: number): Project =>
  p.updatingRacks(owner, racks => updateRack(racks, id, r => updateMacro(r, index, m => {
    const v = macroValueFor(macroMode(m), value);
    return m.value === v ? m : { ...m, value: v };
  })));

/** Brings the mapped parameters back to the values of the macros of all the chain's racks (e.g. after a
 *  preset that changed them). */
export function reapplyMacros(p: Project, owner: ChainOwner): Project {
  for (const r of p.racksOf(owner)) for (const m of r.macros) p = applyMacro(p, owner, m);
  return p;
}

function requireRack(p: Project, owner: ChainOwner, id: DeviceId): Rack {
  const r = findRack(p.racksOf(owner), id);
  if (!r) throw new RangeError(`rack ${id} not found`);
  return r;
}

/** A new layout of the chain: the effects in the new order and the racks. */
function layingOut(p: Project, owner: ChainOwner, fn: (order: readonly DeviceKey[], racks: RackList) => Layout): Project {
  const { order, racks } = fn(p.chainKeys(owner), p.racksOf(owner));
  return p.updatingChain(owner, c => {
    const at = new Map(order.map((k, i) => [k, i]));
    const effects = [...c.effects].sort((a, b) => at.get(a.id)! - at.get(b.id)!);
    const same = effects.every((e, i) => e === c.effects[i]);
    return { effects: same ? c.effects : effects, racks };
  });
}

// ------------------------------------------------------------------ groups

/** Groups some consecutive devices into a rack (Ctrl+G in Live). */
export const groupDevices = (owner: ChainOwner, keys: readonly DeviceKey[]): Edit =>
  edit('Group into a rack', (p, { ids }) => p.updatingRacks(owner, racks => group(p.chainKeys(owner), racks, keys, ids.next('device'))));

/** Ungroups a rack: the devices stay where they are, the macros and the mappings disappear. */
export const ungroupRack = (owner: ChainOwner, id: DeviceId): Edit =>
  edit('Ungroup the rack', p => p.updatingRacks(owner, racks => ungroup(racks, id)));

/** Deletes a rack with its effects and the racks it has inside (a rack with the instrument can
 *  only be ungrouped). */
export const removeRack = (owner: ChainOwner, id: DeviceId): Edit =>
  edit('Delete rack', p => {
    const rack = requireRack(p, owner, id);
    if (rack.devices.includes(INSTRUMENT_DEVICE)) throw new Error('a rack with the instrument can\'t be deleted: it can be ungrouped');
    const gone = new Set<DeviceKey>(rack.devices);
    return p.updatingEffects(owner, list => list.filter(e => !gone.has(e.id)));
  });

/** Moves a device by one place, entering and leaving racks (see rack.moveDevice). */
export const moveDevice = (owner: ChainOwner, key: DeviceKey, dir: -1 | 1): Edit =>
  edit('Move device', p => layingOut(p, owner, (order, racks) => moveInLayout(order, racks, key, dir)));

export const moveRack = (owner: ChainOwner, id: DeviceId, dir: -1 | 1): Edit =>
  edit('Move rack', p => layingOut(p, owner, (order, racks) => moveRackInLayout(order, racks, id, dir)));

/** Puts a rack inside the rack next to it, before (−1) or after (+1). */
export const nestRack = (owner: ChainOwner, id: DeviceId, dir: -1 | 1): Edit =>
  edit('Put in the rack', p => layingOut(p, owner, (order, racks) => nestRackInLayout(order, racks, id, dir)));

/** Adds an effect at the end of the rack. */
export const addEffectToRack = (owner: ChainOwner, id: DeviceId, type: string, label: string): Edit =>
  edit(`Add ${label}`, (p, { ids }) => {
    const rack = requireRack(p, owner, id);
    const effect = newEffect(ids.next('device'), type);
    const last = rack.devices.at(-1)!;
    return p.updatingChain(owner, c => ({
      effects: chain.add(c.effects, effect, last === INSTRUMENT_DEVICE ? 0 : c.effects.findIndex(e => e.id === last) + 1),
      racks: appendTo(c.racks, id, effect.id),
    }));
  });

export const renameRack = (owner: ChainOwner, id: DeviceId, name: string | null): Edit =>
  edit('Rename rack', p => p.updatingRacks(owner, racks => updateRack(racks, id, r => ({ ...r, name }))));

// ------------------------------------------------------------------ macro

/** Turns a macro (0 … 127): the mapped parameters follow it. A toggle or a button
 *  snaps: from halfway up it's on (127), below off (0). */
export const setMacro = (owner: ChainOwner, id: DeviceId, index: number, value: number): Edit =>
  edit('Macro', p => withMacroValue(p, owner, id, index, value));

/** A macro mapped to a macro of a surrounding rack can't be turned: that one moves it. */
function withMacroValue(p: Project, owner: ChainOwner, id: DeviceId, index: number, value: number): Project {
  if (macroOf(p.racksOf(owner), id, macroParam(index))) return p;
  const next = withValue(p, owner, id, index, value);
  return next === p ? p : applyMacro(next, owner, requireRack(next, owner, id).macros[index]);
}

/** Changes a macro's kind. Becoming a toggle it snaps to the nearest end; a button
 *  starts off (it lights up only while held down); a spring rests where it is (and returns in
 *  1/4), and when it stops being one it stays at its rest. */
export const setMacroMode = (owner: ChainOwner, id: DeviceId, index: number, mode: MacroMode): Edit =>
  edit(`Macro: ${MACRO_MODES.find(([m]) => m === mode)?.[1] ?? mode}`, p => {
    const next = p.updatingRacks(owner, racks => updateRack(racks, id, r => updateMacro(r, index, m => {
      if (macroMode(m) === mode) return m;
      const from = springOf(m)?.rest ?? m.value;
      const value = mode === 'button' ? 0 : macroValueFor(mode, from);
      const { mode: _old, spring: _spring, ...rest } = m;
      if (mode === 'spring') return { ...rest, value, mode, spring: springFor(value, 1, true) };
      return mode === 'knob' ? { ...rest, value } : { ...rest, value, mode };
    })));
    return next === p ? p : applyMacro(next, owner, requireRack(next, owner, id).macros[index]);
  });

/** The rest or the return time of a spring macro. The new rest is also its value:
 *  a still spring sits at rest. */
export const setMacroSpring = (owner: ChainOwner, id: DeviceId, index: number, patch: Partial<MacroSpring>): Edit =>
  edit(patch.rest !== undefined ? 'Spring rest' : 'Spring return', p => {
    const next = p.updatingRacks(owner, racks => updateRack(racks, id, r => updateMacro(r, index, m => {
      const s = springOf(m);
      if (!s) throw new TypeError('the macro isn\'t a spring');
      const spring = springFor(patch.rest ?? s.rest, patch.time ?? s.time, patch.sync ?? s.sync);
      if (spring.rest === s.rest && spring.time === s.time && spring.sync === s.sync && m.spring) return m;
      return { ...m, spring, ...(patch.rest !== undefined ? { value: spring.rest } : {}) };
    })));
    return next === p ? p : applyMacro(next, owner, requireRack(next, owner, id).macros[index]);
  });

/** The project with every spring macro at its rest (and the parameters where it takes them): what's
 *  saved, even if meanwhile a spring is pulled or returning. */
export function springsAtRest(p: Project): Project {
  const owners: ChainOwner[] = [...p.channels.map(t => t.id), MASTER];
  for (const owner of owners) {
    for (const r of p.racksOf(owner)) {
      r.macros.forEach((m, index) => {
        const s = springOf(m);
        if (s && m.value !== s.rest) p = withMacroValue(p, owner, r.id, index, s.rest);
      });
    }
  }
  return p;
}

export const renameMacro = (owner: ChainOwner, id: DeviceId, index: number, name: string | null): Edit =>
  edit('Rename macro', p => p.updatingRacks(owner, racks => updateRack(racks, id, r => updateMacro(r, index, m => ({ ...m, name })))));

/** Maps a parameter of a device of the rack (also inside a rack it has inside), or the
 *  macro of a rack it has inside (`device` the rack, `param` "macroN"), to a macro, over its whole
 *  travel. If the macro didn't move anything yet it takes the parameter's position (no
 *  jumps); otherwise the parameter goes where the macro takes it. A parameter mapped to another
 *  macro moves over. A switch (an Off/On choice) on an empty knob turns it into
 *  a toggle. */
export const mapMacro = (owner: ChainOwner, id: DeviceId, index: number, device: DeviceKey, param: string): Edit =>
  edit('Map to the macro', p => {
    const rack = requireRack(p, owner, id);
    const inner = innerRacks(p.racksOf(owner), rack).some(r => r.id === device);
    if (!rack.devices.includes(device) && !inner) throw new Error('only parameters of the rack\'s devices can be mapped, or the macros of the racks it has inside');
    const spec = mappingSpec(p, owner, { device, param });
    if (!spec) throw new RangeError(`parameter ${param} not found`);
    const mapping: MacroMapping = spec.kind === 'number'
      ? { device, param, min: spec.min, max: spec.max }
      : { device, param, min: 0, max: spec.options.length - 1 };
    const current = mappedParamValue(p, owner, { device, param }) ?? spec.default;
    const next = p.updatingRacks(owner, racks => updateRack(withoutParam(racks, device, param, id), id, r => ({
      ...r,
      macros: r.macros.map((m, i) => {
        const others = m.mappings.filter(x => x.device !== device || x.param !== param);
        if (i !== index) return others.length === m.mappings.length ? m : { ...m, mappings: others };
        const value = others.length ? m.value : paramToUnit(spec, clampParam(spec, current)) * MACRO_MAX;
        const toggle = !others.length && !m.mode && spec.kind === 'choice' && spec.options.length === 2;
        return toggle
          ? { ...m, mode: 'toggle' as const, value: macroValueFor('toggle', value), mappings: [...others, mapping] }
          : { ...m, value: macroValueFor(macroMode(m), value), mappings: [...others, mapping] };
      }),
    })));
    return applyMacro(next, owner, requireRack(next, owner, id).macros[index]);
  });

/** Removes a parameter from its macro (it stays at the value it has). */
export const unmapParam = (owner: ChainOwner, device: DeviceKey, param: string): Edit =>
  edit('Remove from the macro', p => {
    const found = macroOf(p.racksOf(owner), device, param);
    if (!found) return p;
    return p.updatingRacks(owner, racks => updateRack(racks, found.rack.id, r => updateMacro(r, found.index, m => ({
      ...m, mappings: m.mappings.filter(x => x.device !== device || x.param !== param),
    }))));
  });

/** Changes minimum and/or maximum of a mapping; the parameter follows right away. */
export const setMappingRange = (owner: ChainOwner, device: DeviceKey, param: string, range: { min?: number; max?: number }): Edit =>
  edit('Macro range', p => {
    const found = macroOf(p.racksOf(owner), device, param);
    if (!found) throw new RangeError(`parameter ${param} isn't mapped`);
    const next = p.updatingRacks(owner, racks => updateRack(racks, found.rack.id, r => updateMacro(r, found.index, m => ({
      ...m, mappings: m.mappings.map(x => (x.device === device && x.param === param ? { ...x, ...range } : x)),
    }))));
    return applyMacro(next, owner, requireRack(next, owner, found.rack.id).macros[found.index]);
  });
