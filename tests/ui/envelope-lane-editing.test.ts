import { describe, expect, it } from 'vitest';
import { TimeSignature } from '../../src/core/music-time';
import { DEVICE_ON, envelopeValueAt, INSTRUMENT_DEVICE, scaleOf, type EnvelopePoint, type ModTarget } from '../../src/model/envelope';
import { Clipboard } from '../../src/store/clipboard';
import { BeatAxis } from '../../src/ui/clip-editor/clip-geometry';
import type { MenuAction, MenuItem } from '../../src/ui/context-menu';
import { DrawMode } from '../../src/ui/draw-mode';
import type { LaneCurves, LaneHost } from '../../src/ui/envelopes/envelope-lane';
import { drawDrag, laneCursor, pointDrag, pressLane, rangeDrag, sweepDrag, type LaneRange } from '../../src/ui/envelopes/lane-drags';
import { LaneEditing } from '../../src/ui/envelopes/lane-editing';
import { LANE_PAD, LaneGeometry } from '../../src/ui/envelopes/lane-geometry';
import { paintLane } from '../../src/ui/envelopes/lane-painter';
import { trackChain } from '../../src/ui/envelopes/mod-targets';
import { fakeContext } from '../helpers/canvas';
import { setup } from '../helpers/fixtures';

const PAN: ModTarget = { kind: 'mixer', param: 'pan' };
const ON: ModTarget = { kind: 'device', device: 'd1' as never, param: DEVICE_ON };

/** Pan (−1…1), 40 px per beat, the curve 200 px tall from y 9: value 1 at y 9, 0 at 109, −1 at 209. Grid: a beat. */
const geometry = (target: ModTarget = PAN, grid = 1) => new LaneGeometry(new BeatAxis(40, 0), scaleOf(target), LANE_PAD, 218, grid);
const pts = (...p: [number, number][]): EnvelopePoint[] => p.map(([beat, value]) => ({ beat, value }));
const pairs = (p: readonly EnvelopePoint[]) => p.map(q => [+q.beat.toFixed(6), +q.value.toFixed(6)]);

describe('the lane\'s geometry', () => {
  it('values and heights, clamped; on an on/off the nearest step; the point under the pointer; the grid', () => {
    const g = geometry();
    expect([g.valueToY(1), g.valueToY(0), g.valueToY(-1)]).toEqual([9, 109, 209]);
    expect([g.yToValue(59), g.yToValue(-50), g.yToValue(500)]).toEqual([0.5, 1, -1]);
    expect(geometry(ON).yToValue(100)).toBe(1);
    expect(new LaneGeometry(new BeatAxis(), scaleOf(PAN), 9, 10, 1).curveHeight).toBe(1);
    const p = pts([1, 0], [2, 0.5], [2, -0.5]);
    expect(g.pointAt(p, 42, 105)).toBe(0);
    expect(g.pointAt(p, 80, 160)).toBe(2);
    expect(g.pointAt(p, 60, 109)).toBe(-1);
    expect([g.snap(1.4, false), g.snap(1.4, true), g.snap(-3, true)]).toEqual([1, 1.4, 0]);
  });
});

