// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackId } from '../../../src/core/id';
import { instrumentType } from '../../../src/devices/registry';
import { resolveParams } from '../../../src/devices/device-type';
import { MASTER } from '../../../src/model/project';
import { DEVICE_HEIGHT } from '../../../src/ui/editor-height';
import { controlOf } from '../../../src/ui/device/controls';
import { endBrowserDrag, startBrowserDrag } from '../../../src/ui/browser/browser-drag';
import type { BrowserItem } from '../../../src/browser/item';
import { button, choose, drag, dragEvent, key, menuLabels, mouse, pick, settle, typeInline, wheel } from '../../helpers/browser';
import { pointer } from '../../helpers/dom';
import { openChain, type Chain } from '../../helpers/device-chain';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('style');
});
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const types = (c: Chain) => c.effects().map(e => e.type);
const panelNames = (c: Chain) => c.panels().map(p => p.querySelector('.device-name')!.textContent);
const param = (c: Chain, panel: number, id: string) => c.panels()[panel].querySelector<HTMLElement>(`[data-param="${id}"]`)!;
const name = (c: Chain, panel: number) => c.panels()[panel].querySelector<HTMLElement>('.device-name')!;

describe('the device chain', () => {
  it('shows the instrument and the effects in the order of the sound; opening what isn\'t there does nothing; Esc closes', () => {
    const c = openChain({ effects: ['delay', 'reverb'] });
    expect(panelNames(c)).toEqual(['Analog', 'Delay', 'Reverb']);
    expect(c.q('.device-title').textContent).toBe(c.store.project.track(c.owner as TrackId)!.name);
    expect(c.view.open('track-99' as TrackId)).toBe(false);
    expect(c.view.openOwner).toBe(c.owner);
    c.view.element.dispatchEvent(key('Escape'));
    expect([c.view.isOpen, c.view.element.hidden]).toEqual([false, true]);
  });

  it('the master has its effects and no instrument; the back button goes back to who opened it', () => {
    const c = openChain();
    const back = vi.fn();
    c.view.open(MASTER, back);
    expect(c.panels()).toHaveLength(0);
    expect(c.q('.device-empty').textContent).toContain('No effects');
    expect(button(c.view.element, '◂ Note').hidden).toBe(false);
    button(c.view.element, '◂ Note').click();
    expect(back).toHaveBeenCalledOnce();
    c.view.open(c.owner);
    expect(button(c.view.element, '◂ Note').hidden).toBe(true);
  });

  it('a track that disappears closes the chain', () => {
    const c = openChain({ effects: ['delay'] });
    while (c.store.project.track(c.owner as TrackId)) c.store.undo();
    expect(c.view.isOpen).toBe(false);
  });

  it('an effect is added from the menu, turned off, moved, deleted', () => {
    const c = openChain({ effects: ['delay'] });
    button(c.view.element, '+ Effect').click();
    expect(menuLabels()).toContain('Reverb');
    choose('Reverb');
    expect(types(c)).toEqual(['delay', 'reverb']);
    button(c.panels()[2], '⏻').click();
    expect(c.effects()[1].enabled).toBe(false);
    expect(c.panels()[2].classList.contains('off')).toBe(true);
    expect(button(c.panels()[2], '▸').disabled).toBe(true);
    button(c.panels()[2], '◂').click();
    expect(types(c)).toEqual(['reverb', 'delay']);
    button(c.panels()[1], '▸').click();
    expect(types(c)).toEqual(['delay', 'reverb']);
    button(c.panels()[1], '×').click();
    expect(types(c)).toEqual(['reverb']);
  });

  it('another instrument is chosen, and the test note plays it', () => {
    const c = openChain();
    button(c.panels()[0], '♪').click();
    expect(c.auditioned).toEqual([60]);
    pick(c.panels()[0].querySelector<HTMLSelectElement>('select[title="Instrument"]')!, 'neuro');
    expect(c.instrument().type).toBe('neuro');
    expect(panelNames(c)).toEqual([instrumentType('neuro')!.label]);
  });

  it('a device this version doesn\'t know says so', () => {
    const c = openChain({ instrument: { type: 'from-the-future' } });
    expect(c.q('.device-empty').textContent).toContain('"from-the-future" isn\'t available');
  });
});

