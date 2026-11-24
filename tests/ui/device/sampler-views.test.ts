import { describe, expect, it } from 'vitest';
import { LOOP, MODE, SLICE, SLICE_COUNT, sliceParam, zoneParam } from '../../../src/devices/instruments/sampler/sampler';
import { Peaks } from '../../../src/ui/waveform';
import {
  BOTTOM, editedSlices, looping, movedMarker, sameHot, sliceAt, slicingByTransients, TOP, waveHit, waveMarkers, WaveWindow,
} from '../../../src/ui/device/sampler/wave-geometry';
import { paintSampleWave, type WavePaint } from '../../../src/ui/device/sampler/wave-painter';
import {
  isBlack, KEYS_H, KeyWindow, movedZone, NAME_W, revealedTop, ROW_H, rowAt, visibleRows, wheeledRows, zoneHit, type ZoneRow,
} from '../../../src/ui/device/sampler/zone-geometry';
import { clip, paintZones, type ZonePaint } from '../../../src/ui/device/sampler/zone-painter';
import { fakeContext } from '../../helpers/canvas';

/** The knobs of a classic Sampler playing 10 % … 90 %, loop 30 … 70 %. */
const values = (over: Record<string, number> = {}) => ({
  mode: MODE.classic, start: 10, end: 90, loop: LOOP.off, loopStart: 30, loopEnd: 70, xfade: 0, reverse: 0,
  sliceBy: SLICE.transients, sliceGrid: 2, [SLICE_COUNT]: 0, ...over,
});
/** The whole sample over 1000 px. */
const win = new WaveWindow(0, 1, 1000);

