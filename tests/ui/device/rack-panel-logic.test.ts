import { describe, expect, it, vi } from 'vitest';
import { MACRO_MAX, type MacroSpring, type Rack } from '../../../src/model/rack';
import type { RackPreset } from '../../../src/model/rack-preset';
import type { MidiTrack } from '../../../src/model/track';
import { addEffect } from '../../../src/store/edits';
import { groupDevices, nestRack } from '../../../src/store/rack-edits';
import type { MenuAction, MenuItem } from '../../../src/ui/context-menu';
import { RackLibrary, type RackShelf } from '../../../src/ui/device/rack-library';
import { innerMacroItems, macroMenu, paramChoices, paramItems, rackHeadMenu, springTimeMenu, type ParamChoices } from '../../../src/ui/device/rack-menus';
import { draggedRest, macroTitle, springTexts } from '../../../src/ui/device/rack-text';
import { setup } from '../../helpers/fixtures';

const label = (i: MenuItem) => {
  if (typeof i === 'string') return '—';
  const a = i as MenuAction;
  return `${a.disabled ? '(off) ' : ''}${a.checked ? '[x] ' : ''}${a.label}`;
};
const labels = (items: readonly MenuItem[]) => items.map(label);
const pick = (items: readonly MenuItem[], text: string) => (items.find(i => typeof i !== 'string' && (i as MenuAction).label === text) as MenuAction).run();

/** A MIDI track with [compressor, delay] grouped in a rack holding a rack with a reverb. */
function rig() {
  const s = setup({ midi: 1 });
  const t = s.track(0);
  for (const type of ['compressor', 'delay', 'reverb']) s.store.apply(addEffect(t, type, type));
  const track = () => s.store.project.tracks[0] as MidiTrack;
  const [comp, delay, reverb] = track().effects.map(e => e.id);
  s.store.apply(groupDevices(t, [reverb]));
  s.store.apply(groupDevices(t, [comp, delay]));
  const outerId = track().racks.find(r => r.devices.includes(comp))!.id, innerId = track().racks.find(r => r.devices.includes(reverb))!.id;
  s.store.apply(nestRack(t, innerId, -1));
  const rack = (id = outerId) => track().racks.find(r => r.id === id)!;
  return { ...s, t, comp, delay, reverb, rack, outerId, innerId };
}

describe('rack texts', () => {
  it('the macro\'s tooltip: what it moves or how to map it; a spring says how it returns', () => {
    expect(macroTitle('Cutoff', ['Filter · Freq', 'Drive · Amount'], false)).toBe('Cutoff: moves Filter · Freq, Drive · Amount');
    expect(macroTitle('Macro 1', [], false)).toBe('Macro 1: no mapped parameter (turn on Map, choose the macro and click a parameter)');
    expect(macroTitle('Macro 1', [], true)).toMatch(/\nSpring: released it returns to rest/);
  });

  it('a spring\'s rest and return; the rest dragged within the range, finer with Shift', () => {
    const s: MacroSpring = { rest: 12.6, time: 1, sync: true };
    expect(springTexts(s)).toEqual({ rest: '↺ 13', time: '1/4' });
    expect(draggedRest(0, 180, false)).toBe(MACRO_MAX);
    expect(draggedRest(64, 18, true)).toBeCloseTo(64 + MACRO_MAX / 100, 9);
    expect(draggedRest(10, -1000, false)).toBe(0);
  });
});

