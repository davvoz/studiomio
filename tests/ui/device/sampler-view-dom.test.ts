// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SampleData } from '../../../src/devices/dsp/core';
import { LOOP, MODE, SLICE, SLICE_COUNT, sliceParam, sliceValues, zoneParam } from '../../../src/devices/instruments/sampler/sampler';
import { KEYS_H, NAME_W, ROW_H, type ZoneRow } from '../../../src/ui/device/sampler/zone-geometry';
import { WaveView, type WaveHost } from '../../../src/ui/device/sampler/wave-view';
import { ZoneView, type ZoneHost } from '../../../src/ui/device/sampler/zone-view';
import { Peaks } from '../../../src/ui/waveform';
import { pointer, recordCanvases, sized, texts } from '../../helpers/dom';

let canvases: ReturnType<typeof recordCanvases>;
beforeEach(() => {
  vi.restoreAllMocks();
  canvases = recordCanvases();
});

/** A wheel turn at (x, y): happy-dom's WheelEvent isn't a MouseEvent, so the position and Shift are added. */
function wheel(x: number, y: number, init: WheelEventInit): WheelEvent {
  const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  return Object.defineProperties(e, {
    clientX: { value: x }, clientY: { value: y }, shiftKey: { value: !!init.shiftKey },
  });
}
const mouse = (type: string, x: number, y: number) => new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });

// ------------------------------------------------------------------ waveform

const DATA: SampleData = { sampleRate: 100, channels: [Float32Array.from({ length: 400 }, (_, i) => Math.sin(i / 5))] };

/** A Classic Sampler playing 10 % … 90 %, looping 30 … 70 %, on a canvas 1000 × 200. */
function waveView(over: Record<string, number> = {}, audio: SampleData | null = DATA) {
  let values: Record<string, number> = {
    mode: MODE.classic, start: 10, end: 90, loop: LOOP.forward, loopStart: 30, loopEnd: 70, xfade: 0, reverse: 0,
    sliceBy: SLICE.transients, sliceGrid: 2, [SLICE_COUNT]: 0, ...over,
  };
  let heads: number[] = [];
  const host = {
    values: () => values, audio: () => audio ?? undefined, name: () => 'kick.wav',
    set: vi.fn<WaveHost['set']>(), playSlice: vi.fn<WaveHost['playSlice']>(), playheads: () => heads, menu: vi.fn<WaveHost['menu']>(),
  };
  const view = new WaveView(host);
  view.canvas.setPointerCapture = vi.fn();
  sized(view.canvas, 1000, 200);
  return {
    view, host, g: canvases.of(view.canvas), c: view.canvas,
    setValues: (v: Record<string, number>) => { values = { ...values, ...v }; },
    setHeads: (h: number[]) => { heads = h; },
  };
}

