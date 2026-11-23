import { describe, expect, it } from 'vitest';
import type { DeviceId } from '../../../src/core/id';
import { MASTER } from '../../../src/model/project';
import { macroParam, type DeviceKey } from '../../../src/model/rack';
import { Clipboard } from '../../../src/store/clipboard';
import { addEffect, setModTarget } from '../../../src/store/edits';
import { groupDevices, mapMacro } from '../../../src/store/rack-edits';
import { SEPARATOR, type MenuAction, type MenuItem } from '../../../src/ui/context-menu';
import { ChainFolds } from '../../../src/ui/device/chain-folds';
import {
  MASTER_COLOR, chainSource, deviceLabels, modTargetChoices, modTargetLabel, modulatedParams, sameModTarget, shapeOf,
} from '../../../src/ui/device/chain-labels';
import { DEVICE_KEYS, DeviceCommands, copiedMessage } from '../../../src/ui/device/device-commands';
import {
  clipboardMenu, deviceHeadMenu, effectChoices, emptyChainMenu, mapMenu, modulationMenu, outerMacroMenu, paramMenu, type DeviceMenuDeps,
} from '../../../src/ui/device/device-menus';
import { DeviceSelection, lastInChain } from '../../../src/ui/device/device-selection';
import { controlClick, deviceMappable, freeParams, keyGoesToMacro, macroMark, mappingInto, mapsInto, paramMark } from '../../../src/ui/device/macro-mapping';
import { setup } from '../../helpers/fixtures';

const actions = (items: readonly MenuItem[]): MenuAction[] => items.filter((i): i is MenuAction => i !== SEPARATOR && 'label' in i);
const labels = (items: readonly MenuItem[]) => actions(items).map(i => (i.disabled ? `(off) ${i.label}` : i.label) + (i.checked ? ' ✓' : ''));
const run = (items: readonly MenuItem[], label: string) => actions(items).find(i => i.label === label)!.run();

/** A MIDI track with Delay, EQ, Delay, LFO; Delay and EQ in a rack, the first Delay's feedback on macro 1. */
function chain() {
  const { store, track } = setup({ midi: 1 });
  const owner = track(0);
  for (const [type, label] of [['delay', 'Delay'], ['eq', 'EQ'], ['delay', 'Delay'], ['lfo', 'LFO']]) store.apply(addEffect(owner, type, label));
  const fx = store.project.track(owner)!.effects.map(e => e.id);
  store.apply(groupDevices(owner, [fx[0], fx[1]]));
  const rack = store.project.racksOf(owner)[0];
  store.apply(mapMacro(owner, rack.id, 0, fx[0], 'feedback'));
  const said: string[] = [];
  let shown = 0, open: typeof owner | null = owner;
  const clipboard = new Clipboard();
  const selection = new DeviceSelection(() => store.project, () => open);
  const commands = new DeviceCommands({ store, clipboard, say: t => said.push(t) }, selection, () => open, () => { shown++; });
  const automation: string[] = [];
  const menus: DeviceMenuDeps = { store, clipboard, commands, showAutomation: (_o, t) => automation.push(JSON.stringify(t)) };
  return {
    store, owner, fx, rack: rack.id, said, clipboard, selection, commands, menus, automation,
    racks: () => store.project.racksOf(owner),
    effects: () => store.project.track(owner)!.effects.map(e => e.type).join(','),
    close: () => { open = null; },
    get shown() { return shown; },
  };
}

