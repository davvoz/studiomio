// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserItem } from '../../../src/browser/item';
import { resolveParams } from '../../../src/devices/device-type';
import type { SampleData } from '../../../src/devices/dsp/core';
import { PIECES, pieceParam, pieceSlot, SOURCE as PIECE_SOURCE } from '../../../src/devices/instruments/cymbals/cymbals';
import { MODEL, padNote, padParam, padSlot } from '../../../src/devices/instruments/drums/drums';
import { BODY_SLOT, ROOT_NOTE, SOURCE } from '../../../src/devices/instruments/kick/kick';
import { DESTINATIONS, MOD_SLOTS, slotParam, SRC, tableSlot, USER_TABLE } from '../../../src/devices/instruments/prisma/prisma';
import { MODE, SENSITIVITY, SLICE, SLICE_COUNT, zoneMap, zoneParam, zoneSlot } from '../../../src/devices/instruments/sampler/sampler';
import { instrumentType } from '../../../src/devices/registry';
import type { SampleRef } from '../../../src/model/sample';
import { answerFileDialog, audioFile, button, choose, drag, dragEvent, dropItem, menuLabels, mouse, pick, settle, sizeCanvases, wheel } from '../../helpers/browser';
import { openChain, type ChainOptions } from '../../helpers/device-chain';
import { pointer, texts } from '../../helpers/dom';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const W = 400, H = 200;

/** A second of hits (a click every quarter of a second), to draw and slice. */
const hits: SampleData = {
  sampleRate: 44100,
  channels: [Float32Array.from({ length: 44100 }, (_, i) => (i % 11025 < 2000 ? Math.sin(i / 3) * Math.exp(-(i % 11025) / 400) : 0))],
};

/** The chain with the instrument, its canvases at W × H and drawn. */
function instrument(type: string, o: ChainOptions = {}) {
  const c = openChain({ ...o, instrument: { type, ...o.instrument } });
  const draw = () => {
    sizeCanvases(c.view.element, W, H);
    c.resize();
    c.frames.run(2);
  };
  draw();
  const values = () => resolveParams(instrumentType(type)!, c.instrument().params);
  const samples = () => c.instrument().samples ?? {};
  const param = (id: string) => c.q(`[data-param="${CSS.escape(id)}"]`);
  const canvas = (selector: string) => c.q<HTMLCanvasElement>(selector);
  return { ...c, refs: c.samples, draw, values, samples, param, canvas, drawn: (selector: string) => texts(c.canvases.of(canvas(selector))) };
}

const sampleItem = (s: SampleRef): BrowserItem => ({ id: s.id, name: s.name, icon: 'sample', payload: { kind: 'sample', sample: s } } as BrowserItem);
const fileItem = (name: string): BrowserItem => ({ id: name, name, icon: 'sample', payload: { kind: 'file', name, file: async () => audioFile(name) } } as BrowserItem);