describe('rack menus', () => {
  it('the header: copy items, nesting before and after (off when there\'s no rack), the save items', () => {
    const nest = vi.fn();
    const clip: MenuItem[] = [{ label: 'Copy', run: () => {} }];
    const items = rackHeadMenu(clip, dir => dir === 1, nest, [{ label: 'Save the rack…', run: () => {} }]);
    expect(labels(items)).toEqual(['Copy', '—', '(off) Put in the rack before', 'Put in the rack after', '—', 'Save the rack…']);
    pick(items, 'Put in the rack after');
    pick(items, 'Put in the rack before');
    expect(nest.mock.calls).toEqual([[1], [-1]]);
    expect(labels(rackHeadMenu([], () => false, nest, []))).toEqual(['(off) Put in the rack before', '(off) Put in the rack after', '—']);
  });

  it('a macro: rename, automatic name (only if named), the modes with the current one checked, Map…, the outer racks', () => {
    const calls: string[] = [];
    const a = (named: boolean, outer: MenuItem[] = []) => ({
      first: [], named, mode: 'toggle' as const, outer,
      rename: () => calls.push('rename'), autoName: () => calls.push('auto'), setMode: (m: string) => calls.push(`mode ${m}`), map: () => calls.push('map'),
    });
    const items = macroMenu(a(true, [{ label: 'Outer macro', run: () => calls.push('outer') }]));
    expect(labels(items)).toEqual(['Rename the macro', 'Automatic name', '—', 'Knob', '[x] Toggle', 'Button', 'Spring', '—', 'Map…', '—', 'Outer macro']);
    for (const text of ['Rename the macro', 'Automatic name', 'Spring', 'Map…', 'Outer macro']) pick(items, text);
    expect(calls).toEqual(['rename', 'auto', 'mode spring', 'map', 'outer']);
    expect(labels(macroMenu(a(false)))[1]).toBe('(off) Automatic name');
  });

  it('a spring\'s return times: in time, then in milliseconds, the current one checked, then More…', () => {
    const chosen = vi.fn(), more = vi.fn();
    const items = springTimeMenu({ rest: 0, time: 250, sync: false }, chosen, more);
    expect(labels(items)).toContain('[x] 250 ms');
    expect(labels(items)).toContain('1/4');
    expect(labels(items).at(-1)).toBe('More…');
    pick(items, '1 bar');
    pick(items, 'More…');
    expect(chosen).toHaveBeenCalledWith(4, true);
    expect(more).toHaveBeenCalled();
  });

  it('+ Parameter: the rack\'s devices, then the racks inside; their parameters (with sections) and macros, checked if mapped', () => {
    const r = rig();
    const opened: MenuItem[][] = [], mapped: string[] = [];
    const c: ParamChoices = {
      project: r.store.project, owner: r.t, rack: r.rack(), deviceLabel: key => `dev ${String(key).slice(0, 4)}`,
      mapped: (device, param) => device === r.comp && param === 'threshold',
      map: (device, param) => mapped.push(`${device === r.comp ? 'comp' : 'inner'} ${param}`),
      open: items => opened.push(items),
    };
    const first = paramChoices(c), devices = r.rack().devices;
    // the devices (the nested rack among them, not a device: off), a separator, the rack inside
    expect(first).toHaveLength(devices.length + 2);
    expect(label(first[devices.length])).toBe('—');
    expect(devices[0]).toBe(r.comp);
    (first[0] as MenuAction).run();
    expect(labels(opened[0])).toContain('[x] Curve · Threshold');
    pick(opened[0], 'Curve · Ratio');
    (first.at(-1) as MenuAction).run();
    expect(labels(opened[1])).toHaveLength(8);
    (opened[1][0] as MenuAction).run();
    expect(mapped).toEqual(['comp ratio', 'inner macro1']);
    expect(innerMacroItems(c, r.rack(r.innerId))).toHaveLength(8);
    expect(paramItems(c, 'instrument').length).toBeGreaterThan(0);
    expect(paramItems({ ...c, owner: 'master' }, r.comp)).toEqual([]);
    const lone: Rack = r.rack(r.innerId);
    expect(paramChoices({ ...c, rack: lone }).map(label)).not.toContain('—');
  });
});

describe('saved racks', () => {
  function shelf(opts: { fail?: boolean } = {}) {
    const kept = new Map<string, RackPreset>(), log: string[] = [];
    const s: RackShelf = {
      has: name => kept.has(name),
      save: async rack => {
        if (opts.fail) throw new Error('disk full');
        kept.set(rack.name, rack);
        log.push(`save ${rack.name}`);
      },
      remove: async name => {
        if (opts.fail) throw new Error('read only');
        kept.delete(name);
        log.push(`remove ${name}`);
      },
      canReveal: true,
      reveal: async () => { throw new Error('no folder'); },
    };
    return { s, kept, log };
  }

  it('saving takes the name and says where it is; again it says updated; delete; errors said', async () => {
    const r = rig(), said: string[] = [], { s, kept, log } = shelf();
    const lib = new RackLibrary({ store: r.store, owner: r.t, rack: r.rack(), say: t => said.push(t), shelf: s });
    const ask = vi.fn();
    const menu = lib.menu(ask);
    expect(labels(menu)).toEqual(['Save the rack…', `(off) Update the saved rack «${'Audio Effect Rack'}»`, `(off) Delete the saved rack «Audio Effect Rack»`, 'Open the racks folder']);
    pick(menu, 'Save the rack…');
    expect(ask).toHaveBeenCalled();
    await lib.save('Wide');
    expect(r.rack().name).toBe('Wide');
    expect(kept.has('Wide')).toBe(true);
    await lib.save('Wide');
    expect(said).toEqual(['Rack «Wide» saved: you\'ll find it in the browser, in all projects.', 'Rack «Wide» updated.']);
    await lib.remove('Wide');
    expect(said.at(-1)).toBe('Saved rack «Wide» deleted (the one in the project stays).');
    pick(menu, 'Open the racks folder');
    await new Promise(res => setTimeout(res, 0));
    expect(said.at(-1)).toBe('no folder');
    // the menu's update and delete work on the name the panel was built with
    pick(menu, 'Update the saved rack «Audio Effect Rack»');
    await new Promise(res => setTimeout(res, 0));
    expect(log.at(-1)).toBe('save Audio Effect Rack');
    pick(menu, 'Delete the saved rack «Audio Effect Rack»');
    await new Promise(res => setTimeout(res, 0));
    expect(log.at(-1)).toBe('remove Audio Effect Rack');
  });

  it('a failing shelf: nothing renamed, the error said', async () => {
    const r = rig(), said: string[] = [], { s } = shelf({ fail: true });
    const lib = new RackLibrary({ store: r.store, owner: r.t, rack: r.rack(), say: t => said.push(t), shelf: { ...s, canReveal: false } });
    expect(lib.menu(() => {})).toHaveLength(3);
    await lib.save('X');
    await lib.remove('X');
    expect(r.rack().name).not.toBe('X');
    expect(said).toEqual(['Couldn\'t save the rack «X»: disk full', 'Couldn\'t delete the rack «X»: read only']);
  });
});