describe('Sampler waveform view', () => {
  it('the pointer over a marker, the loop band or nothing: its cursor, a redraw only when it changes', () => {
    const { c, g } = waveView();
    c.dispatchEvent(pointer('pointermove', 100, 5));
    expect(c.style.cursor).toBe('ew-resize');
    const drawn = g.drawn.length;
    expect(drawn).toBeGreaterThan(0);
    c.dispatchEvent(pointer('pointermove', 101, 5));
    expect(g.drawn).toHaveLength(drawn);
    c.dispatchEvent(pointer('pointermove', 500, 195));
    expect(c.style.cursor).toBe('grab');
    c.dispatchEvent(pointer('pointermove', 500, 100));
    expect(c.style.cursor).toBe('default');
    // with a button held the move belongs to a drag
    c.dispatchEvent(pointer('pointermove', 100, 5, { buttons: 1 }));
    expect(c.style.cursor).toBe('default');
    // leaving redraws only if something was lit
    c.dispatchEvent(pointer('pointermove', 100, 5));
    const before = g.drawn.length;
    c.dispatchEvent(new PointerEvent('pointerleave'));
    expect(g.drawn.length).toBeGreaterThan(before);
    const after = g.drawn.length;
    c.dispatchEvent(new PointerEvent('pointerleave'));
    expect(g.drawn).toHaveLength(after);
  });

  it('in Slice the empty space shows a hand; without a sample nothing is under the pointer', () => {
    const sliced = waveView({ mode: MODE.slice });
    sliced.c.dispatchEvent(pointer('pointermove', 500, 100));
    expect(sliced.c.style.cursor).toBe('pointer');
    const empty = waveView({}, null);
    empty.c.dispatchEvent(pointer('pointermove', 100, 5));
    expect(empty.c.style.cursor).toBe('default');
  });

  it('drags a marker (Shift: a quarter of the speed), the loop band whole; the release confirms', () => {
    const { c, host } = waveView();
    c.dispatchEvent(pointer('pointerdown', 100, 5, { button: 2 }));
    expect(c.setPointerCapture).not.toHaveBeenCalled();
    c.dispatchEvent(pointer('pointerdown', 100, 5));
    c.dispatchEvent(pointer('pointermove', 150, 5));
    expect(host.set).toHaveBeenLastCalledWith({ start: 15 }, false);
    c.dispatchEvent(pointer('pointermove', 190, 5, { shiftKey: true }));
    expect(host.set).toHaveBeenLastCalledWith({ start: 16 }, false);
    c.dispatchEvent(pointer('pointerup', 190, 5));
    expect(host.set).toHaveBeenLastCalledWith({ start: 16 }, true);

    host.set.mockClear();
    c.dispatchEvent(pointer('pointerdown', 500, 195));
    c.dispatchEvent(pointer('pointermove', 600, 195));
    c.dispatchEvent(pointer('pointerup', 600, 195));
    expect(host.set.mock.calls).toEqual([[{ loopStart: 40, loopEnd: 80 }, false], [{ loopStart: 40, loopEnd: 80 }, true]]);
    // released without moving: nothing to confirm
    host.set.mockClear();
    c.dispatchEvent(pointer('pointerdown', 900, 5));
    c.dispatchEvent(pointer('pointerup', 900, 5));
    expect(host.set).not.toHaveBeenCalled();
  });

  it('in Slice a click on a slice plays it; before the start or in Classic nothing plays', () => {
    const { c, host } = waveView({ mode: MODE.slice, [SLICE_COUNT]: 2, [sliceParam(1)]: 0.4, [sliceParam(2)]: 0.6 });
    c.dispatchEvent(pointer('pointerdown', 500, 100));
    c.dispatchEvent(pointer('pointerdown', 700, 100));
    c.dispatchEvent(pointer('pointerdown', 50, 100));
    expect(host.playSlice.mock.calls).toEqual([[1], [2]]);
    const classic = waveView();
    classic.c.dispatchEvent(pointer('pointerdown', 500, 100));
    expect(classic.host.playSlice).not.toHaveBeenCalled();
  });

  it('slicing by transients a double click adds a slice, or removes the one under it; not on another marker', () => {
    const { c, host } = waveView({ mode: MODE.slice, [SLICE_COUNT]: 1, [sliceParam(1)]: 0.4 });
    c.dispatchEvent(mouse('dblclick', 600, 100));
    expect(host.set).toHaveBeenLastCalledWith(sliceValues([0.4, 0.6]), true);
    c.dispatchEvent(mouse('dblclick', 400, 5));
    expect(host.set).toHaveBeenLastCalledWith(sliceValues([]), true);
    host.set.mockClear();
    c.dispatchEvent(mouse('dblclick', 100, 5));
    expect(host.set).not.toHaveBeenCalled();
  });

  it('the wheel zooms around the pointer and Shift scrolls; double click on empty space shows everything again', () => {
    const { c } = waveView();
    const zoom = wheel(500, 100, { deltaY: -500 });
    c.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(true);
    // zoomed in around the middle: Start (10 %) is out of view
    c.dispatchEvent(pointer('pointermove', 100, 5));
    expect(c.style.cursor).toBe('default');
    c.dispatchEvent(wheel(500, 100, { deltaY: -100000, shiftKey: true }));
    c.dispatchEvent(wheel(500, 100, { deltaX: -100000, deltaY: 0 }));
    // scrolled to the start, still zoomed: Start is at x ≈ 212, not 100
    c.dispatchEvent(pointer('pointermove', 100, 5));
    expect(c.style.cursor).not.toBe('ew-resize');
    // a double click on empty space shows the whole sample: Start is back at x 100
    c.dispatchEvent(mouse('dblclick', 500, 100));
    c.dispatchEvent(pointer('pointermove', 100, 5));
    expect(c.style.cursor).toBe('ew-resize');
  });

  it('the wheel without a sample does nothing; the right click opens the menu', () => {
    const { c, host } = waveView({}, null);
    const turn = wheel(500, 100, { deltaY: -500 });
    c.dispatchEvent(turn);
    expect(turn.defaultPrevented).toBe(false);
    const right = mouse('contextmenu', 30, 40);
    c.dispatchEvent(right);
    expect(right.defaultPrevented).toBe(true);
    expect(host.menu).toHaveBeenCalledWith(30, 40);
  });

  it('draws the sample\'s name without audio, the peaks once per sample (forward or reversed)', () => {
    const empty = waveView({}, null);
    empty.view.paint();
    expect(texts(empty.g)).toContain('Loading "kick.wav"…');
    const from = vi.spyOn(Peaks, 'from');
    const { view, setValues } = waveView();
    view.paint();
    view.paint();
    setValues({ reverse: 1 });
    view.setEnabled(false);
    view.paint();
    expect(from).toHaveBeenCalledOnce();
  });

  it('nothing is drawn before the canvas has a size', () => {
    const view = new WaveView({
      values: () => ({}), audio: () => undefined, name: () => null, set: vi.fn(), playSlice: vi.fn(), playheads: () => [], menu: vi.fn(),
    });
    view.paint();
    expect(canvases.of(view.canvas).drawn).toEqual([]);
  });

  it('redraws at each frame while voices play, once more when they stop, then no more', () => {
    const { view, g, setHeads } = waveView();
    view.tick();
    expect(g.drawn).toEqual([]);
    setHeads([0.5]);
    view.tick();
    const playing = g.drawn.length;
    expect(playing).toBeGreaterThan(0);
    setHeads([]);
    view.tick();
    const stopped = g.drawn.length;
    expect(stopped).toBeGreaterThan(playing);
    view.tick();
    expect(g.drawn).toHaveLength(stopped);
  });
});