describe('the controls of the parameters', () => {
  it('a dragged knob is one undo step; Shift is finer; a right press does nothing', () => {
    const c = openChain();
    const before = c.store.undoLabel;
    const knob = param(c, 0, 'cutoff'), start = resolveParams(instrumentType('analog')!, {}).cutoff;
    drag(knob, [[0, 100], [0, 120]], { button: 2 });
    expect(c.instrument().params.cutoff).toBeUndefined();
    drag(knob, [[0, 100], [0, 120], [0, 150]]);
    const coarse = c.instrument().params.cutoff;
    expect(coarse).toBeLessThan(start);
    c.store.undo();
    expect(c.instrument().params.cutoff).toBeUndefined();
    expect(c.store.undoLabel).toBe(before);
    drag(knob, [[0, 100], [0, 150]], { shiftKey: true });
    const fine = c.instrument().params.cutoff;
    expect(fine).toBeGreaterThan(coarse);
    // the next drag is another step
    drag(knob, [[0, 100], [0, 150]]);
    c.store.undo();
    expect(c.instrument().params.cutoff).toBe(fine);
  });

  it('double click puts the default back, the wheel moves by steps', () => {
    const c = openChain();
    const knob = param(c, 0, 'cutoff'), def = resolveParams(instrumentType('analog')!, {}).cutoff;
    knob.dispatchEvent(wheel(0, 0, 100));
    const lower = c.instrument().params.cutoff;
    expect(lower).toBeLessThan(def);
    knob.dispatchEvent(wheel(0, 0, -100, { shiftKey: true }));
    expect(c.instrument().params.cutoff).toBeGreaterThan(lower);
    knob.dispatchEvent(mouse('dblclick'));
    expect(c.instrument().params.cutoff).toBeCloseTo(def);
  });

  it('few options are buttons, many are a menu', () => {
    const c = openChain({ effects: ['delay'] });
    const choice = c.all('.choice').find(e => e.querySelector('.choice-buttons'))!;
    const panel = choice.closest('.device-panel')!, id = choice.dataset.param!;
    choice.querySelectorAll('button')[1].click();
    const values = panel === c.panels()[0] ? c.instrument().params : c.effects()[0].params;
    expect(values[id]).toBe(1);
    expect(c.all('.choice').length).toBeGreaterThan(0);
    const menu = param(c, 1, 'division').querySelector('select')!;
    pick(menu, '3');
    expect(c.effects()[0].params.division).toBe(3);
  });

  it('a playing curve moves what the control shows, not its value', () => {
    let offset: number | null = 0.25;
    const c = openChain({ effects: ['delay'], modulation: t => (t.kind === 'device' && ['cutoff', 'division'].includes(t.param) ? offset : null) });
    const knob = param(c, 0, 'cutoff'), still = knob.querySelector('.knob-readout')!.textContent;
    c.frames.run(2);
    expect(knob.classList.contains('automated')).toBe(true);
    expect(knob.querySelector('.knob-readout')!.textContent).not.toBe(still);
    expect(param(c, 1, 'division').querySelector('select')!.classList.contains('automated')).toBe(true);
    offset = null;
    c.frames.run();
    expect(knob.classList.contains('automated')).toBe(false);
    expect(knob.querySelector('.knob-readout')!.textContent).toBe(still);
    expect(c.instrument().params.cutoff).toBeUndefined();
    expect(controlOf(knob)?.modulate).toBeTypeOf('function');
  });
});

