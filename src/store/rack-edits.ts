/* Modifiche dei rack: raggruppare e separare dispositivi, spostarli dentro e fuori, girare le
 * macro e mapparle sui parametri. Una macro scrive i parametri che muove nei dispositivi (e le
 * macro dei rack che ha dentro, che a loro volta muovono i loro): il motore suona i parametri
 * come sempre e non sa nulla dei rack. */
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

/** Scrive dei parametri in un dispositivo della catena. */
function withDeviceParams(p: Project, owner: ChainOwner, key: DeviceKey, values: ParamValues): Project {
  if (key !== INSTRUMENT_DEVICE) return p.updatingEffects(owner, list => chain.update(list, key, e => withParams(e, values)));
  if (owner === MASTER) throw new TypeError('il master non ha uno strumento');
  return p.updatingTrack(owner, t => {
    if (!(t instanceof MidiTrack)) throw new TypeError(`la traccia ${t.name} non ha uno strumento`);
    return t.withInstrument(withParams(t.instrument, values));
  });
}

/** Porta i parametri mappati di una macro al valore che la macro dà loro; le macro dei rack
 *  dentro portano a loro volta i loro. */
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

/** La macro a `value` (un interruttore o un pulsante scatta), senza toccare i parametri. */
const withValue = (p: Project, owner: ChainOwner, id: DeviceId, index: number, value: number): Project =>
  p.updatingRacks(owner, racks => updateRack(racks, id, r => updateMacro(r, index, m => {
    const v = macroValueFor(macroMode(m), value);
    return m.value === v ? m : { ...m, value: v };
  })));

/** Riporta i parametri mappati ai valori delle macro di tutti i rack della catena (es. dopo un
 *  preset che li ha cambiati). */
export function reapplyMacros(p: Project, owner: ChainOwner): Project {
  for (const r of p.racksOf(owner)) for (const m of r.macros) p = applyMacro(p, owner, m);
  return p;
}

function requireRack(p: Project, owner: ChainOwner, id: DeviceId): Rack {
  const r = findRack(p.racksOf(owner), id);
  if (!r) throw new RangeError(`rack ${id} non trovato`);
  return r;
}

/** Una nuova disposizione della catena: gli effetti nel nuovo ordine e i rack. */
function layingOut(p: Project, owner: ChainOwner, fn: (order: readonly DeviceKey[], racks: RackList) => Layout): Project {
  const { order, racks } = fn(p.chainKeys(owner), p.racksOf(owner));
  return p.updatingChain(owner, c => {
    const at = new Map(order.map((k, i) => [k, i]));
    const effects = [...c.effects].sort((a, b) => at.get(a.id)! - at.get(b.id)!);
    const same = effects.every((e, i) => e === c.effects[i]);
    return { effects: same ? c.effects : effects, racks };
  });
}

// ------------------------------------------------------------------ gruppi

/** Raggruppa in un rack dei dispositivi di seguito (Ctrl+G in Live). */
export const groupDevices = (owner: ChainOwner, keys: readonly DeviceKey[]): Edit =>
  edit('Raggruppa in un rack', (p, { ids }) => p.updatingRacks(owner, racks => group(p.chainKeys(owner), racks, keys, ids.next('device'))));

/** Separa un rack: i dispositivi restano dove sono, le macro e le mappature spariscono. */
export const ungroupRack = (owner: ChainOwner, id: DeviceId): Edit =>
  edit('Separa il rack', p => p.updatingRacks(owner, racks => ungroup(racks, id)));

/** Elimina un rack con i suoi effetti e i rack che ha dentro (un rack con lo strumento si può
 *  solo separare). */
export const removeRack = (owner: ChainOwner, id: DeviceId): Edit =>
  edit('Elimina rack', p => {
    const rack = requireRack(p, owner, id);
    if (rack.devices.includes(INSTRUMENT_DEVICE)) throw new Error('un rack con lo strumento non si elimina: si può separare');
    const gone = new Set<DeviceKey>(rack.devices);
    return p.updatingEffects(owner, list => list.filter(e => !gone.has(e.id)));
  });

/** Sposta un dispositivo di un posto, entrando e uscendo dai rack (vedi rack.moveDevice). */
export const moveDevice = (owner: ChainOwner, key: DeviceKey, dir: -1 | 1): Edit =>
  edit('Sposta dispositivo', p => layingOut(p, owner, (order, racks) => moveInLayout(order, racks, key, dir)));

export const moveRack = (owner: ChainOwner, id: DeviceId, dir: -1 | 1): Edit =>
  edit('Sposta rack', p => layingOut(p, owner, (order, racks) => moveRackInLayout(order, racks, id, dir)));

/** Mette un rack dentro il rack accanto, prima (−1) o dopo (+1). */
export const nestRack = (owner: ChainOwner, id: DeviceId, dir: -1 | 1): Edit =>
  edit('Metti nel rack', p => layingOut(p, owner, (order, racks) => nestRackInLayout(order, racks, id, dir)));

/** Aggiunge un effetto in fondo al rack. */
export const addEffectToRack = (owner: ChainOwner, id: DeviceId, type: string, label: string): Edit =>
  edit(`Aggiungi ${label}`, (p, { ids }) => {
    const rack = requireRack(p, owner, id);
    const effect = newEffect(ids.next('device'), type);
    const last = rack.devices.at(-1)!;
    return p.updatingChain(owner, c => ({
      effects: chain.add(c.effects, effect, last === INSTRUMENT_DEVICE ? 0 : c.effects.findIndex(e => e.id === last) + 1),
      racks: appendTo(c.racks, id, effect.id),
    }));
  });