describe('chain labels', () => {
  it('the source: a track\'s chain or the master\'s; null for a track that is gone', () => {
    const c = chain();
    expect(chainSource(c.store.project, c.owner)?.effects).toHaveLength(4);
    expect(chainSource(c.store.project, MASTER)).toMatchObject({ name: 'Master', color: MASTER_COLOR, track: null });
    expect(chainSource(c.store.project, 'gone' as never)).toBeNull();
  });

  it('names: the second device of a type is numbered, racks by name', () => {
    const c = chain();
    const names = deviceLabels(c.store.project, c.owner);
    expect([names.get(c.fx[0]), names.get(c.fx[2]), names.get(c.fx[3])]).toEqual(['Delay', 'Delay 2', 'LFO']);
    expect(names.get(c.rack)).toBeTruthy();
  });

  it('the shape changes with the devices, the racks and how they are shown, not with values', () => {
    const c = chain();
    const shape = () => shapeOf(c.owner, chainSource(c.store.project, c.owner)!, '');
    const before = shape();
    expect(shapeOf(c.owner, chainSource(c.store.project, c.owner)!, 'x')).not.toBe(before);
    c.store.apply(addEffect(c.owner, 'eq', 'EQ'));
    expect(shape()).not.toBe(before);
  });

  it('modulation targets: same target, names, choices, the controls they move', () => {
    const c = chain();
    const t = { kind: 'device', device: c.fx[2], param: 'mix' } as const;
    expect(sameModTarget(t, { ...t })).toBe(true);
    expect(sameModTarget(t, { ...t, param: 'time' })).toBe(false);
    expect(sameModTarget({ kind: 'mixer', param: 'pan' }, { kind: 'mixer', param: 'pan' })).toBe(true);
    expect(modTargetLabel(c.store.project, c.owner, t)).toMatch(/^Delay 2 · /);
    expect(modTargetLabel(c.store.project, c.owner, { kind: 'mixer', param: 'volume' })).toBe('Track volume');
    expect(modTargetLabel(c.store.project, c.owner, { kind: 'mixer', param: 'pan' })).toBe('Track pan');
    expect(modTargetLabel(c.store.project, c.owner, { kind: 'clip', param: 'transpose' })).toBe('Transpose');
    expect(modTargetLabel(c.store.project, c.owner, { kind: 'device', device: 'gone' as DeviceId, param: 'x' })).toBe('(removed) · x');
    const choices = modTargetChoices(c.store.project, c.owner).map(x => x.label);
    expect(choices.slice(0, 2)).toEqual(['Track volume', 'Track pan']);
    expect(choices.length).toBeGreaterThan(2);
    expect(modTargetChoices(c.store.project, MASTER)).toEqual([]);
    c.store.apply(setModTarget(c.owner, c.fx[3], 0, t));
    expect([...modulatedParams(c.store.project, c.owner)]).toEqual([`${c.fx[2]}|mix`]);
  });
});

describe('device selection', () => {
  it('the last device in the sound', () => {
    expect(lastInChain(['a', 'b', 'c'] as DeviceKey[], ['c', 'a'] as DeviceKey[])).toBe('c');
    expect(lastInChain(['a'] as DeviceKey[], [])).toBeNull();
  });

  it('a click chooses, a second click on the same removes, Shift+click extends in the order of the sound', () => {
    const c = chain(), s = c.selection, order = c.store.project.chainKeys(c.owner);
    s.click([c.fx[2]], false);
    expect(s.keys).toEqual([c.fx[2]]);
    s.click([order[0]], true);
    expect(s.keys).toEqual(order.slice(0, order.indexOf(c.fx[2]) + 1));
    s.click([c.fx[3]], false);
    s.click([c.fx[3]], false);
    expect(s.keys).toEqual([]);
    s.click([c.fx[3]], true);
    expect(s.keys).toEqual([c.fx[3]]);
  });

  it('a rack chosen by its name: lit alone while its devices are the selection', () => {
    const c = chain(), s = c.selection, rack = c.racks()[0];
    s.click(rack.devices, false, rack.id);
    expect(s.chosenRack()?.id).toBe(rack.id);
    expect(s.rackLit(rack)).toBe(true);
    s.click([c.fx[2]], false);
    expect(s.chosenRack()).toBeUndefined();
    expect(s.rackLit(rack)).toBe(false);
    s.click(rack.devices, false);
    expect(s.rackLit(rack)).toBe(true);
    expect(s.rackLit(undefined)).toBe(false);
  });

  it('keepIn and clear forget devices', () => {
    const c = chain(), s = c.selection;
    s.click([c.fx[2], c.fx[3]], false);
    s.keepIn([c.fx[3]]);
    expect(s.keys).toEqual([c.fx[3]]);
    expect(s.includes(c.fx[3])).toBe(true);
    s.clear();
    expect(s.keys).toEqual([]);
  });

  it('with no chain open, last is null', () => {
    const c = chain();
    c.selection.click([c.fx[2]], false);
    c.close();
    expect(c.selection.last()).toBeNull();
  });
});