describe('presets', () => {
  it('a factory preset loads its values and is heard', () => {
    const c = openChain();
    const preset = instrumentType('analog')!.presets[1];
    pick(c.q<HTMLSelectElement>('select.preset'), `f:${preset.name}`);
    expect(c.instrument().preset).toBe(preset.name);
    expect(c.auditioned).toHaveLength(1);
    c.q<HTMLSelectElement>('select.preset').dispatchEvent(new Event('focus'));
    expect(c.q<HTMLSelectElement>('select.preset').value).toBe(`f:${preset.name}`);
  });

  it('★ saves the user\'s one, which then is updated and deleted from the header\'s menu', async () => {
    const c = openChain();
    const head = () => c.q('.device-panel-head');
    const star = () => button(c.panels()[0], '★');
    star().click();
    typeInline(head(), instrumentType('analog')!.presets[0].name);
    await settle();
    expect(c.said.at(-1)).toContain('is a factory preset');
    star().click();
    typeInline(head(), 'Mine', 'Escape');
    param(c, 0, 'cutoff').dispatchEvent(wheel(0, 0, 100));
    star().click();
    typeInline(head(), 'Mine');
    await settle();
    expect(c.said.at(-1)).toContain('Preset «Mine» saved');
    expect(c.instrument().preset).toBe('Mine');
    expect(c.q<HTMLSelectElement>('select.preset').value).toBe('u:Mine');
    head().dispatchEvent(mouse('contextmenu'));
    choose('Update the preset «Mine»');
    await settle();
    expect(c.said.at(-1)).toBe('Preset «Mine» updated.');
    pick(c.q<HTMLSelectElement>('select.preset'), 'u:Mine');
    expect(c.instrument().preset).toBe('Mine');
    head().dispatchEvent(mouse('contextmenu'));
    choose('Delete the preset «Mine»');
    await settle();
    expect(c.said.at(-1)).toBe('Preset «Mine» deleted.');
    expect([...c.q<HTMLSelectElement>('select.preset').options].map(o => o.value)).not.toContain('u:Mine');
  });
});

describe('collapsing', () => {
  it('a device from its arrow or with a double click on the header\'s background; it\'s remembered', () => {
    const c = openChain({ effects: ['delay'] });
    button(c.panels()[0], '▾').click();
    expect(c.panels()[0].classList.contains('folded')).toBe(true);
    c.panels()[0].querySelector('.device-panel-head')!.dispatchEvent(mouse('dblclick'));
    expect(c.panels()[0].classList.contains('folded')).toBe(false);
    name(c, 1).dispatchEvent(mouse('dblclick')); // the name isn't the background
    expect(c.panels()[1].classList.contains('folded')).toBe(false);
    button(c.panels()[1], '▾').click();
    button(c.view.element, '+ Effect').click();
    choose('Reverb'); // the panels are built again
    expect(c.panels().map(p => p.classList.contains('folded'))).toEqual([false, true, false]);
  });

  it('all together, and all back', () => {
    const c = openChain({ effects: ['delay'] });
    const all = button(c.view.element, '⇤⇥');
    all.click();
    expect(c.panels().every(p => p.classList.contains('folded'))).toBe(true);
    all.click();
    expect(c.panels().some(p => p.classList.contains('folded'))).toBe(false);
  });

  it('the tabs wrap within the panel\'s height, as many rows as fit', () => {
    const c = openChain();
    const panel = c.panels()[0], box = panel.querySelector<HTMLElement>('.device-sections')!;
    panel.style.paddingBottom = '0px';
    panel.getBoundingClientRect = () => new DOMRect(0, 0, 900, 300);
    box.getBoundingClientRect = () => new DOMRect(0, 40, 900, 260);
    for (const card of box.children as Iterable<HTMLElement>) card.getBoundingClientRect = () => new DOMRect(0, 0, 100, 110);
    c.resize();
    const cards = box.children.length;
    expect(box.style.maxWidth).toBe(`${Math.ceil(cards / 2) * 106 - 6}px`);
  });

  it('the height is dragged from the top edge and remembered; past the minimum the view folds', async () => {
    const c = openChain();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    vi.stubGlobal('innerHeight', 1200);
    Object.defineProperty(c.view.element, 'offsetHeight', { configurable: true, value: 500 });
    const edge = c.q('.editor-resize'), height = () => document.documentElement.style.getPropertyValue(DEVICE_HEIGHT.variable);
    drag(edge, [[0, 500], [0, 450]], { button: 1 });
    expect(height()).toBe('');
    drag(edge, [[0, 500], [0, 450]]);
    expect(height()).toBe(`${DEVICE_HEIGHT.initial + 50}px`);
    expect(localStorage.getItem(DEVICE_HEIGHT.key)).toBe(String(DEVICE_HEIGHT.initial + 50));
    edge.dispatchEvent(mouse('dblclick'));
    expect(height()).toBe(`${DEVICE_HEIGHT.initial}px`);
    // a little below the minimum it goes back, much below it folds
    drag(edge, [[0, 500], [0, 520]]);
    await settle();
    expect(c.view.element.classList.contains('folded')).toBe(false);
    drag(edge, [[0, 500], [0, 700]]);
    await settle();
    expect(c.view.element.classList.contains('folded')).toBe(true);
    // folded, dragged up it reopens
    drag(edge, [[0, 500], [0, 0]]);
    await settle();
    expect(c.view.element.classList.contains('folded')).toBe(false);
  });
});