describe('Sampler waveform: measures', () => {
  it('fraction ↔ x, zoom around the pointer, scroll within the sample', () => {
    const half = new WaveWindow(0.25, 0.75, 1000);
    expect(half.xOf(0.5)).toBe(500);
    expect(half.fracAt(250, 1000)).toBe(0.375);
    expect(half.fracAt(10, 0)).toBeCloseTo(0.25 + 10 * 0.5, 9);
    const zoomed = win.wheeled({ deltaX: 0, deltaY: -500, shift: false }, 0.3);
    expect(zoomed.v1 - zoomed.v0).toBeCloseTo(Math.pow(1.0015, -500), 9);
    // the fraction under the pointer (x 300) stays there
    expect(zoomed.fracAt(300, 1000)).toBeCloseTo(0.3, 9);
    const tightest = win.wheeled({ deltaX: 0, deltaY: -1e5, shift: false }, 0.5);
    expect(tightest.v1 - tightest.v0).toBeCloseTo(0.0005, 12);
    expect(win.wheeled({ deltaX: 0, deltaY: 1000, shift: false }, 0.5)).toEqual(win);
    const scrolled = half.wheeled({ deltaX: 0, deltaY: 200, shift: true }, 0);
    expect([scrolled.v0, scrolled.v1]).toEqual([0.35, 0.85]);
    expect(half.wheeled({ deltaX: -5000, deltaY: 1, shift: false }, 0).v0).toBe(0);
    expect(win.withWidth(1000)).toBe(win);
    expect(win.withWidth(500).width).toBe(500);
  });

  it('the markers: start and end, the loop\'s if it loops, the slices inside the region if sliced by transients', () => {
    const kinds = (v: Record<string, number>) => waveMarkers(v).map(([m, f]) => `${m.kind}${'param' in m ? m.param : ''}@${f}`);
    expect(kinds(values())).toEqual(['start@0.1', 'end@0.9']);
    expect(looping(values({ loop: LOOP.forward }))).toBe(true);
    expect(kinds(values({ loop: LOOP.forward }))).toEqual(['start@0.1', 'end@0.9', 'loopStart@0.3', 'loopEnd@0.7']);
    const sliced = values({ mode: MODE.slice, [SLICE_COUNT]: 3, [sliceParam(1)]: 0.05, [sliceParam(2)]: 0.5, [sliceParam(3)]: 0.6 });
    expect(slicingByTransients(sliced)).toBe(true);
    expect(kinds(sliced)).toEqual(['start@0.1', 'end@0.9', 'slice2@0.5', 'slice3@0.6']);
    expect(kinds({ ...sliced, sliceBy: SLICE.grid })).toEqual(['start@0.1', 'end@0.9']);
  });

  it('what\'s under the pointer: markers near their line in their strip, the loop band at the bottom', () => {
    const v = values({ loop: LOOP.forward }), h = 100;
    expect(waveHit(win, v, 102, 5, h)).toEqual({ kind: 'start' });
    expect(waveHit(win, v, 898, 50, h)).toEqual({ kind: 'end' });
    expect(waveHit(win, v, 100, h - 3, h)).toBeNull();
    expect(waveHit(win, v, 303, h - 3, h)).toEqual({ kind: 'loopStart' });
    expect(waveHit(win, v, 300, 5, h)).toBeNull();
    expect(waveHit(win, v, 500, h - 3, h)).toBe('loop');
    expect(waveHit(win, values(), 500, h - 3, h)).toBeNull();
    // two markers at the same distance: the loop one wins in the lower half
    const both = values({ loop: LOOP.forward, loopStart: 10 });
    expect(waveHit(win, both, 100, 60, h)).toEqual({ kind: 'loopStart' });
    expect(waveHit(win, both, 100, 40, h)).toEqual({ kind: 'start' });
    expect(sameHot({ kind: 'slice', param: 2 }, { kind: 'slice', param: 2 })).toBe(true);
    expect(sameHot({ kind: 'slice', param: 2 }, { kind: 'slice', param: 3 })).toBe(false);
    expect(sameHot({ kind: 'start' }, 'loop')).toBe(false);
    expect(sameHot(null, null)).toBe(true);
    expect([TOP, BOTTOM]).toEqual([15, 13]);
  });

  it('moving: start and end stay apart, the loop moves whole within the sample, a slice within the region', () => {
    const v = values({ loop: LOOP.forward, [SLICE_COUNT]: 1, [sliceParam(1)]: 0.5 });
    expect(movedMarker({ kind: 'start' }, v, 0.05)).toEqual({ start: 15 });
    expect(movedMarker({ kind: 'start' }, v, 2)).toEqual({ start: 89.95 });
    expect(movedMarker({ kind: 'end' }, v, -2)).toEqual({ end: 10.05 });
    expect(movedMarker({ kind: 'loopStart' }, v, 0.5)).toEqual({ loopStart: 69.95 });
    expect(movedMarker({ kind: 'loopEnd' }, v, -0.5)).toEqual({ loopEnd: 30.05 });
    expect(movedMarker('loop', v, 0.5)).toEqual({ loopStart: 60, loopEnd: 100 });
    expect(movedMarker('loop', v, -0.5)).toEqual({ loopStart: 0, loopEnd: 40 });
    expect(movedMarker({ kind: 'slice', param: 1 }, v, 0.123456789)).toEqual({ [sliceParam(1)]: 0.623457 });
    expect(movedMarker({ kind: 'slice', param: 1 }, v, 1)).toEqual({ [sliceParam(1)]: 0.9 });
  });

  it('slices: a click plays the one under it; a double click adds or removes one (not on another marker)', () => {
    const v = values({ mode: MODE.slice, [SLICE_COUNT]: 2, [sliceParam(1)]: 0.4, [sliceParam(2)]: 0.6 });
    expect([0.05, 0.2, 0.5, 0.7, 0.95].map(at => sliceAt(v, at))).toEqual([-1, 0, 1, 2, -1]);
    const added = editedSlices(v, null, 1.5)!;
    expect([added[SLICE_COUNT], added[sliceParam(3)]]).toEqual([3, 1]);
    const removed = editedSlices(v, { kind: 'slice', param: 1 }, 0)!;
    expect([removed[SLICE_COUNT], removed[sliceParam(1)]]).toEqual([1, 0.6]);
    expect(editedSlices(v, { kind: 'start' }, 0)).toBeNull();
    expect(editedSlices(v, 'loop', 0)).toBeNull();
  });
});