describe('device commands', () => {
  it('copied: one device, several, a rack', () => {
    expect(copiedMessage({ instrument: null, effects: [{}], rack: null } as never)).toMatch(/^Device copied: /);
    expect(copiedMessage({ instrument: {}, effects: [{}], rack: null } as never)).toMatch(/^2 devices copied/);
    expect(copiedMessage({ instrument: null, effects: [], rack: { name: 'R' } } as never)).toMatch(/^Rack «R» copied/);
  });

  it('Ctrl+C with nothing chosen says how; copy, paste after the last chosen', () => {
    const c = chain();
    DEVICE_KEYS.c(c.commands);
    expect(c.said.at(-1)).toMatch(/^Choose a device/);
    c.selection.click([c.fx[2]], false);
    DEVICE_KEYS.c(c.commands);
    expect(c.clipboard.devices?.effects).toHaveLength(1);
    DEVICE_KEYS.v(c.commands);
    expect(c.effects()).toBe('delay,eq,delay,delay,lfo');
  });

  it('paste with an empty clipboard says so; with no chain open nothing happens', () => {
    const c = chain();
    DEVICE_KEYS.v(c.commands);
    expect(c.said).toEqual(['The clipboard has no devices.']);
    c.close();
    DEVICE_KEYS.v(c.commands);
    expect(c.said).toHaveLength(1);
  });

  it('duplicate and cut the chosen devices', () => {
    const c = chain();
    DEVICE_KEYS.d(c.commands);
    expect(c.effects()).toBe('delay,eq,delay,lfo');
    c.selection.click([c.fx[3]], false);
    DEVICE_KEYS.d(c.commands);
    expect(c.effects()).toBe('delay,eq,delay,lfo,lfo');
    DEVICE_KEYS.x(c.commands);
    expect(c.effects()).toBe('delay,eq,delay,lfo');
  });

  it('a chosen rack is copied and cut whole', () => {
    const c = chain(), rack = c.racks()[0];
    c.selection.click(rack.devices, false, rack.id);
    c.commands.cutSelection();
    expect(c.clipboard.devices?.rack).not.toBeNull();
    expect(c.racks()).toHaveLength(0);
    expect(c.effects()).toBe('delay,lfo');
  });

  it('group: says how without devices; groups and clears the selection', () => {
    const c = chain();
    c.commands.groupSelection();
    expect(c.said.at(-1)).toMatch(/^Choose the devices to group/);
    c.selection.click([c.fx[2], c.fx[3]], false);
    c.commands.groupSelection();
    expect(c.racks()).toHaveLength(2);
    expect(c.selection.keys).toEqual([]);
    expect(c.shown).toBe(1);
  });

  it('ungroup: the chosen rack, or the rack of the first chosen device; says how otherwise', () => {
    const c = chain();
    c.commands.ungroupSelection();
    expect(c.said.at(-1)).toMatch(/^Choose a rack/);
    c.selection.click([c.fx[1]], false);
    c.commands.ungroupSelection();
    expect(c.racks()).toHaveLength(0);
  });

  it('a refused change goes to the status bar', () => {
    const c = chain();
    expect(c.commands.guard(mapMacro(c.owner, 'gone' as DeviceId, 0, c.fx[0], 'mix'))).toBe(false);
    expect(c.said).toHaveLength(1);
  });
});