describe('choosing devices', () => {
  it('a click on the name chooses, Shift extends; copied, cut, pasted, duplicated with the keys', () => {
    const c = openChain({ effects: ['delay', 'reverb'] });
    const press = (k: string, init: KeyboardEventInit = {}) => c.view.element.dispatchEvent(key(k, { ctrlKey: true, ...init }));
    press('c');
    expect(c.said.at(-1)).toContain('Choose a device');
    press('v');
    expect(c.said.at(-1)).toBe('The clipboard has no devices.');
    name(c, 1).click();
    name(c, 2).dispatchEvent(mouse('click', 0, 0, { shiftKey: true }));
    expect(c.all('.device-panel.selected')).toHaveLength(2);
    press('c');
    expect(c.said.at(-1)).toContain('2 devices copied');
    press('v');
    expect(types(c)).toEqual(['delay', 'reverb', 'delay', 'reverb']);
    name(c, 1).click();
    press('d');
    expect(types(c)).toEqual(['delay', 'delay', 'reverb', 'delay', 'reverb']);
    expect(c.all('.device-panel.selected')).toHaveLength(1);
    press('x');
    expect(types(c)).toEqual(['delay', 'reverb', 'delay', 'reverb']);
    c.view.pasteSelection();
    expect(types(c)).toHaveLength(5);
  });

  it('the header\'s menu acts on its device; the empty space pastes', () => {
    const c = openChain({ effects: ['delay'] });
    c.panels()[1].querySelector('.device-panel-head')!.dispatchEvent(mouse('contextmenu'));
    choose('Duplicate');
    expect(types(c)).toEqual(['delay', 'delay']);
    c.panels()[1].querySelector('.device-panel-head')!.dispatchEvent(mouse('contextmenu'));
    choose('Cut');
    expect(types(c)).toEqual(['delay']);
    c.q('.device-chain').dispatchEvent(mouse('contextmenu'));
    choose('Paste');
    expect(types(c)).toEqual(['delay', 'delay']);
  });

  it('a controller\'s device is marked and brought into view', () => {
    const c = openChain({ effects: ['delay', 'reverb'] });
    const chain = c.q('.device-chain');
    chain.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300);
    c.panels()[2].getBoundingClientRect = () => new DOMRect(600, 0, 200, 300);
    c.view.markControlled({ owner: c.owner, device: c.effectId(1) });
    expect(c.panels().map(p => p.classList.contains('controlled'))).toEqual([false, false, true]);
    expect(chain.scrollLeft).toBe(410);
    c.panels()[1].getBoundingClientRect = () => new DOMRect(-100, 0, 80, 300);
    c.view.markControlled({ owner: c.owner, device: c.effectId(0) });
    expect(chain.scrollLeft).toBe(300);
    c.view.markControlled(null);
    expect(c.all('.controlled')).toHaveLength(0);
  });

  it('the wheel scrolls the chain, except where a knob used it', () => {
    const c = openChain();
    const chain = c.q('.device-chain');
    c.panels()[0].dispatchEvent(wheel(0, 0, 60));
    expect(chain.scrollLeft).toBe(60);
    param(c, 0, 'cutoff').dispatchEvent(wheel(0, 0, 60));
    expect(chain.scrollLeft).toBe(60);
  });

  it('a browser item dropped on the open chain goes to it', () => {
    const c = openChain();
    const item: BrowserItem = { id: 'x', name: 'Delay', icon: 'effect', payload: { kind: 'effect', type: 'delay', preset: null } } as unknown as BrowserItem;
    const start = dragEvent('dragstart', []) as DragEvent;
    Object.assign(start.dataTransfer!, { setData: () => undefined });
    startBrowserDrag(start, item);
    const data = { 'application/x-studiomio-browser': 'x' };
    c.view.element.dispatchEvent(dragEvent('dragover', [], data));
    expect(c.view.element.classList.contains('browser-drop')).toBe(true);
    c.view.element.dispatchEvent(dragEvent('drop', [], data));
    expect(c.dropped).toEqual([[item, { kind: 'chain', owner: c.owner }]]);
    expect(c.view.element.classList.contains('browser-drop')).toBe(false);
    endBrowserDrag();
  });

  it('a parameter\'s menu shows its curve', () => {
    const c = openChain();
    param(c, 0, 'cutoff').dispatchEvent(mouse('contextmenu'));
    choose('Show automation');
    expect(c.automated).toEqual([{ kind: 'device', device: 'instrument', param: 'cutoff' }]);
  });

  it('with KEY on a click on a control chooses it for the keyboard, without moving it', () => {
    const c = openChain();
    c.ui.setKeyMapping(true);
    expect(c.view.element.classList.contains('key-mapping')).toBe(true);
    drag(param(c, 0, 'cutoff'), [[0, 100], [0, 150]]);
    expect(c.instrument().params.cutoff).toBeUndefined();
    expect(c.ui.keyTarget).toEqual({ kind: 'param', owner: c.owner, device: 'instrument', param: 'cutoff' });
    expect(param(c, 0, 'cutoff').classList.contains('key-chosen')).toBe(true);
  });
});