describe('the lane\'s drags', () => {
  const geo = () => geometry();

  it('a point stays between its neighbours, on the grid; with Shift its value moves 10 times slower', () => {
    const d = pointDrag(geo, pts([1, 0], [2, 0], [4, 0]), 1, 'Move', false);
    d.move(400, 59, false, false);
    expect(pairs(d.points)).toEqual([[1, 0], [4, 0.5], [4, 0]]);
    d.move(0, 59, false, false);
    expect(d.points[1].beat).toBe(1);
    d.move(80, 59, true, true);
    d.move(80, 159, true, true);
    expect(d.points[1].value).toBeCloseTo(0.4);
    expect(d.changed).toBe(true);
  });

  it('drawing paints a step per cell, filling the cells skipped; with Alt a freehand line', () => {
    const steps = drawDrag(geo, []);
    steps.move(10, 9, false, false);
    steps.move(130, 209, false, false);
    // from the first cell's point (beat 0.25, value 1) to beat 3.25, value -1: each cell its value at its middle
    expect([0.5, 1.5, 2.5, 3.5].map(b => +envelopeValueAt(steps.points, b).toFixed(6))).toEqual([0.833333, 0.166667, -0.5, -1]);
    const free = drawDrag(geo, []);
    free.move(40, 109, true, false);
    free.move(80, 9, true, false);
    free.move(60, 209, true, false);
    expect(free.changed).toBe(true);
    expect(free.points.length).toBeGreaterThan(1);
  });

  it('a sweep chooses a range on the grid (Alt: free); cancelled, none', () => {
    let range: LaneRange | null = null;
    const s = sweepDrag(geo, [], 85, r => { range = r; });
    s.move(10, 0, false, false);
    expect(range).toEqual({ from: 0, to: 2 });
    s.move(170, 0, true, false);
    expect(range).toEqual({ from: 2, to: 4.25 });
    s.cancel!();
    expect(range).toBeNull();
  });

  it('a range moves on the grid in time and all together in value, clamped; cancelled, it goes back', () => {
    let range: LaneRange | null = null;
    const start = pts([0, 0], [1, 0.5], [2, 0.5], [3, 0]);
    const d = rangeDrag(geo, start, { from: 1, to: 2 }, 60, 59, r => { range = r; });
    d.move(140, 9, false, false);
    expect(range).toEqual({ from: 3, to: 4 });
    expect(Math.max(...d.points.map(p => p.value))).toBe(1);
    d.move(-400, 59, true, false);
    expect(range).toEqual({ from: 0, to: 1 });
    d.cancel!();
    expect(range).toEqual({ from: 1, to: 2 });
  });

  it('a press starts the right drag; outside the range it just leaves it (except in draw mode)', () => {
    let range: LaneRange | null = { from: 1, to: 2 };
    const set = (r: LaneRange | null) => { range = r; };
    const curve = pts([1, 0], [3, 0.5]);
    const press = (x: number, y: number, o: { shift?: boolean; alt?: boolean; draw?: boolean } = {}) =>
      pressLane(geo, { x, y, shift: !!o.shift, alt: !!o.alt, draw: !!o.draw, points: curve, range }, set);
    const inRange = press(60, 59);
    expect([inRange?.label, inRange?.changed]).toEqual(['Move modulation range', false]);
    expect(press(200, 59)).toBeNull();
    expect(range).toBeNull();
    range = { from: 1, to: 2 };
    expect(press(200, 59, { draw: true })?.label).toBe('Draw modulation');
    expect(press(10, 59, { shift: true })?.sweep).toBe(true);
    range = null;
    const onPoint = press(40, 109);
    expect([onPoint?.label, onPoint?.changed]).toEqual(['Move modulation point', false]);
    const added = press(205, 59, { alt: true });
    expect([added?.label, added?.changed, pairs(added!.points)]).toEqual(['Add modulation point', true, [[1, 0], [3, 0.5], [5.125, 0.5]]]);
  });

  it('the cursor tells what a press would do', () => {
    const g = geometry(), curve = pts([1, 0]);
    expect(laneCursor(g, curve, null, 0, 0, false, true)).toBe('crosshair');
    expect(laneCursor(g, curve, null, 0, 0, true, false)).toBe('text');
    expect(laneCursor(g, curve, { from: 2, to: 3 }, 100, 0, false, false)).toBe('move');
    expect(laneCursor(g, curve, null, 40, 109, false, false)).toBe('move');
    expect(laneCursor(g, curve, null, 300, 109, false, false)).toBe('copy');
  });
});

/** A lane on pan with a curve kept here; the commits change it. */
function editing(opts: { span?: { start: number; end: number } | null; width?: number } = {}) {
  let curve: EnvelopePoint[] = [];
  const commits: string[] = [];
  let shapes = false, focused = 0;
  const curves = (): LaneCurves => ({ color: '#fff', envelopes: [], envelope: () => (curve.length ? { target: PAN, points: curve } : undefined) });
  const host = {
    axis: new BeatAxis(40, 0), curves, grid: () => 1, signature: () => TimeSignature.COMMON, playhead: () => null,
    commit: (label: string, _t: ModTarget, p: readonly EnvelopePoint[]) => { commits.push(label); curve = [...p]; },
    wheel: () => {}, clipboard: new Clipboard(), drawMode: new DrawMode(),
    ...(opts.span === undefined ? {} : { span: () => opts.span! }),
  } as LaneHost;
  const e = new LaneEditing({
    host, geometry: () => new LaneGeometry(host.axis, scaleOf(PAN), LANE_PAD, 218, host.grid()), width: () => opts.width ?? 400,
    get shapes() { return shapes; }, setShapes: on => { shapes = on; }, focus: () => { focused++; }, invalidate: () => {},
  });
  e.setTarget(PAN);
  return { e, host, commits, get curve() { return curve; }, set curve(c: EnvelopePoint[]) { curve = c; }, get shapes() { return shapes; }, get focused() { return focused; } };
}