describe('the Kick and the Snare', () => {
  it('the drawn hit plays with a click and says the note; its source is heard when it changes', () => {
    const c = instrument('kick');
    const wave = c.canvas('.lay-wave');
    expect(c.drawn('.lay-wave')).toContain('click: play');
    wave.dispatchEvent(pointer('pointerdown', 10, 10, { button: 2 }));
    wave.dispatchEvent(pointer('pointerdown', 10, 10));
    expect(c.auditioned).toEqual([ROOT_NOTE]);
    c.param('fine').dispatchEvent(wheel(0, 0, -100));
    c.frames.run();
    expect(c.drawn('.lay-wave').some(t => t.includes('ct'))).toBe(true);
    pick(c.param('note').querySelector('select')!, '3');
    expect([c.values().note, c.auditioned.length]).toEqual([3, 2]);
  });

  it('choosing a sample as the body lengthens the hit; the controls that don\'t count are removed', () => {
    const c = instrument('kick');
    pick(c.param('bodySource').querySelector('select')!, String(SOURCE.sample));
    expect(c.values()).toMatchObject({ bodySource: SOURCE.sample });
    expect(c.values().decay).toBeGreaterThanOrEqual(0.6);
    expect(c.param('pitch').hidden).toBe(true);
    expect(c.param('sampleTune').hidden).toBe(false);
    const choice = c.all<HTMLSelectElement>('.lay-sample').find(s => !s.closest<HTMLElement>('.lay-sample-row')!.hidden)!;
    expect([...choice.options].map(o => o.textContent)).toEqual(['— no sample —', 'one', 'two']);
    pick(choice, c.refs[1].id);
    expect(c.samples()[BODY_SLOT]).toBe(c.refs[1].id);
    c.frames.run();
  });

  it('a file or a browser sample dropped on a tab becomes its sample; a file that isn\'t audio doesn\'t', async () => {
    const c = instrument('snare', { audio: hits });
    const card = c.all('.lay-card')[1];
    card.dispatchEvent(dragEvent('dragover', [audioFile('a.wav')]));
    expect(card.classList.contains('drop')).toBe(true);
    card.dispatchEvent(new Event('dragleave'));
    expect(card.classList.contains('drop')).toBe(false);
    card.dispatchEvent(dragEvent('drop', [new File([], 'notes.txt'), audioFile('a.wav')]));
    await settle();
    expect(c.importSample).toHaveBeenCalledTimes(1);
    const first = c.samples()[BODY_SLOT];
    expect(first).toBeTruthy();
    dropItem(c.all('.lay-card')[1], sampleItem(c.refs[0]));
    expect(c.samples()[BODY_SLOT]).toBe(c.refs[0].id);
    dropItem(c.all('.lay-card')[1], fileItem('b.wav'));
    await settle();
    expect(c.importSample).toHaveBeenCalledTimes(2);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    c.all('.lay-card')[1].dispatchEvent(dragEvent('drop', [audioFile('broken.wav')]));
    await settle();
    expect(warn).toHaveBeenCalledOnce();
    answerFileDialog([audioFile('picked.wav')]);
    button(c.all('.lay-card')[1], 'Load…').click();
    await settle();
    expect(c.importSample).toHaveBeenCalledTimes(4);
  });
});