describe('the sidechain', () => {
  it('the detector listens to the chosen track, or to itself', () => {
    const c = openChain({ effects: ['compressor'] });
    const other = c.store.project.tracks.find(t => t.id !== c.owner)!;
    const select = () => c.q<HTMLSelectElement>('.sidechain-choice select');
    expect([...select().options].map(o => o.textContent)).toEqual(['— itself —', other.name]);
    pick(select(), other.id);
    expect(c.effects()[0].sidechain).toBe(other.id);
    pick(select(), '');
    expect(c.effects()[0].sidechain ?? null).toBeNull();
  });
});

describe('a rack', () => {
  /** The delay and the reverb grouped. */
  const racked = () => {
    const c = openChain({ effects: ['delay', 'reverb'] });
    name(c, 1).click();
    name(c, 2).dispatchEvent(mouse('click', 0, 0, { shiftKey: true }));
    c.view.element.dispatchEvent(key('g', { ctrlKey: true }));
    const rack = () => c.store.project.racksOf(c.owner)[0];
    const macro = (i: number) => c.all('.rack-panel .macro')[i];
    return { ...c, rack, macro };
  };

  it('Ctrl+G groups the chosen devices, Ctrl+Shift+G ungroups; with nothing chosen it says what to do', () => {
    const c = openChain({ effects: ['delay', 'reverb'] });
    c.view.element.dispatchEvent(key('g', { ctrlKey: true }));
    expect(c.said.at(-1)).toContain('Choose the devices to group');
    c.view.element.dispatchEvent(key('g', { ctrlKey: true, shiftKey: true }));
    expect(c.said.at(-1)).toContain('Choose a rack');
    const r = racked();
    expect(r.rack().devices).toEqual(r.effects().map(e => e.id));
    r.q('.rack-panel .device-name').click();
    expect(r.q('.rack-panel').classList.contains('selected')).toBe(true);
    r.view.element.dispatchEvent(key('g', { ctrlKey: true, shiftKey: true }));
    expect(r.store.project.racksOf(r.owner)).toHaveLength(0);
  });

  it('Map: a macro, then a parameter; the macro moves it, and the parameter isn\'t touched any more', () => {
    const c = racked();
    button(c.q('.rack-panel'), 'Map').click();
    expect(c.q('.rack-mappings').textContent).toContain('Choose a macro');
    c.macro(0).dispatchEvent(pointer('pointerdown', 0, 0));
    expect(c.q('.rack-mappings').textContent).toContain('Click a parameter');
    param(c, 1, 'mix').dispatchEvent(pointer('pointerdown', 0, 0));
    expect(c.rack().macros[0].mappings.map(m => m.param)).toEqual(['mix']);
    expect(c.all('.rack-mapping')).toHaveLength(1);
    button(c.q('.rack-panel'), 'Map').click();
    expect(param(c, 1, 'mix').classList.contains('mapped')).toBe(true);
    const before = c.effects()[0].params.mix;
    drag(param(c, 1, 'mix'), [[0, 100], [0, 50]]);
    expect(c.effects()[0].params.mix).toBe(before);
    drag(c.macro(0), [[0, 100], [0, 60]]);
    expect(c.rack().macros[0].value).toBeGreaterThan(0);
  });

  it('the mapping\'s range, + Parameter from the menus, × to remove', () => {
    const c = racked();
    button(c.q('.rack-panel'), 'Map').click();
    c.macro(1).dispatchEvent(pointer('pointerdown', 0, 0));
    button(c.q('.rack-mappings'), '+ Parameter').click();
    choose('Delay');
    const label = menuLabels().find(l => l.endsWith('Feedback'))!;
    choose(label);
    expect(c.rack().macros[1].mappings.map(m => m.param)).toEqual(['feedback']);
    const [min, max] = c.q('.rack-mapping').querySelectorAll<HTMLElement>('.knob');
    const full = c.rack().macros[1].mappings[0].max;
    max.dispatchEvent(wheel(0, 0, 100));
    expect(c.rack().macros[1].mappings[0].max).toBeLessThan(full);
    min.dispatchEvent(wheel(0, 0, -100));
    expect(c.rack().macros[1].mappings[0].min).toBeGreaterThan(0);
    button(c.q('.rack-mapping'), '×').click();
    expect(c.rack().macros[1].mappings).toEqual([]);
  });

  it('a macro\'s menu: name, automatic name, modes; the toggle and the held button', () => {
    const c = racked();
    const menu = (i: number) => c.macro(i).dispatchEvent(mouse('contextmenu'));
    menu(0);
    choose('Rename the macro');
    typeInline(c.q('.rack-panel'), 'Space');
    expect(c.rack().macros[0].name).toBe('Space');
    menu(0);
    choose('Automatic name');
    expect(c.rack().macros[0].name).toBeNull();
    menu(0);
    const modes = menuLabels();
    choose(modes.find(l => /toggle/i.test(l))!);
    c.macro(0).querySelector('button')!.click();
    expect(c.rack().macros[0].value).toBeGreaterThan(64);
    c.macro(0).querySelector('button')!.click();
    expect(c.rack().macros[0].value).toBe(0);
    menu(1);
    choose(modes.find(l => /button/i.test(l))!);
    const held = c.macro(1).querySelector('button')!;
    held.dispatchEvent(pointer('pointerdown', 0, 0));
    expect(c.rack().macros[1].value).toBeGreaterThan(64);
    c.macro(1).querySelector('button')!.dispatchEvent(pointer('pointerup', 0, 0));
    expect(c.rack().macros[1].value).toBe(0);
    menu(2);
    choose('Map…');
    expect(c.macro(2).classList.contains('chosen')).toBe(true);
  });

  it('a spring: its rest is dragged, its return time chosen or typed', () => {
    const c = racked();
    c.macro(0).dispatchEvent(mouse('contextmenu'));
    choose(menuLabels().find(l => /spring/i.test(l))!);
    const spring = () => c.rack().macros[0].spring!;
    const rest = spring().rest;
    drag(c.q('.spring-rest'), [[0, 100], [0, 80]]);
    expect(spring().rest).toBeGreaterThan(rest);
    c.q('.spring-time').click();
    const times = menuLabels();
    choose(times[0]);
    expect(c.q('.spring-time').textContent).toBe(times[0]);
    c.q('.spring-time').click();
    choose('More…');
    typeInline(c.q('.rack-panel'), 'soon');
    expect(c.said.at(-1)).toContain('"soon" isn\'t a return time');
    c.q('.spring-time').click();
    choose('More…');
    typeInline(c.q('.rack-panel'), '300 ms');
    expect([spring().time, spring().sync]).toEqual([300, false]);
    // pulling it isn't an undo step, and while it's held it doesn't return
    const label = c.store.undoLabel;
    c.macro(0).dispatchEvent(pointer('pointerdown', 0, 100));
    c.macro(0).dispatchEvent(pointer('pointermove', 0, 40));
    const pulled = c.rack().macros[0].value;
    expect(pulled).toBeGreaterThan(spring().rest);
    window.dispatchEvent(pointer('pointerup', 0, 40));
    c.macro(0).dispatchEvent(pointer('pointerup', 0, 40));
    expect(c.store.undoLabel).toBe(label);
  });

  it('is renamed, folded, moved, gets an effect, is saved and deleted', async () => {
    const c = racked();
    c.q('.rack-panel .device-name').dispatchEvent(mouse('dblclick'));
    typeInline(c.q('.rack-panel'), 'Echoes');
    expect(c.rack().name).toBe('Echoes');
    button(c.q('.rack-panel'), '+').click();
    choose('EQ');
    expect(c.rack().devices).toHaveLength(3);
    button(c.q('.rack-panel'), '▾').click();
    expect(c.q('.rack').classList.contains('folded')).toBe(true);
    expect(c.q('.rack-folded').children).toHaveLength(3);
    button(c.q('.rack-panel'), '▸').click();
    expect(c.all('.rack .device-panel')).toHaveLength(3);
    button(c.q('.rack-panel'), '★').click();
    typeInline(c.q('.rack-panel'), 'Echoes');
    await settle();
    expect(c.said.at(-1)).toContain('Rack «Echoes» saved');
    c.q('.rack-panel .device-panel-head').dispatchEvent(mouse('contextmenu'));
    choose('Delete the saved rack «Echoes»');
    await settle();
    expect(c.said.at(-1)).toContain('Saved rack «Echoes» deleted');
    button(c.view.element, '+ Effect').click();
    choose('Delay');
    c.all('.rack-panel button').find(b => b.title === 'Move the rack later')!.click();
    expect(types(c)[0]).toBe('delay');
    c.all('.rack-panel button').find(b => b.title === 'Move the rack earlier')!.click();
    c.all('.rack-panel button').find(b => b.title.startsWith('Delete the rack'))!.click();
    expect(types(c)).toEqual(['delay']);
  });

  it('a parameter maps to a macro from its menu; KEY gives its key to the macro', () => {
    const c = racked();
    param(c, 1, 'mix').dispatchEvent(mouse('contextmenu'));
    choose('Map to Macro 1');
    expect(c.rack().macros[0].mappings).toHaveLength(1);
    c.ui.setKeyMapping(true);
    param(c, 1, 'mix').dispatchEvent(pointer('pointerdown', 0, 0));
    expect(c.ui.keyTarget).toBeNull();
    expect(c.said.at(-1)).toBeTruthy();
    c.macro(0).dispatchEvent(pointer('pointerdown', 0, 0));
    expect(c.ui.keyTarget).toEqual({ kind: 'macro', owner: c.owner, rack: c.rack().id, index: 0 });
    c.ui.setKeyMapping(false);
    param(c, 1, 'mix').dispatchEvent(mouse('contextmenu'));
    choose('Remove from the macro');
    expect(c.rack().macros[0].mappings).toHaveLength(0);
  });

  it('inside another rack, its macros map to the outer ones', () => {
    const c = racked();
    button(c.view.element, '+ Effect').click();
    choose('EQ');
    name(c, 3).click();
    c.view.element.dispatchEvent(key('g', { ctrlKey: true }));
    c.all('.rack-panel')[1].querySelector('.device-panel-head')!.dispatchEvent(mouse('contextmenu'));
    choose('Put in the rack before');
    expect(c.all('.rack .rack')).toHaveLength(1);
    const inner = () => c.q('.rack .rack .rack-panel');
    button(c.q('.rack-panel'), 'Map').click();
    c.macro(0).dispatchEvent(pointer('pointerdown', 0, 0));
    expect(inner().classList.contains('mappable')).toBe(true);
    inner().querySelector('.macro')!.dispatchEvent(pointer('pointerdown', 0, 0));
    const outer = c.store.project.racksOf(c.owner).find(r => r.macros[0].mappings.length)!;
    expect(outer.macros[0].mappings[0].param).toBe('macro1');
    button(c.q('.rack-panel'), 'Map').click();
    expect(inner().querySelector('.macro')!.classList.contains('mapped')).toBe(true);
    inner().querySelectorAll('.macro')[1].dispatchEvent(mouse('contextmenu'));
    expect(menuLabels().some(l => l.startsWith('Map to'))).toBe(true);
  });
});