describe('Sampler waveform: drawing', () => {
  const data = { sampleRate: 100, channels: [Float32Array.from({ length: 400 }, (_, i) => Math.sin(i / 5))] };
  const forward = Peaks.from({ sampleRate: 100, channels: [...data.channels] }), reversed = forward.reversed();
  const paint = (over: Partial<WavePaint> = {}) => {
    const g = fakeContext();
    const used: boolean[] = [];
    paintSampleWave({
      g, w: 200, h: 100, win: new WaveWindow(0, 1, 200), v: values(), data, name: null,
      peaks: (_d, reverse) => { used.push(reverse); return reverse ? reversed : forward; },
      hot: null, heads: [], enabled: true, ...over,
    });
    return { calls: g.calls, used, g };
  };

  it('without a sample: where to drop one, or the one loading', () => {
    const empty = paint({ data: undefined });
    expect(empty.calls).toContain('strokeRect');
    expect(empty.calls.filter(c => c === 'fillText')).toHaveLength(2);
    expect(paint({ data: undefined, name: 'kick' }).calls.filter(c => c === 'fillText')).toHaveLength(1);
  });

  it('the waveform a column per pixel, the reversed peaks with Reverse, flags, loop, slices, voices, zoom, the slice hint', () => {
    const plain = paint();
    expect(plain.calls.filter(c => c === 'fillRect').length).toBeGreaterThan(200);
    expect(plain.used).toEqual([false]);
    expect(paint({ v: values({ reverse: 1 }) }).used).toEqual([true]);
    const loop = paint({ v: values({ loop: LOOP.forward, xfade: 50 }), hot: 'loop' });
    expect(loop.calls).toContain('setLineDash');
    expect(paint({ v: values({ loop: LOOP.pingPong }) }).calls.filter(c => c === 'setLineDash')).toHaveLength(0);
    const sliced = paint({ v: values({ mode: MODE.slice, [SLICE_COUNT]: 1, [sliceParam(1)]: 0.5 }), hot: { kind: 'slice', param: 1 } });
    expect(sliced.calls.filter(c => c === 'fillText').length).toBeGreaterThanOrEqual(4);
    const hint = paint({ v: values({ mode: MODE.slice }) });
    // the first slice's number, S, E and the hint
    expect(hint.calls.filter(c => c === 'fillText')).toHaveLength(4);
    const zoomed = paint({ win: new WaveWindow(0.2, 0.4, 200), heads: [0.3, 0.9], hot: { kind: 'start' }, enabled: false });
    // zoomed on 20 … 40 %: the zero line and the voice at 30 %; the flags and the voice at 90 % are outside
    expect(zoomed.calls.filter(c => c === 'stroke')).toHaveLength(2);
    expect(paint({ win: new WaveWindow(0.95, 1, 200) }).calls).toContain('fillRect');
  });
});

describe('Sampler zones: measures', () => {
  const kw = new KeyWindow(0, 128, NAME_W + 1280);
  const zones = { [zoneParam(0, 'lo')]: 36, [zoneParam(0, 'hi')]: 47, [zoneParam(0, 'root')]: 40, [zoneParam(0, 'vlo')]: 1, [zoneParam(0, 'vhi')]: 127,
    [zoneParam(1, 'lo')]: 60, [zoneParam(1, 'hi')]: 60, [zoneParam(1, 'root')]: 60, [zoneParam(1, 'vlo')]: 1, [zoneParam(1, 'vhi')]: 127 };
  const rows: ZoneRow[] = [{ index: 0, name: 'kick' }, { index: 1, name: 'snare' }];

  it('key ↔ x right of the names, rows below the keyboard, the wheel zooming and scrolling the keys', () => {
    expect(kw.keysWidth).toBe(1280);
    expect(kw.xOf(60)).toBe(NAME_W + 600);
    expect(kw.keyAt(NAME_W + 605)).toBe(60);
    expect(kw.keyAt(10)).toBeNull();
    expect(kw.keyAt(NAME_W + 99999)).toBe(127);
    expect(new KeyWindow(0, 128, 10).keysWidth).toBe(1);
    expect([rowAt(5, 0), rowAt(KEYS_H, 0), rowAt(KEYS_H + ROW_H * 2 + 1, 3)]).toEqual([-1, 0, 5]);
    expect(visibleRows(KEYS_H + ROW_H * 4 + 3)).toBe(4);
    expect(visibleRows(0)).toBe(1);
    const zoomed = kw.wheeled({ deltaX: 0, deltaY: -1000, shift: false }, NAME_W + 640);
    expect(zoomed.k1 - zoomed.k0).toBeCloseTo(Math.max(12, 128 * Math.pow(1.0015, -1000)), 9);
    expect(zoomed.k0 + (zoomed.k1 - zoomed.k0) / 2).toBeCloseTo(64, 6);
    const shifted = new KeyWindow(20, 40, kw.width).wheeled({ deltaX: 0, deltaY: 640, shift: true }, 0);
    expect([shifted.k0, shifted.k1]).toEqual([30, 50]);
    expect(new KeyWindow(20, 40, kw.width).wheeled({ deltaX: 99999, deltaY: 0, shift: false }, 0).k1).toBe(128);
    expect(isBlack(61)).toBe(true);
    expect(isBlack(60)).toBe(false);
  });

  it('what\'s under the pointer: a key, a name, an edge, the bar, the row, nothing', () => {
    const hit = (x: number, y: number, top = 0) => zoneHit(kw, rows, zones, x, y, top);
    const row = (r: number) => KEYS_H + r * ROW_H + 5;
    expect(hit(NAME_W + 605, 5)).toEqual({ kind: 'key', key: 60 });
    expect(hit(5, 5)).toEqual({ kind: 'empty' });
    expect(hit(5, row(1))).toEqual({ kind: 'name', zone: 1 });
    expect(hit(kw.xOf(36) + 2, row(0))).toEqual({ kind: 'lo', zone: 0 });
    expect(hit(kw.xOf(48) - 2, row(0))).toEqual({ kind: 'hi', zone: 0 });
    expect(hit(kw.xOf(42), row(0))).toEqual({ kind: 'move', zone: 0 });
    expect(hit(kw.xOf(100), row(0))).toEqual({ kind: 'row', zone: 0 });
    // a narrow bar has no edges
    expect(hit(kw.xOf(60) + 1, row(1))).toEqual({ kind: 'move', zone: 1 });
    expect(hit(kw.xOf(60), row(5))).toEqual({ kind: 'empty' });
    // scrolled by a row: the first row shown is the snare's
    expect(hit(kw.xOf(42), row(0), 1)).toEqual({ kind: 'row', zone: 1 });
  });

  it('moving an edge keeps the zone whole; moving the bar takes the root note, within the keyboard', () => {
    const z = { index: 1, lo: 60, hi: 64, vlo: 1, vhi: 127, root: 62 };
    const id = (k: 'lo' | 'hi' | 'root') => zoneParam(1, k);
    expect(movedZone('lo', z, -5)).toEqual({ [id('lo')]: 55, [id('hi')]: 64 });
    expect(movedZone('lo', z, 10)).toEqual({ [id('lo')]: 64, [id('hi')]: 64 });
    expect(movedZone('hi', z, -10)).toEqual({ [id('lo')]: 60, [id('hi')]: 60 });
    expect(movedZone('hi', z, 100)).toEqual({ [id('lo')]: 60, [id('hi')]: 127 });
    expect(movedZone('move', z, 3)).toEqual({ [id('lo')]: 63, [id('hi')]: 67, [id('root')]: 65 });
    expect(movedZone('move', z, 200)).toEqual({ [id('lo')]: 123, [id('hi')]: 127, [id('root')]: 125 });
  });

  it('the rows: the wheel on the names scrolls them, a newly chosen zone comes into view', () => {
    const many: ZoneRow[] = Array.from({ length: 10 }, (_, i) => ({ index: i, name: `z${i}` }));
    expect(wheeledRows(0, 10, 4, 120)).toBe(1);
    expect(wheeledRows(7, 10, 4, 120)).toBe(7);
    expect(wheeledRows(0, 10, 4, -120)).toBe(0);
    expect(revealedTop(many, 8, 0, 0, 4)).toBe(5);
    expect(revealedTop(many, 1, 8, 5, 4)).toBe(1);
    expect(revealedTop(many, 1, 1, 5, 4)).toBe(5);
    expect(revealedTop(many, 1, 1, 9, 4)).toBe(7);
    expect(revealedTop(many, 42, 0, 3, 4)).toBe(3);
  });
});