describe('macro mapping', () => {
  it('a rack maps the devices (and racks) it has inside', () => {
    const c = chain(), racks = c.racks();
    expect(mapsInto(racks, c.rack, c.fx[0])).toBe(true);
    expect(mapsInto(racks, c.rack, c.fx[2])).toBe(false);
    expect(mappingInto({ rack: c.rack, macro: 1 }, racks, c.fx[1])).toEqual({ rack: c.rack, macro: 1 });
    expect(mappingInto({ rack: c.rack, macro: null }, racks, c.fx[1])).toBeNull();
    expect(mappingInto(null, racks, c.fx[1])).toBeNull();
  });

  it('a click on a control: KEY first, then map, then blocked if a macro moves it', () => {
    const c = chain(), racks = c.racks(), map = { rack: c.rack, macro: 1 };
    expect(controlClick(true, map, racks, c.fx[0], 'feedback')).toBe('key');
    expect(controlClick(false, map, racks, c.fx[0], 'feedback')).toBe('map');
    expect(controlClick(false, null, racks, c.fx[0], 'feedback')).toBe('block');
    expect(controlClick(false, null, racks, c.fx[0], 'mix')).toBe('pass');
    expect(controlClick(false, map, racks, c.fx[2], 'mix')).toBe('pass');
  });

  it('marks: mapped with the macro\'s number; chosen when it\'s the macro being mapped', () => {
    const c = chain(), racks = c.racks();
    const m = paramMark(racks, c.fx[0], 'feedback', { rack: c.rack, macro: 0 });
    expect(m).toMatchObject({ mapped: true, chosen: true, macro: '1' });
    expect(m.title).toMatch(/^Moved by macro 1 of /);
    expect(paramMark(racks, c.fx[0], 'feedback', null).chosen).toBe(false);
    expect(paramMark(racks, c.fx[0], 'mix', null)).toEqual({ mapped: false, chosen: false, macro: null, title: null });
    expect(macroMark(racks, c.rack, macroParam(0), null)).toEqual({ mapped: false, chosen: null, macro: null, title: null });
    expect(deviceMappable({ rack: c.rack, macro: 0 }, racks, c.fx[1])).toBe(true);
    expect(deviceMappable({ rack: c.rack, macro: null }, racks, c.fx[1])).toBe(false);
  });

  it('a nested rack\'s macro mapped to the outer rack is marked, chosen while that macro is mapped', () => {
    const c = chain();
    c.store.apply(groupDevices(c.owner, [c.fx[0], c.fx[1], c.fx[2]]));
    const racks = c.racks(), outer = racks.find(r => r.id !== c.rack)!;
    c.store.apply(mapMacro(c.owner, outer.id, 2, c.rack, macroParam(0)));
    const mark = macroMark(c.racks(), c.rack, macroParam(0), { rack: outer.id, macro: 2 });
    expect(mark).toMatchObject({ mapped: true, chosen: true, macro: '3' });
    expect(mark.title).toMatch(/^\nMoved by macro 3 of /);
  });

  it('with KEY on, a parameter a macro moves sends the key to the macro', () => {
    const c = chain();
    expect(keyGoesToMacro(c.racks(), c.fx[0], 'feedback')).toMatch(/^Macro 1 of .* moves it: give the key to the macro\.$/);
    expect(keyGoesToMacro(c.racks(), c.fx[0], 'mix')).toBeNull();
  });

  it('a graphic panel\'s values keep out those a macro moves', () => {
    const c = chain();
    expect(freeParams(c.racks(), c.fx[0], { feedback: 1, mix: 2 })).toEqual({ mix: 2 });
  });
});