describe('a modulator', () => {
  const at = (c: Chain, target: HTMLElement | null) => { document.elementFromPoint = () => target; return c; };
  const chip = (c: Chain) => c.q('.prisma-chip');
  const press = (e: HTMLElement) => drag(e, [[0, 0]]);

  it('⊕ Map turns on the choice: a click on a knob makes it a target, Esc ends', () => {
    const c = openChain({ effects: ['delay', 'lfo'] });
    press(chip(c));
    expect(c.view.element.classList.contains('mod-picking')).toBe(true);
    const mix = param(c, 1, 'mix');
    at(c, mix);
    drag(mix, [[0, 100], [0, 50]]);
    expect(c.effects()[0].params.mix).toBeUndefined();
    expect(c.effects()[1].targets?.[0]).toEqual({ kind: 'device', device: c.effectId(0), param: 'mix' });
    expect(param(c, 1, 'mix').classList.contains('mod-target')).toBe(true);
    expect(c.said.at(-1)).toContain('Click other knobs');
    mix.dispatchEvent(pointer('pointerdown', 0, 0));
    expect(c.said.at(-1)).toContain('already moves it');
    const scroll = c.q('.device-chain').scrollLeft;
    mix.dispatchEvent(wheel(0, 0, 40));
    expect(c.q('.device-chain').scrollLeft).toBe(scroll + 40);
    window.dispatchEvent(key('Escape'));
    expect(c.view.element.classList.contains('mod-picking')).toBe(false);
    expect(c.view.isOpen).toBe(true);
  });

  it('not its own knobs; dragged onto a knob (also of the instrument) it takes that one', () => {
    const c = openChain({ effects: ['lfo'] });
    at(c, param(c, 1, 'rate'));
    press(chip(c));
    param(c, 1, 'rate').dispatchEvent(pointer('pointerdown', 0, 0));
    expect(c.effects()[0].targets?.some(Boolean) ?? false).toBe(false);
    press(chip(c)); // off again
    expect(c.view.element.classList.contains('mod-picking')).toBe(false);
    at(c, param(c, 0, 'cutoff'));
    c.q('.device-chain').getBoundingClientRect = () => new DOMRect(0, 0, 400, 300);
    chip(c).dispatchEvent(pointer('pointerdown', 0, 0));
    chip(c).dispatchEvent(pointer('pointermove', 390, 30));
    expect(document.querySelector('.prisma-ghost')!.textContent).toContain('→');
    c.frames.run(2);
    expect(c.q('.device-chain').scrollLeft).toBeGreaterThan(0);
    chip(c).dispatchEvent(pointer('pointermove', 5, 30));
    c.frames.run();
    chip(c).dispatchEvent(pointer('pointerup', 390, 30));
    expect(document.querySelector('.prisma-ghost')).toBeNull();
    expect(c.effects()[0].targets?.[0]).toEqual({ kind: 'device', device: 'instrument', param: 'cutoff' });
  });

  it('the row\'s menu gives the volume and the pan; × and the amount\'s menu remove', () => {
    const c = openChain({ effects: ['envelope'] });
    const row = () => c.all('.mod-link').find(r => !r.hidden)!;
    button(row(), '▾').click();
    const first = menuLabels()[0];
    choose(first);
    expect(c.effects()[0].targets?.[0]).toBeTruthy();
    expect(row().querySelector('.mod-link-name')!.textContent).toBe(first);
    button(row(), '×').click();
    expect(c.effects()[0].targets?.[0] ?? null).toBeNull();
    button(row(), '▾').click();
    choose(first);
    param(c, 1, 'a1').dispatchEvent(mouse('contextmenu'));
    choose('Remove the target');
    expect(c.effects()[0].targets?.[0] ?? null).toBeNull();
  });

  it('a target is also removed from its parameter\'s menu', () => {
    const c = openChain({ effects: ['delay', 'lfo'] });
    at(c, param(c, 1, 'mix'));
    press(chip(c));
    param(c, 1, 'mix').dispatchEvent(pointer('pointerdown', 0, 0));
    window.dispatchEvent(key('Escape'));
    param(c, 1, 'mix').dispatchEvent(mouse('contextmenu'));
    choose(menuLabels().find(l => l.startsWith('Remove the modulation'))!);
    expect(c.effects()[1].targets?.some(Boolean) ?? false).toBe(false);
  });
});