export const renameRack = (owner: ChainOwner, id: DeviceId, name: string | null): Edit =>
  edit('Rinomina rack', p => p.updatingRacks(owner, racks => updateRack(racks, id, r => ({ ...r, name }))));

// ------------------------------------------------------------------ macro

/** Gira una macro (0 … 127): i parametri mappati la seguono. Un interruttore o un pulsante
 *  scatta: da metà in su è acceso (127), sotto spento (0). */
export const setMacro = (owner: ChainOwner, id: DeviceId, index: number, value: number): Edit =>
  edit('Macro', p => withMacroValue(p, owner, id, index, value));

/** Una macro mappata su una macro di un rack intorno non si gira: la muove quella. */
function withMacroValue(p: Project, owner: ChainOwner, id: DeviceId, index: number, value: number): Project {
  if (macroOf(p.racksOf(owner), id, macroParam(index))) return p;
  const next = withValue(p, owner, id, index, value);
  return next === p ? p : applyMacro(next, owner, requireRack(next, owner, id).macros[index]);
}

/** Cambia il tipo di una macro. Diventando interruttore scatta al capo più vicino; un pulsante
 *  parte spento (si accende solo mentre lo si tiene premuto); una molla riposa dov'è (e torna in
 *  1/4), e smettendo di esserlo resta al suo riposo. */
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

/** Il riposo o il tempo di ritorno di una macro molla. Il riposo nuovo è anche il suo valore:
 *  una molla ferma sta al riposo. */
export const setMacroSpring = (owner: ChainOwner, id: DeviceId, index: number, patch: Partial<MacroSpring>): Edit =>
  edit(patch.rest !== undefined ? 'Riposo della molla' : 'Ritorno della molla', p => {
    const next = p.updatingRacks(owner, racks => updateRack(racks, id, r => updateMacro(r, index, m => {
      const s = springOf(m);
      if (!s) throw new TypeError('la macro non è una molla');
      const spring = springFor(patch.rest ?? s.rest, patch.time ?? s.time, patch.sync ?? s.sync);
      if (spring.rest === s.rest && spring.time === s.time && spring.sync === s.sync && m.spring) return m;
      return { ...m, spring, ...(patch.rest !== undefined ? { value: spring.rest } : {}) };
    })));
    return next === p ? p : applyMacro(next, owner, requireRack(next, owner, id).macros[index]);
  });

/** Il progetto con ogni macro molla al suo riposo (e i parametri dove li porta): ciò che si
 *  salva, anche se nel frattempo una molla è tirata o sta tornando. */
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
  edit('Rinomina macro', p => p.updatingRacks(owner, racks => updateRack(racks, id, r => updateMacro(r, index, m => ({ ...m, name })))));

/** Mappa un parametro di un dispositivo del rack (anche dentro un rack che ha dentro), o la
 *  macro di un rack che ha dentro (`device` il rack, `param` "macroN"), su una macro, su tutta la
 *  sua corsa. Se la macro non muoveva ancora niente prende la posizione del parametro (niente
 *  salti); altrimenti il parametro va dove la macro lo porta. Un parametro mappato su un'altra
 *  macro ci si sposta. Un interruttore (una scelta Off/On) su una manopola vuota la fa diventare
 *  un interruttore. */
export const mapMacro = (owner: ChainOwner, id: DeviceId, index: number, device: DeviceKey, param: string): Edit =>
  edit('Mappa sulla macro', p => {
    const rack = requireRack(p, owner, id);
    const inner = innerRacks(p.racksOf(owner), rack).some(r => r.id === device);
    if (!rack.devices.includes(device) && !inner) throw new Error('si mappano solo parametri dei dispositivi del rack, o le macro dei rack che ha dentro');
    const spec = mappingSpec(p, owner, { device, param });
    if (!spec) throw new RangeError(`parametro ${param} non trovato`);
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

/** Toglie un parametro dalla sua macro (resta al valore che ha). */
export const unmapParam = (owner: ChainOwner, device: DeviceKey, param: string): Edit =>
  edit('Togli dalla macro', p => {
    const found = macroOf(p.racksOf(owner), device, param);
    if (!found) return p;
    return p.updatingRacks(owner, racks => updateRack(racks, found.rack.id, r => updateMacro(r, found.index, m => ({
      ...m, mappings: m.mappings.filter(x => x.device !== device || x.param !== param),
    }))));
  });

/** Cambia minimo e/o massimo di una mappatura; il parametro segue subito. */
export const setMappingRange = (owner: ChainOwner, device: DeviceKey, param: string, range: { min?: number; max?: number }): Edit =>
  edit('Corsa della macro', p => {
    const found = macroOf(p.racksOf(owner), device, param);
    if (!found) throw new RangeError(`il parametro ${param} non è mappato`);
    const next = p.updatingRacks(owner, racks => updateRack(racks, found.rack.id, r => updateMacro(r, found.index, m => ({
      ...m, mappings: m.mappings.map(x => (x.device === device && x.param === param ? { ...x, ...range } : x)),
    }))));
    return applyMacro(next, owner, requireRack(next, owner, found.rack.id).macros[found.index]);
  });