describe('device menus', () => {
  it('clipboard items: the instrument alone can\'t be cut or duplicated; paste only with devices', () => {
    const c = chain();
    expect(labels(clipboardMenu(c.menus, c.owner, ['instrument']))).toEqual(['(off) Cut', 'Copy', '(off) Duplicate', '(off) Paste after']);
    const items = clipboardMenu(c.menus, c.owner, [c.fx[3]]);
    run(items, 'Copy');
    expect(labels(clipboardMenu(c.menus, c.owner, [c.fx[3]]))).toContain('Paste after');
    run(items, 'Duplicate');
    expect(c.effects()).toBe('delay,eq,delay,lfo,lfo');
    run(clipboardMenu(c.menus, c.owner, [c.fx[2]]), 'Paste after');
    expect(c.effects()).toBe('delay,eq,delay,lfo,lfo,lfo');
    run(clipboardMenu(c.menus, c.owner, [c.fx[2]]), 'Cut');
    expect(c.effects()).toBe('delay,eq,lfo,lfo,lfo');
  });

  it('a device header: on the chosen devices if it\'s one of them; ungroup only inside a rack; presets at the end', () => {
    const c = chain();
    const preset = { label: 'Preset A', run: () => {} };
    const free = deviceHeadMenu(c.menus, c.owner, c.fx[2], [], [preset]);
    expect(labels(free)).toEqual(['Cut', 'Copy', 'Duplicate', '(off) Paste after', 'Group into a rack', '(off) Ungroup the rack', 'Preset A']);
    run(deviceHeadMenu(c.menus, c.owner, c.fx[2], [c.fx[2], c.fx[3]], []), 'Group into a rack');
    expect(c.racks()).toHaveLength(2);
    run(deviceHeadMenu(c.menus, c.owner, c.fx[0], [], []), 'Ungroup the rack');
    expect(c.racks()).toHaveLength(1);
  });

  it('the empty chain pastes', () => {
    const c = chain();
    expect(labels(emptyChainMenu(c.menus))).toEqual(['(off) Paste']);
  });

  it('a parameter in a rack: automation, then the macros with the current one ticked, then remove', () => {
    const c = chain();
    const items = paramMenu(c.menus, c.owner, c.fx[0], 'feedback');
    const names = labels(items);
    expect(names[0]).toBe('Show automation');
    expect(names[1]).toMatch(/^Map to .* \(macro 1\) ✓$/);
    expect(names.at(-1)).toBe('Remove from the macro');
    run(items, 'Show automation');
    expect(c.automation).toEqual([JSON.stringify({ kind: 'device', device: c.fx[0], param: 'feedback' })]);
    run(items, 'Remove from the macro');
    expect(c.racks()[0].macros[0].mappings).toHaveLength(0);
    run(paramMenu(c.menus, c.owner, c.fx[0], 'mix'), 'Map to Macro 2');
    expect(c.racks()[0].macros[1].mappings).toHaveLength(1);
  });

  it('a parameter outside racks offers to group; one moved by a modulator offers to remove it', () => {
    const c = chain();
    c.store.apply(setModTarget(c.owner, c.fx[3], 0, { kind: 'device', device: c.fx[2], param: 'mix' }));
    const items = paramMenu({ ...c.menus, showAutomation: undefined }, c.owner, c.fx[2], 'mix');
    expect(labels(items)).toEqual(['Remove the modulation of LFO (target 1)', 'Group into a rack to map it to a macro']);
    run(items, 'Remove the modulation of LFO (target 1)');
    expect(modulationMenu(c.menus, c.owner, { kind: 'device', device: c.fx[2], param: 'mix' })).toEqual([]);
    run(paramMenu(c.menus, c.owner, c.fx[2], 'mix'), 'Group into a rack to map it to a macro');
    expect(c.racks()).toHaveLength(2);
  });

  it('several racks: each under its name, from the nearest', () => {
    const c = chain();
    c.store.apply(groupDevices(c.owner, [c.fx[0], c.fx[1], c.fx[2]]));
    const racks = c.racks();
    const items = mapMenu(c.menus, c.owner, [...racks].reverse(), c.fx[0], 'mix');
    expect(actions(items).filter(i => i.disabled).length).toBe(3);
    expect(mapMenu(c.menus, c.owner, [], c.fx[0], 'mix')).toEqual([]);
    expect(actions(outerMacroMenu(c.menus, c.owner, c.rack, 0)).length).toBeGreaterThan(1);
    expect(outerMacroMenu(c.menus, c.owner, 'gone' as DeviceId, 0)).toEqual([]);
  });

  it('a MIDI track can add more effect types than the master', () => {
    const c = chain();
    expect(effectChoices(c.menus, c.owner).length).toBeGreaterThan(effectChoices(c.menus, MASTER).length);
  });
});

describe('chain folds', () => {
  it('racks and devices, per chain', () => {
    const f = new ChainFolds();
    f.toggleRack('r1' as DeviceId);
    f.toggleRack('r2' as DeviceId);
    expect(f.rackFolded('r1' as DeviceId)).toBe(true);
    expect(f.racksKey).toBe('r1,r2');
    f.toggleRack('r1' as DeviceId);
    expect(f.racksKey).toBe('r2');
    f.foldDevice('t1' as never, 'd');
    expect(f.deviceFolded('t1' as never, 'd')).toBe(true);
    expect(f.deviceFolded('t2' as never, 'd')).toBe(false);
    f.unfoldDevice('t1' as never, 'd');
    expect(f.deviceFolded('t1' as never, 'd')).toBe(false);
  });
});