// ------------------------------------------------------------------ zones

/** Three zones on keys 36–47, 48–59 and 60 alone, on a canvas 118 + 128 × 4 px wide (4 px a key). */
function zoneView(rowCount = 3, height = KEYS_H + 6 * ROW_H) {
  const values: Record<string, number> = {};
  const zone = (i: number, lo: number, hi: number, root: number) =>
    Object.assign(values, { [zoneParam(i, 'lo')]: lo, [zoneParam(i, 'hi')]: hi, [zoneParam(i, 'root')]: root, [zoneParam(i, 'vlo')]: 1, [zoneParam(i, 'vhi')]: 127 });
  zone(0, 36, 47, 40);
  zone(1, 48, 59, 50);
  zone(2, 60, 60, 60);
  for (let i = 3; i < rowCount; i++) zone(i, 61, 61, 61);
  const rows: ZoneRow[] = Array.from({ length: rowCount }, (_, i) => ({ index: i, name: `zone ${i}` }));
  let selected = 0, sounding = new Set<number>(), played: number[] = [];
  const host = {
    values: () => values, rows: () => rows, selected: () => selected,
    select: vi.fn((z: number) => { selected = z; }), set: vi.fn<ZoneHost['set']>(), audition: vi.fn<ZoneHost['audition']>(),
    sounding: () => sounding, played: () => { const p = played; played = []; return p; },
    add: vi.fn(), pitched: () => true, menu: vi.fn<ZoneHost['menu']>(),
  };
  const view = new ZoneView(host);
  view.canvas.setPointerCapture = vi.fn();
  sized(view.canvas, NAME_W + 128 * 4, height);
  return {
    view, host, g: canvases.of(view.canvas), c: view.canvas,
    setSounding: (s: number[]) => { sounding = new Set(s); },
    play: (...keys: number[]) => { played = keys; },
  };
}