const actions = (items: MenuItem[] | null) => (items ?? []).filter((i): i is MenuAction => typeof i === 'object' && 'label' in i);
const run = (items: MenuItem[] | null, label: string) => actions(items).find(i => i.label === label)!.run();

describe('editing a lane', () => {
  it('a click adds a point, a drag moves it, a double click deletes it; a drag only shows until released', () => {
    const l = editing();
    l.e.press(80, 59, false, false);
    expect(pairs(l.e.points())).toEqual([[2, 0.5]]);
    l.e.finish(true);
    l.e.press(80, 59, false, false);
    l.e.move(120, 159, false, false);
    expect(l.curve).toEqual(pts([2, 0.5]));
    l.e.finish(true);
    l.e.move(0, 0, false, false);
    expect(pairs(l.curve)).toEqual([[3, -0.5]]);
    l.e.deleteAt(0, 0);
    l.e.deleteAt(120, 159);
    expect(l.commits).toEqual(['Add modulation point', 'Move modulation point', 'Delete modulation point']);
    l.e.setDraw(true);
    l.e.deleteAt(120, 159);
    expect(l.e.cursor(0, 0, false)).toBe('crosshair');
  });

  it('a cancelled sweep leaves no range; a Shift click chooses nothing; Escape and a cancelled range drag', () => {
    const l = editing();
    l.e.press(40, 59, true, false);
    l.e.move(120, 59, false, false);
    expect(l.e.range).toEqual({ from: 1, to: 3 });
    l.e.finish(false);
    expect(l.e.range).toBeNull();
    l.e.press(40, 59, true, false);
    l.e.finish(true);
    expect(l.e.range).toBeNull();
    l.e.range = { from: 1, to: 2 };
    expect(l.e.key('escape', false)).toBe(true);
    expect(l.e.key('escape', false)).toBe(false);
    expect(l.commits).toEqual([]);
  });

  it('copy and paste a range, also on the same place; cut and clear it; without a range the whole curve', () => {
    const l = editing();
    l.curve = pts([0, 0], [2, 1], [4, 0]);
    expect(l.e.key('c', true)).toBe(true);
    expect(l.host.clipboard.envelope?.span).toBe(4);
    l.e.range = { from: 1, to: 3 };
    l.e.copy();
    l.e.paste(5);
    expect(l.e.range).toEqual({ from: 5, to: 7 });
    expect(l.e.key('v', true)).toBe(true);
    expect(l.e.key('delete', false)).toBe(true);
    expect(l.e.range).toBeNull();
    l.e.range = { from: 0, to: 1 };
    expect(l.e.key('x', true)).toBe(true);
    l.e.clear('Clear modulation');
    expect(l.curve).toEqual([]);
    expect(l.e.key('c', true)).toBe(false);
    expect(l.e.key('z', true)).toBe(false);
    expect(l.commits).toEqual(['Paste modulation', 'Paste modulation', 'Clear modulation range', 'Cut modulation', 'Clear modulation']);
    l.e.setTarget(null);
    l.e.paste();
    expect(l.e.copy()).toBe(false);
  });

  it('B and F switch draw mode and the shapes; other keys aren\'t the lane\'s', () => {
    const l = editing();
    expect([l.e.key('b', false), l.e.draw]).toEqual([true, true]);
    expect([l.e.key('f', false), l.shapes]).toEqual([true, true]);
    expect(l.e.key('q', false)).toBe(false);
    expect(l.e.key('delete', false)).toBe(false);
  });

  it('a shape goes over what plays (or what\'s visible), in the range if chosen; a tweak redoes it in place', () => {
    const playing = editing({ span: { start: 0, end: 4 } });
    const sine = { shape: 'sine' as const, cycle: 0, depth: 1, invert: false, seed: 1 };
    playing.e.applyShape(sine);
    expect(playing.commits).toEqual(['Shape: Sine wave']);
    expect(playing.e.shaped?.range).toEqual({ from: 0, to: 4 });
    playing.e.tweakShape({ ...sine, invert: true });
    expect(playing.commits).toHaveLength(2);
    playing.e.range = { from: 1, to: 2 };
    playing.e.tweakShape(sine);
    expect(playing.commits).toHaveLength(2);
    expect(playing.focused).toBe(3);
    const empty = editing({ span: { start: 2, end: 2 } });
    empty.e.applyShape(sine);
    const master = editing({ width: 200 });
    master.e.applyShape({ ...sine, shape: 'rampUp' });
    expect(master.e.shaped?.range).toEqual({ from: 0, to: 5 });
    const narrow = editing({ width: 10 });
    narrow.e.applyShape(sine);
    expect([empty.commits, narrow.commits]).toEqual([[], []]);
  });

  it('the menu: on the curve or the range, paste where clicked, delete the point, the modes', () => {
    const l = editing();
    expect(actions(l.e.menu(0, 0)).filter(i => !i.disabled).map(i => i.label)).toEqual(['Step drawing', 'Ready-made shapes']);
    l.curve = pts([1, 0], [3, 0.5]);
    l.e.copy();
    run(l.e.menu(40, 109), 'Delete the point');
    expect(pairs(l.curve)).toEqual([[3, 0.5]]);
    run(l.e.menu(200, 0), 'Paste here');
    expect(l.e.range).toEqual({ from: 5, to: 7 });
    const ranged = actions(l.e.menu(0, 0)).map(i => i.label);
    expect(ranged).toContain('Cut the range');
    expect(ranged).toContain('Clear the range');
    run(l.e.menu(0, 0), 'Copy the range');
    run(l.e.menu(0, 0), 'Paste in the same place');
    run(l.e.menu(0, 0), 'Cut the range');
    run(l.e.menu(0, 0), 'Clear the modulation');
    run(l.e.menu(0, 0), 'Step drawing');
    run(l.e.menu(0, 0), 'Ready-made shapes');
    expect([l.e.draw, l.shapes]).toEqual([true, true]);
    l.e.press(0, 0, false, false);
    expect(l.e.menu(0, 0)).toBeNull();
  });
});