describe('Hats and Cymbals', () => {
  it('a pad chooses its piece and plays it; the knobs are that piece\'s', () => {
    const c = instrument('cymbals');
    const pads = c.all('.cym-pad');
    pads[2].dispatchEvent(pointer('pointerdown', 0, 0));
    expect(c.auditioned).toEqual([PIECES[2].note]);
    expect(c.q('.cym-card-title').textContent).toContain(PIECES[2].label);
    const before = c.values()[pieceParam(2, 'decay')];
    c.param(pieceParam(2, 'decay')).dispatchEvent(wheel(0, 0, -100));
    expect(c.values()[pieceParam(2, 'decay')]).toBeGreaterThan(before);
    c.canvas('.cym-wave').dispatchEvent(pointer('pointerdown', 0, 0));
    expect(c.auditioned).toHaveLength(2);
    c.played.push(PIECES[4].note);
    c.frames.run();
    expect(pads[4].classList.contains('hit')).toBe(true);
    pads[0].dispatchEvent(pointer('pointerdown', 0, 0));
  });

  it('a dropped file or sample makes the piece a sample one; without audio the drawing says what to do', async () => {
    const c = instrument('cymbals');
    const pad = c.all('.cym-pad')[1];
    pad.dispatchEvent(dragEvent('dragover', [audioFile('a.wav')]));
    expect(pad.classList.contains('drop')).toBe(true);
    pad.dispatchEvent(dragEvent('drop', [audioFile('a.wav')]));
    await settle();
    expect(c.values()[pieceParam(1, 'source')]).toBe(PIECE_SOURCE.sample);
    expect(c.samples()[pieceSlot(1)]).toBeTruthy();
    c.frames.run();
    expect(c.drawn('.cym-wave').some(t => t.startsWith('No sample'))).toBe(true);
    pick(c.q<HTMLSelectElement>('.cym-sample'), c.refs[0].id);
    expect(c.samples()[pieceSlot(1)]).toBe(c.refs[0].id);
    pick(c.q<HTMLSelectElement>('.cym-sample'), '');
    expect(c.samples()[pieceSlot(1)]).toBeUndefined();
    dropItem(c.all('.cym-pad')[3], sampleItem(c.refs[1]));
    expect(c.samples()[pieceSlot(3)]).toBe(c.refs[1].id);
    dropItem(c.all('.cym-pad')[4], fileItem('f.wav'));
    await settle();
    expect(c.samples()[pieceSlot(4)]).toBeTruthy();
    answerFileDialog([audioFile('broken.wav')]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    button(c.q('.cym-sample-row'), 'Load…').click();
    await settle();
    expect(warn).toHaveBeenCalledOnce();
    c.all('.cym-pad')[0].dispatchEvent(pointer('pointerdown', 0, 0));
  });
});

describe('the Drum Machine', () => {
  const pad = (c: ReturnType<typeof instrument>, i: number) => c.q(`.drum-pad[data-pad="${i}"]`);

  it('a pad plays, is chosen and lights up with its notes; its sound is changed from the menu', () => {
    const c = instrument('drums');
    document.elementFromPoint = () => null;
    drag(pad(c, 3), [[0, 0]]);
    expect(c.auditioned).toEqual([padNote(3)]);
    expect(c.q('.drum-pad-title').textContent).toContain('Pad 4');
    pad(c, 5).classList.remove('hit');
    c.played.push(padNote(5));
    c.frames.run();
    expect(pad(c, 5).classList.contains('hit')).toBe(true);
    pick(c.q<HTMLSelectElement>('.drum-model'), String(MODEL.sample));
    expect(c.values()[padParam(3, 'model')]).toBe(MODEL.sample);
    expect(c.q('.drum-hint').textContent).toContain('Drag an audio file');
    pick(c.q<HTMLSelectElement>('.drum-sample'), c.refs[0].id);
    expect(c.samples()[padSlot(3)]).toBe(c.refs[0].id);
    pad(c, 3).dispatchEvent(mouse('contextmenu'));
    choose('Remove the sample');
    expect(c.samples()[padSlot(3)]).toBeUndefined();
    pad(c, 3).dispatchEvent(mouse('contextmenu'));
    choose('Reset the pad to the starting kit');
    expect(c.values()[padParam(3, 'model')]).not.toBe(MODEL.sample);
  });

  it('dragged onto another the two pads swap, with Ctrl it\'s copied; the samples go with them', () => {
    const c = instrument('drums');
    const models = () => [c.values()[padParam(0, 'model')], c.values()[padParam(1, 'model')]];
    const [a, b] = models();
    expect(a).not.toBe(b);
    document.elementFromPoint = () => pad(c, 1);
    drag(pad(c, 0), [[0, 0], [50, 0]]);
    expect(models()).toEqual([b, a]);
    c.store.undo();
    drag(pad(c, 0), [[0, 0], [50, 0]], { ctrlKey: true });
    expect(models()).toEqual([a, a]);
    c.store.undo();
    document.elementFromPoint = () => null;
    drag(pad(c, 0), [[0, 0]]);
    pick(c.q<HTMLSelectElement>('.drum-model'), String(MODEL.sample));
    pick(c.q<HTMLSelectElement>('.drum-sample'), c.refs[1].id);
    document.elementFromPoint = () => pad(c, 1);
    drag(pad(c, 0), [[0, 0], [50, 0]]);
    expect(c.samples()[padSlot(1)]).toBe(c.refs[1].id);
    expect(c.samples()[padSlot(0)]).toBeUndefined();
  });

  it('a pad can hold a whole instrument, with its panel and its presets', async () => {
    const c = instrument('drums', { audio: hits });
    document.elementFromPoint = () => null;
    drag(pad(c, 0), [[0, 0]]);
    pick(c.q<HTMLSelectElement>('.drum-model'), String(MODEL.kickInst));
    expect(c.q('.drum-inner .lay')).toBeTruthy();
    c.draw();
    const knob = c.q('.drum-inner .knob[data-param]'), id = knob.dataset.param!;
    expect(id.startsWith('p1.')).toBe(true);
    const before = c.values()[id];
    knob.dispatchEvent(wheel(0, 0, before > 0 ? 100 : -100));
    expect(c.values()[id]).not.toBe(before);
    c.q('.drum-inner .lay-wave').dispatchEvent(pointer('pointerdown', 0, 0));
    expect(c.auditioned.at(-1)).toBe(padNote(0));
    const presets = c.q<HTMLSelectElement>('.drum-inner-preset');
    pick(presets, presets.options[2].value);
    expect(c.q<HTMLSelectElement>('.drum-inner-preset').value).toBe('');
    c.q('.drum-inner .lay-card').dispatchEvent(dragEvent('drop', [audioFile('click.wav')]));
    await settle();
    expect(Object.keys(c.samples()).some(s => s.startsWith('p1.'))).toBe(true);
    // the cymbals: the piece chosen inside is the one the pad plays
    pick(c.q<HTMLSelectElement>('.drum-model'), String(MODEL.cymbalsInst));
    c.draw();
    c.all('.drum-inner .cym-pad')[2].dispatchEvent(pointer('pointerdown', 0, 0));
    expect(c.values()[padParam(0, 'piece')]).toBe(2);
    c.played.push(padNote(0));
    c.frames.run(2);
    expect(c.all('.drum-inner .cym-pad')[2].classList.contains('hit')).toBe(true);
    // copied, the instrument goes along
    document.elementFromPoint = () => pad(c, 4);
    drag(pad(c, 0), [[0, 0], [50, 0]], { ctrlKey: true });
    expect(c.values()[padParam(4, 'model')]).toBe(MODEL.cymbalsInst);
  });

  it('Load… puts a file on the pad', async () => {
    const c = instrument('drums');
    answerFileDialog([audioFile('snap.wav')]);
    pad(c, 2).dispatchEvent(mouse('contextmenu'));
    choose('Load a sample…');
    await settle();
    expect(c.samples()[padSlot(2)]).toBeTruthy();
    pad(c, 2).dispatchEvent(mouse('contextmenu'));
    choose(menuLabels()[0]);
    expect(c.values()[padParam(2, 'model')]).not.toBe(MODEL.sample);
  });
});

describe('the Wavetable', () => {
  it('the table\'s position is dragged on its drawing, finer with Shift; one undo step', () => {
    const c = instrument('wavetable');
    const view = c.canvas('.wt-view'), start = c.values().posA;
    view.dispatchEvent(pointer('pointermove', 0, 50));
    drag(view, [[0, 150], [0, 130], [0, 100]]);
    const moved = c.values().posA - start;
    expect(moved).toBeGreaterThan(0);
    c.store.undo();
    expect(c.values().posA).toBe(start);
    drag(view, [[0, 150], [0, 100]], { shiftKey: true });
    expect(c.values().posA - start).toBeLessThan(moved);
    c.draw();
    expect(c.drawn('.wt-view').at(-1)).toMatch(/ %$/);
  });
});

describe('Prisma', () => {
  const tab = (c: ReturnType<typeof instrument>, name: string) => c.all<HTMLButtonElement>('.prisma-tabs button').find(b => b.textContent!.startsWith(name))!;
  const chip = (c: ReturnType<typeof instrument>, name: string) => c.all('.prisma-chip').find(e => e.firstChild!.textContent === name)!;
  const slot = (c: ReturnType<typeof instrument>, n: number) => {
    const v = c.values();
    return { src: v[slotParam(n, 'Src')], dst: DESTINATIONS[v[slotParam(n, 'Dst')] - 1]?.label, amount: v[slotParam(n, 'Amt')], bipolar: v[slotParam(n, 'Pol')] };
  };

  it('a source dragged onto a knob modulates it: a slot of the matrix, a ring, a count on the chip', () => {
    const c = instrument('prisma');
    tab(c, 'Oscillators').click();
    const cutoff = c.param('f1Cutoff');
    document.elementFromPoint = () => cutoff;
    const lfo = chip(c, 'LFO 1');
    lfo.dispatchEvent(pointer('pointerdown', 0, 0));
    lfo.dispatchEvent(pointer('pointermove', 2, 0));
    expect(document.querySelector('.prisma-ghost')).toBeNull();
    lfo.dispatchEvent(pointer('pointermove', 60, 60));
    expect(cutoff.classList.contains('drop-target')).toBe(true);
    lfo.dispatchEvent(pointer('pointerup', 60, 60));
    expect(document.querySelector('.prisma-ghost')).toBeNull();
    expect(slot(c, 1)).toMatchObject({ src: SRC.lfo1, amount: 25, bipolar: 1 });
    expect(cutoff.classList.contains('modulated')).toBe(true);
    expect(chip(c, 'LFO 1').querySelector('.prisma-chip-count')!.textContent).toBe('1');
    expect(tab(c, 'Matrix').textContent).toBe('Matrix · 1');
    // again on the same knob: the same slot
    drag(lfo, [[0, 0], [60, 60]]);
    expect(slot(c, 2).src).toBe(0);
    // where nothing can be modulated, nothing happens
    document.elementFromPoint = () => null;
    drag(chip(c, 'Vel'), [[0, 0], [60, 60]]);
    expect(slot(c, 2).src).toBe(0);
  });

  it('a chosen source: Alt+drag on a knob gives its amount, in one undo step; the menu lists and removes', () => {
    const c = instrument('prisma');
    tab(c, 'Oscillators').click();
    drag(chip(c, 'Env 2'), [[0, 0]]);
    expect(chip(c, 'Env 2').classList.contains('active')).toBe(true);
    const pos = c.param('aPos'), still = c.values().aPos;
    drag(pos, [[0, 150], [0, 120], [0, 75]], { altKey: true });
    expect(slot(c, 1)).toMatchObject({ src: SRC.env2, amount: 50, bipolar: 0 });
    expect(c.values().aPos).toBe(still);
    c.store.undo();
    expect(slot(c, 1).src).toBe(0);
    c.param('aPos').dispatchEvent(mouse('contextmenu'));
    choose(menuLabels().find(l => l.startsWith('Modulate with'))!);
    expect(slot(c, 1).src).toBe(SRC.env2);
    c.param('aPos').dispatchEvent(mouse('contextmenu'));
    choose('Show in the matrix');
    expect(tab(c, 'Matrix').classList.contains('on')).toBe(true);
    tab(c, 'Oscillators').click();
    c.param('aPos').dispatchEvent(mouse('contextmenu'));
    choose(menuLabels().find(l => l.startsWith('Remove'))!);
    expect(slot(c, 1).src).toBe(0);
    drag(chip(c, 'Env 2'), [[0, 0]]);
    expect(chip(c, 'Env 2').classList.contains('active')).toBe(false);
  });

  it('with the matrix full its tab blinks instead', () => {
    vi.useFakeTimers();
    const full = Object.fromEntries(Array.from({ length: MOD_SLOTS }, (_, i) => [[slotParam(i + 1, 'Src'), SRC.velocity], [slotParam(i + 1, 'Dst'), 1]] as const).flat());
    const c = instrument('prisma', { instrument: { params: full } });
    tab(c, 'Oscillators').click();
    document.elementFromPoint = () => c.param('f1Cutoff');
    drag(chip(c, 'LFO 2'), [[0, 0], [60, 60]]);
    expect(tab(c, 'Matrix').classList.contains('full')).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(tab(c, 'Matrix').classList.contains('full')).toBe(false);
    vi.useRealTimers();
  });

  it('the matrix: source, target, aux, polarity, amount and curve of a slot, and clearing it', () => {
    const c = instrument('prisma');
    tab(c, 'Matrix').click();
    const row = () => c.q('.prisma-row');
    pick(row().querySelector<HTMLSelectElement>('.prisma-src-select')!, String(SRC.macro1));
    pick(row().querySelector<HTMLSelectElement>('.prisma-dst-select')!, '2');
    pick(row().querySelector<HTMLSelectElement>('.prisma-aux-select')!, String(SRC.velocity));
    row().querySelector<HTMLButtonElement>('.prisma-pol')!.click();
    expect(row().classList.contains('empty')).toBe(false);
    const [amount, curve] = row().querySelectorAll<HTMLElement>('.prisma-slider');
    drag(amount, [[0, 0], [20, 0]]);
    expect(slot(c, 1)).toMatchObject({ src: SRC.macro1, bipolar: 1 });
    expect(slot(c, 1).amount).toBeGreaterThan(0);
    amount.dispatchEvent(wheel(0, 0, 100, { shiftKey: true }));
    amount.dispatchEvent(mouse('dblclick'));
    expect(slot(c, 1).amount).toBe(0);
    drag(curve, [[0, 0], [-20, 0]]);
    expect(c.values()[slotParam(1, 'Curve')]).toBeLessThan(0);
    button(row(), '×').click();
    expect(row().classList.contains('empty')).toBe(true);
    expect(c.values()[slotParam(1, 'Aux')]).toBe(0);
  });

  it('the modulators\' page: each envelope and LFO with its controls', () => {
    const c = instrument('prisma');
    tab(c, 'Modulators').click();
    button(c.view.element, 'Env 3').click();
    expect(c.param('e3A').parentElement!.hidden).toBe(false);
    expect(c.param('e1A').parentElement!.hidden).toBe(true);
    c.all<HTMLButtonElement>('.prisma-subtabs button').find(b => b.textContent === 'LFO 4')!.click();
    expect(c.param('l4Rate').parentElement!.hidden).toBe(false);
    c.draw();
    expect(c.drawn('.prisma-lfo').at(-1)).toContain('LFO 4');
    expect(c.drawn('.prisma-env').at(-1)).toContain('Env 3');
    button(c.view.element, 'Env 1 · vol').click();
  });

  it('⏻ turns a section on; the table is dragged; a WAV dropped or imported becomes the table', async () => {
    const c = instrument('prisma', { audio: hits });
    tab(c, 'Oscillators').click();
    const on = c.values().bOn;
    c.q('button[data-param="bOn"]').click();
    expect(c.values().bOn).toBe(1 - on);
    c.draw();
    const table = c.canvas('.prisma-table'), start = c.values().aPos;
    drag(table, [[0, 150], [0, 100]], { altKey: true });
    expect(c.values().aPos).toBe(start);
    drag(table, [[0, 150], [0, 100]]);
    expect(c.values().aPos).not.toBe(start);
    table.dispatchEvent(dragEvent('dragover', [audioFile('wt.wav')]));
    expect(table.classList.contains('drop')).toBe(true);
    table.dispatchEvent(dragEvent('drop', [new File([], 'readme.txt')]));
    expect(table.classList.contains('drop')).toBe(false);
    table.dispatchEvent(dragEvent('drop', [audioFile('wt.wav')]));
    await settle();
    expect(c.values().aTable).toBe(USER_TABLE);
    expect(c.samples()[tableSlot('a')]).toBeTruthy();
    c.draw();
    expect(c.drawn('.prisma-table')).toContain('wt.wav');
    answerFileDialog([audioFile('other.wav')]);
    button(c.view.element, 'Import…').click();
    await settle();
    expect(c.importSample).toHaveBeenCalledTimes(2);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    table.dispatchEvent(dragEvent('drop', [audioFile('broken.wav')]));
    await settle();
    expect(error).toHaveBeenCalledOnce();
  });
});

describe('the Sampler', () => {
  const sampler = (over: ChainOptions['instrument'] = {}) => {
    const c = instrument('sampler', { audio: hits, instrument: over });
    const tab = (name: string) => c.all<HTMLButtonElement>('.smp-tabs button').find(b => b.textContent === name)!;
    return { ...c, tab, info: () => c.q('.smp-info').textContent };
  };
  /** Two zones: the first file on its own, the second added. */
  const zoned = async () => {
    const c = sampler();
    c.q('.smp').dispatchEvent(dragEvent('drop', [audioFile('low.wav'), audioFile('high.wav')]));
    await settle();
    c.draw();
    return c;
  };

  it('a dropped file becomes the sample, is heard, and its length is written', async () => {
    const c = sampler();
    c.q('.smp').dispatchEvent(dragEvent('dragover', [audioFile('a.wav')]));
    expect(c.q('.smp').classList.contains('drop')).toBe(true);
    c.q('.smp').dispatchEvent(new Event('dragleave'));
    c.q('.smp').dispatchEvent(dragEvent('drop', [audioFile('a.wav')]));
    await settle();
    expect(c.samples()[zoneSlot(0)]).toBeTruthy();
    expect(c.auditioned).toEqual([60]);
    c.frames.run();
    expect(c.info()).toBe('1.00 s · 44.1 kHz · mono');
    c.q('.smp').dispatchEvent(dragEvent('drop', [audioFile('broken.wav')]));
    await settle();
    expect(c.info()).toContain('Can\'t load "broken.wav"');
    pick(c.q<HTMLSelectElement>('.smp-sample'), c.refs[0].id);
    expect(c.samples()[zoneSlot(0)]).toBe(c.refs[0].id);
    pick(c.q<HTMLSelectElement>('.smp-sample'), '');
    expect(c.samples()[zoneSlot(0)]).toBeUndefined();
    dropItem(c.q('.smp'), sampleItem(c.refs[1]));
    expect(c.samples()[zoneSlot(0)]).toBe(c.refs[1].id);
    answerFileDialog([audioFile('picked.wav')]);
    button(c.view.element, 'Load…').click();
    await settle();
    expect(c.importSample).toHaveBeenCalledTimes(3);
  });

  it('several files become zones, one key each; a zone is chosen, removed, spread on the keyboard', async () => {
    const c = await zoned();
    expect(Object.keys(c.samples())).toEqual([zoneSlot(0), zoneSlot(1)]);
    expect(c.tab('Zones').classList.contains('on')).toBe(true);
    expect([0, 1].map(z => zoneMap(c.values(), z).lo)).toEqual([36, 37]);
    const zones = c.q<HTMLSelectElement>('.smp-zone-pick');
    expect([...zones.options].map(o => o.textContent)).toEqual(['Zone 1 · low.wav', 'Zone 2 · high.wav']);
    const menu = (label: string) => {
      c.canvas('.smp-wave-box canvas:not([hidden])').dispatchEvent(mouse('contextmenu', 5, 5));
      choose(label);
    };
    menu('All on the whole keyboard');
    expect(zoneMap(c.values(), 1)).toMatchObject({ lo: 0, hi: 127 });
    menu('Split the keyboard between the root notes');
    expect(zoneMap(c.values(), 0).hi).toBeLessThan(zoneMap(c.values(), 1).lo);
    menu('One key per zone, from C1');
    expect([0, 1].map(z => zoneMap(c.values(), z).lo)).toEqual([36, 37]);
    menu('Show the whole keyboard');
    pick(zones, '1');
    expect(c.q('.smp-zone-card .smp-card-title').textContent).toBe('Zone 2');
    button(c.q('.smp-zone-card'), 'Remove').click();
    expect(Object.keys(c.samples())).toEqual([zoneSlot(0)]);
    c.tab('Sample').click();
  });

  it('a zone follows the first one\'s sound until it\'s touched; the link gives it back', async () => {
    const c = await zoned();
    pick(c.q<HTMLSelectElement>('.smp-zone-pick'), '1');
    c.tab('Sample').click();
    const link = button(c.view.element, 'Like zone 1');
    expect([link.hidden, link.classList.contains('on')]).toEqual([false, true]);
    const first = c.values().fCutoff;
    c.q('[data-param="fOn"]').click();
    expect(c.values()[zoneParam(1, 'own')]).toBe(1);
    c.q('[data-param="fCutoff"]').dispatchEvent(wheel(0, 0, 100));
    expect(c.values().fCutoff).toBe(first);
    expect(c.values()[zoneParam(1, 'fCutoff')]).toBeLessThan(first);
    link.click();
    expect(c.values()[zoneParam(1, 'own')]).toBe(0);
    link.click();
    expect(c.values()[zoneParam(1, 'own')]).toBe(1);
    pick(c.q<HTMLSelectElement>('.smp-zone-pick'), '0');
    expect(link.hidden).toBe(true);
  });

  it('files dropped on the zone editor start from the key under the pointer; on a name they change its sample', async () => {
    const c = await zoned();
    const zones = c.all<HTMLCanvasElement>('.smp-wave-box canvas')[1];
    document.elementFromPoint = () => zones;
    const at = (x: number, y: number, name: string) => {
      const e = dragEvent('drop', [audioFile(name)]);
      Object.assign(e, { clientX: x, clientY: y });
      c.q('.smp').dispatchEvent(e);
    };
    at(W * 0.6, 60, 'third.wav');
    await settle();
    expect(Object.keys(c.samples())).toHaveLength(3);
    const second = c.samples()[zoneSlot(1)];
    dropItem(c.q('.smp'), sampleItem(c.refs[0]), W * 0.8, 60);
    expect(Object.keys(c.samples())).toHaveLength(4);
    dropItem(c.q('.smp'), fileItem('fifth.wav'), W * 0.9, 60);
    await settle();
    expect(Object.keys(c.samples())).toHaveLength(5);
    expect(c.samples()[zoneSlot(1)]).toBe(second);
    answerFileDialog([audioFile('sixth.wav')]);
    button(c.view.element, '+ Zones…').click();
    await settle();
    expect(Object.keys(c.samples())).toHaveLength(6);
    answerFileDialog([audioFile('broken.wav')]);
    button(c.view.element, '+ Zones…').click();
    await settle();
    expect(c.info()).toContain('Can\'t load the files');
    c.tab('Sample').click();
  });

  it('in Slice the slices are found at the transients, again with another sensitivity, and removed', async () => {
    const c = sampler();
    c.q('.smp').dispatchEvent(dragEvent('drop', [audioFile('loop.wav')]));
    await settle();
    const modes = c.q('.smp-mode');
    modes.querySelectorAll('button')[MODE.slice].click();
    expect(c.values().mode).toBe(MODE.slice);
    expect(c.values()[SLICE_COUNT]).toBeGreaterThan(1);
    expect(c.tab('Zones').hidden).toBe(true);
    c.draw();
    const wave = c.canvas('.smp-wave-box canvas');
    const menu = (label: string) => {
      wave.dispatchEvent(mouse('contextmenu', 5, 100));
      choose(label);
    };
    menu('Remove all the slices');
    expect(c.values()[SLICE_COUNT]).toBe(0);
    button(c.view.element, 'Detect').click();
    const n = c.values()[SLICE_COUNT];
    expect(n).toBeGreaterThan(1);
    c.param(SENSITIVITY).dispatchEvent(wheel(0, 0, -100));
    menu('Detect the slices at the transients');
    menu('Show the whole sample');
    const by = c.param('sliceBy').querySelector('select')!;
    pick(by, String(1 - SLICE.transients));
    expect(c.values().sliceBy).toBe(1 - SLICE.transients);
    expect(button(c.view.element, 'Detect').hidden).toBe(true);
    pick(by, String(SLICE.transients));
    menu('Remove the sample');
    expect(c.samples()[zoneSlot(0)]).toBeUndefined();
  });

  it('the envelopes have their tabs; the voices\' cursors are drawn while they play', async () => {
    const c = sampler();
    c.q('.smp').dispatchEvent(dragEvent('drop', [audioFile('a.wav')]));
    await settle();
    const tabs = c.all<HTMLButtonElement>('.smp-env-card .smp-tabs button');
    tabs[1].click();
    expect(c.param('e2A')).toBeTruthy();
    c.param('e2A').dispatchEvent(wheel(0, 0, -100));
    tabs[0].click();
    expect(c.all('[data-param="e2A"]')).toHaveLength(0);
    c.draw();
    const g = c.canvases.of(c.canvas('.smp-wave-box canvas'));
    c.setPlayheads([0.5]);
    const n = g.drawn.length;
    c.frames.run();
    expect(g.drawn.length).toBeGreaterThan(n);
  });
});