/** The x of a key's middle, the y of a row's middle (4 px a key, whole keyboard). */
const keyX = (k: number) => NAME_W + k * 4 + 2;
const rowY = (i: number) => KEYS_H + i * ROW_H + ROW_H / 2;

describe('Sampler zone view', () => {
  it('the pointer over an edge, a bar, a name, a key: its cursor, a redraw when it changes; leaving redraws', () => {
    const { c, g } = zoneView();
    c.dispatchEvent(pointer('pointermove', NAME_W + 36 * 4, rowY(0)));
    expect(c.style.cursor).toBe('ew-resize');
    const drawn = g.drawn.length;
    c.dispatchEvent(pointer('pointermove', NAME_W + 36 * 4 + 1, rowY(0)));
    expect(g.drawn).toHaveLength(drawn);
    c.dispatchEvent(pointer('pointermove', keyX(42), rowY(0)));
    expect(c.style.cursor).toBe('grab');
    c.dispatchEvent(pointer('pointermove', 20, rowY(1)));
    expect(c.style.cursor).toBe('pointer');
    c.dispatchEvent(pointer('pointermove', keyX(100), rowY(1)));
    expect(c.style.cursor).toBe('default');
    c.dispatchEvent(pointer('pointermove', keyX(100), rowY(1), { buttons: 1 }));
    const before = g.drawn.length;
    c.dispatchEvent(new PointerEvent('pointerleave'));
    expect(g.drawn.length).toBeGreaterThan(before);
  });

  it('a click on the keyboard plays the key, on a name or a row chooses the zone; the right button nothing', () => {
    const { c, host } = zoneView();
    c.dispatchEvent(pointer('pointerdown', keyX(64), 5));
    expect(host.audition).toHaveBeenCalledWith(64);
    c.dispatchEvent(pointer('pointerdown', 20, rowY(1)));
    c.dispatchEvent(pointer('pointerdown', keyX(100), rowY(2)));
    expect(host.select.mock.calls).toEqual([[1], [2]]);
    c.dispatchEvent(pointer('pointerdown', keyX(100), rowY(5)));
    c.dispatchEvent(pointer('pointerdown', keyX(42), rowY(0), { button: 2 }));
    expect(host.select).toHaveBeenCalledTimes(2);
    expect(host.set).not.toHaveBeenCalled();
  });

  it('drags a bar whole (with its root) or by an edge, by whole keys; the release confirms the last values', () => {
    const { c, host } = zoneView();
    c.dispatchEvent(pointer('pointerdown', keyX(42), rowY(0)));
    expect(host.select).toHaveBeenCalledWith(0);
    // the first move sends the place it's at; then only the changes (whole keys)
    c.dispatchEvent(pointer('pointermove', keyX(42) + 1, rowY(0)));
    c.dispatchEvent(pointer('pointermove', keyX(42) - 1, rowY(0)));
    c.dispatchEvent(pointer('pointermove', keyX(44), rowY(0)));
    c.dispatchEvent(pointer('pointermove', keyX(44) + 1, rowY(0)));
    const still = { [zoneParam(0, 'lo')]: 36, [zoneParam(0, 'hi')]: 47, [zoneParam(0, 'root')]: 40 };
    const moved = { [zoneParam(0, 'lo')]: 38, [zoneParam(0, 'hi')]: 49, [zoneParam(0, 'root')]: 42 };
    expect(host.set.mock.calls).toEqual([[still, false], [moved, false]]);
    c.dispatchEvent(pointer('pointerup', keyX(44), rowY(0)));
    expect(host.set).toHaveBeenLastCalledWith(moved, true);

    host.set.mockClear();
    c.dispatchEvent(pointer('pointerdown', NAME_W + 60 * 4, rowY(1)));
    c.dispatchEvent(pointer('pointermove', NAME_W + 64 * 4, rowY(1)));
    c.dispatchEvent(pointer('pointerup', NAME_W + 64 * 4, rowY(1)));
    expect(host.set).toHaveBeenLastCalledWith({ [zoneParam(1, 'lo')]: 48, [zoneParam(1, 'hi')]: 63 }, true);
    host.set.mockClear();
    c.dispatchEvent(pointer('pointerdown', keyX(42), rowY(0)));
    c.dispatchEvent(pointer('pointerup', keyX(42), rowY(0)));
    expect(host.set).not.toHaveBeenCalled();
  });

  it('double click: on the empty row loads new zones, on empty space shows the whole keyboard', () => {
    const { c, host, view } = zoneView();
    c.dispatchEvent(mouse('dblclick', keyX(100), rowY(3)));
    expect(host.add).toHaveBeenCalledOnce();
    c.dispatchEvent(wheel(keyX(64), rowY(0), { deltaY: -800 }));
    expect(view.keyAt(NAME_W)).toBeGreaterThan(0);
    c.dispatchEvent(mouse('dblclick', keyX(0), 5));
    expect(view.keyAt(NAME_W)).toBeGreaterThan(0);
    c.dispatchEvent(mouse('dblclick', 4000, rowY(0)));
    expect(view.keyAt(NAME_W)).toBe(0);
    expect(host.add).toHaveBeenCalledOnce();
  });

  it('the wheel zooms the keys, Shift scrolls them, on the names it scrolls the rows', () => {
    const { c, view } = zoneView(10);
    const turn = wheel(keyX(64), rowY(0), { deltaY: -800 });
    c.dispatchEvent(turn);
    expect(turn.defaultPrevented).toBe(true);
    const first = view.keyAt(NAME_W)!;
    expect(first).toBeGreaterThan(30);
    c.dispatchEvent(wheel(keyX(64), rowY(0), { deltaY: 100000, shiftKey: true }));
    expect(view.keyAt(NAME_W)).toBeGreaterThan(first);
    expect(view.zoneAt(rowY(0))).toBe(0);
    c.dispatchEvent(wheel(20, rowY(0), { deltaY: 1 }));
    expect(view.zoneAt(rowY(0))).toBe(1);
    expect(view.zoneAt(5)).toBeNull();
    expect(view.keyAt(20)).toBeNull();
  });

  it('the right click chooses the zone under it and opens the menu', () => {
    const { c, host } = zoneView();
    const right = mouse('contextmenu', keyX(42), rowY(1));
    c.dispatchEvent(right);
    expect(right.defaultPrevented).toBe(true);
    expect(host.select).toHaveBeenCalledWith(1);
    expect(host.menu).toHaveBeenCalledWith(keyX(42), rowY(1));
    c.dispatchEvent(mouse('contextmenu', keyX(42), 5));
    expect(host.select).toHaveBeenCalledOnce();
  });

  it('a newly chosen zone scrolls into view', () => {
    const { view, host } = zoneView(10, KEYS_H + 3 * ROW_H);
    view.paint();
    host.select(8);
    view.paint();
    expect(view.zoneAt(rowY(0))).toBe(6);
  });

  it('lights the played keys for a moment and the playing zones while they play', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const { view, g, play, setSounding } = zoneView();
    view.tick();
    expect(g.drawn).toEqual([]);
    play(64);
    setSounding([1]);
    view.tick();
    expect(g.drawn.some(d => d.name === 'fillRect' && d.fill === 'rgba(255,157,46,0.16)')).toBe(true);
    const litKey = g.drawn.filter(d => d.name === 'fillRect' && d.fill === '#ff9d2e' && d.args[1] === 1);
    expect(litKey).toHaveLength(1);
    // past the flash the key goes dark; the last redraw clears the playing row
    now.mockReturnValue(1500);
    setSounding([]);
    g.drawn.length = 0;
    view.tick();
    expect(g.drawn.some(d => d.fill === 'rgba(255,157,46,0.16)')).toBe(false);
    g.drawn.length = 0;
    view.tick();
    expect(g.drawn).toEqual([]);
  });

  it('nothing is drawn before the canvas has a size; disabled it\'s drawn faded', () => {
    const { view, g } = zoneView();
    sized(view.canvas, 0, 0);
    view.paint();
    expect(g.drawn).toEqual([]);
    sized(view.canvas, NAME_W + 512, 100);
    view.setEnabled(false);
    view.zoomAll();
    expect(g.globalAlpha).toBe(1);
    expect(g.drawn.length).toBeGreaterThan(0);
  });
});