describe('Sampler zones: drawing', () => {
  const zones = { [zoneParam(0, 'lo')]: 36, [zoneParam(0, 'hi')]: 47, [zoneParam(0, 'root')]: 40, [zoneParam(0, 'vlo')]: 1, [zoneParam(0, 'vhi')]: 127 };
  const paint = (over: Partial<ZonePaint> = {}) => {
    const g = fakeContext();
    paintZones({
      g, w: NAME_W + 640, h: 200, win: new KeyWindow(0, 128, NAME_W + 640), top: 0, shown: 12, rows: [{ index: 0, name: 'kick' }],
      selected: 0, values: zones, pitched: true, hot: null, lit: new Set(), flashing: () => false, enabled: true, ...over,
    });
    return g.calls;
  };

  it('keyboard, columns, a row per zone with bar, name and root, the free row; zoom and scroll marks', () => {
    const calls = paint();
    expect(calls).toContain('arc');
    expect(calls.filter(c => c === 'fillText').length).toBeGreaterThan(10);
    expect(paint({ pitched: false })).not.toContain('arc');
    const zoomed = paint({ win: new KeyWindow(30, 60, NAME_W + 640), hot: { kind: 'key', key: 40 }, flashing: k => k === 41, lit: new Set([0]), selected: 1, enabled: false });
    expect(zoomed.filter(c => c === 'fillRect').length).toBeGreaterThan(30);
    const many = Array.from({ length: 30 }, (_, i) => ({ index: i, name: `zone ${i}` }));
    expect(paint({ rows: many, top: 5, shown: 6 }).filter(c => c === 'fillText').length).toBeGreaterThan(6);
    expect(paint({ rows: [], hot: { kind: 'move', zone: 0 } })).toContain('fillText');
  });

  it('a long name is cut with …', () => {
    const g = fakeContext();
    expect(clip(g, 'short', 100)).toBe('short');
    expect(clip(g, 'a very long sample name', 60)).toBe('a very lo…');
  });
});