describe('painting the lane', () => {
  it('grid, span, range, curve with handles, hovered point, value, playhead; the hint when empty', () => {
    const g = fakeContext(), geo = geometry();
    const base = { g, width: 400, height: 218, geo, target: PAN, signature: TimeSignature.COMMON, color: '#fff', chain: null };
    paintLane({ ...base, span: { start: 1, end: 6 }, range: { from: 2, to: 3 }, points: pts([1, 0], [1.05, 0.2], [2, 0.5], [30, 0]), draw: false, hover: { x: 80, y: 59 }, dragging: false, playhead: 2 });
    paintLane({ ...base, span: null, range: null, points: pts([1, 0]), draw: false, hover: { x: 40, y: 109 }, dragging: true, playhead: null });
    paintLane({ ...base, span: undefined, range: null, points: [], draw: true, hover: null, dragging: false, playhead: null });
    paintLane({ ...base, span: undefined, range: null, points: [], draw: false, hover: null, dragging: false, playhead: null });
    // a choice (the instrument's oscillator wave): the option heard, in steps
    const chain = trackChain(setup({ midi: 1 }).store.project.tracks[0]);
    const wave: ModTarget = { kind: 'device', device: INSTRUMENT_DEVICE, param: 'oscA' };
    const heard = fakeContext();
    paintLane({ ...base, g: heard, geo: geometry(wave), target: wave, chain, span: null, range: null, points: pts([0, -1], [4, 1]), draw: false, hover: null, dragging: false, playhead: null });
    expect(heard.calls.filter(c => c === 'setLineDash')).toHaveLength(4);
    expect(g.calls.filter(c => c === 'fillText')).toHaveLength(4);
    expect(g.calls.filter(c => c === 'strokeRect').length).toBeGreaterThanOrEqual(3);
  });
});
