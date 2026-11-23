import { describe, expect, it } from 'vitest';
import { BeatAxis } from '../../src/ui/clip-editor/clip-geometry';
import { PanGesture as ClipPanGesture, type ClipHost } from '../../src/ui/clip-editor/clip-frame';
import type { Clip } from '../../src/model/clip';
import { RulerZoomGesture, type GestureHost, type Pointer } from '../../src/ui/timeline/gestures';
import { TimeSignature } from '../../src/core/music-time';
import {
  ADAPTIVE_GRID, drawnGridStep, FIXED_GRIDS, geometryShowing, gridLabel, gridStep, MAX_PX_PER_BEAT, MIN_PX_PER_BEAT, nudgeGrid, rulerZoom, TimelineGeometry,
} from '../../src/ui/timeline/geometry';
import { RULER, rulerZoneAt } from '../../src/ui/timeline/painters';

const at = (x: number, y: number): Pointer => ({ x, y, shift: false, alt: false, ctrl: false });

/** A timeline host with only what the ruler's zoom uses. */
function timelineHost(geo: TimelineGeometry) {
  const host = { geo, seeks: [] as number[], snapStep: () => null, seek: (b: number) => host.seeks.push(b), invalidate: () => {} };
  return host;
}

describe('timeline navigation, as in Live', () => {
  it('the ruler bands from the top: numbers, loop, scrub area', () => {
    expect(rulerZoneAt(0)).toBe('numbers');
    expect(rulerZoneAt(RULER.numbers - 1)).toBe('numbers');
    expect(rulerZoneAt(RULER.numbers)).toBe('loop');
    expect(rulerZoneAt(RULER.numbers + RULER.loop - 1)).toBe('loop');
    expect(rulerZoneAt(RULER.numbers + RULER.loop)).toBe('scrub');
  });

  it('dragging the numbers: down zooms in, up zooms out, around the grabbed beat', () => {
    const start = new TimelineGeometry(20, 8, 30);
    const host = timelineHost(start);
    let view = start;
    const g = new RulerZoomGesture(host as unknown as GestureHost, at(200, 5), v => { view = v; }, b => host.seeks.push(b));
    const grabbed = start.xToBeat(200); // beat 18
    g.move(at(200, 5 + 58));
    expect(view.pxPerBeat).toBeCloseTo(20 * rulerZoom(58), 9);
    expect(view.pxPerBeat).toBeGreaterThan(39);
    expect(view.xToBeat(200)).toBeCloseTo(grabbed, 9);
    expect(view.scrollY).toBe(30); // the tracks don't scroll
    g.move(at(200, 5 - 58));
    expect(view.pxPerBeat).toBeLessThan(10.1);
    // sideways the grabbed beat follows the pointer: the view scrolls
    g.move(at(300, 5));
    expect(view.pxPerBeat).toBeCloseTo(20, 9);
    expect(view.xToBeat(300)).toBeCloseTo(grabbed, 9);
    g.end(at(300, 5));
    expect(host.seeks).toEqual([]); // a drag doesn't move the playhead
  });

  it('a click on the numbers moves the playhead', () => {
    const host = timelineHost(new TimelineGeometry(20, 0));
    const g = new RulerZoomGesture(host as unknown as GestureHost, at(100, 5), () => { throw new Error('no zoom'); }, b => host.seeks.push(b));
    g.move(at(101, 5)); // a tremor isn't a drag
    g.end(at(100, 5));
    expect(host.seeks).toEqual([5]);
  });

  it('Z and W: a range fills the view with a small margin', () => {
    const g = new TimelineGeometry(24, 100, 50);
    const v = geometryShowing(g, 16, 32, 1000);
    expect(v.beatToX(16)).toBeGreaterThan(0);
    expect(v.beatToX(16)).toBeLessThan(40);
    expect(v.beatToX(32)).toBeLessThan(1000);
    expect(v.beatToX(32)).toBeGreaterThan(960);
    expect(v.scrollY).toBe(50);
    // never past the limits of the zoom, never before the start
    expect(geometryShowing(g, 0, 1e6, 1000).pxPerBeat).toBe(MIN_PX_PER_BEAT);
    expect(geometryShowing(g, 3, 3, 1000).pxPerBeat).toBe(MAX_PX_PER_BEAT);
    expect(geometryShowing(g, 0, 4, 1000).scrollBeat).toBe(0);
  });

  it('in the clip editors the ruler zooms the same way; elsewhere dragging only scrolls', () => {
    let axis = new BeatAxis(40, 2);
    const host = { get axis() { return axis; }, setAxis: (a: BeatAxis) => { axis = a; }, seekContent: () => {} } as unknown as ClipHost<Clip>;
    const grabbed = axis.xToBeat(120);
    const ruler = new ClipPanGesture(host, at(120, 10), true);
    ruler.move(at(160, 10 + 58));
    expect(axis.pxPerBeat).toBeCloseTo(40 * rulerZoom(58), 9);
    expect(axis.xToBeat(160)).toBeCloseTo(grabbed, 9);
    axis = new BeatAxis(40, 2);
    const wave = new ClipPanGesture(host, at(120, 60));
    wave.move(at(80, 200));
    expect(axis.pxPerBeat).toBe(40);
    expect(axis.startBeat).toBeCloseTo(3, 12);
  });
});

describe('the grid, as in Live', () => {
  const sig = TimeSignature.COMMON;
  const eighth = FIXED_GRIDS.findIndex(g => g.label === '1/8');

  it('fixed: the same step at every zoom, in every editor', () => {
    const fixed = { ...ADAPTIVE_GRID, fixed: eighth };
    for (const px of [3, 24, 200]) expect(gridStep(px, sig, 14, fixed)).toBe(0.5);
    expect(gridStep(24, sig, 14, { ...ADAPTIVE_GRID, fixed: FIXED_GRIDS.findIndex(g => g.label === '1 bar') })).toBe(4);
    expect(gridStep(24, new TimeSignature(3, 4), 14, { ...ADAPTIVE_GRID, fixed: FIXED_GRIDS.findIndex(g => g.label === '2 bars') })).toBe(6);
  });

  it('triplets: the steps shorter than a bar last 2/3', () => {
    expect(gridStep(24, sig, 14, { fixed: eighth, density: 0, triplet: true })).toBeCloseTo(1 / 3, 12);
    expect(gridStep(24, sig, 14, { ...ADAPTIVE_GRID, triplet: true })).toBeCloseTo(2 / 3, 12);
    expect(gridStep(1.5, sig, 14, { ...ADAPTIVE_GRID, triplet: true })).toBe(16); // the bars stay
  });

  it('adaptive: as before by default, denser or sparser with its density', () => {
    expect(gridStep(24, sig)).toBe(1);
    expect(gridStep(24, sig, 14, ADAPTIVE_GRID)).toBe(1);
    expect(gridStep(24, sig, 14, { ...ADAPTIVE_GRID, density: -2 })).toBe(1 / 4);
    expect(gridStep(24, sig, 14, { ...ADAPTIVE_GRID, density: 2 })).toBe(4);
  });

  it('Ctrl+1 narrower, Ctrl+2 wider: within the limits', () => {
    expect(nudgeGrid(ADAPTIVE_GRID, -1).density).toBe(-1);
    expect(nudgeGrid({ ...ADAPTIVE_GRID, density: 2 }, 1).density).toBe(2);
    expect(nudgeGrid({ ...ADAPTIVE_GRID, fixed: eighth }, -1).fixed).toBe(eighth - 1);
    expect(nudgeGrid({ ...ADAPTIVE_GRID, fixed: 0 }, -1).fixed).toBe(0);
    expect(nudgeGrid({ ...ADAPTIVE_GRID, fixed: FIXED_GRIDS.length - 1 }, 1).fixed).toBe(FIXED_GRIDS.length - 1);
    expect(gridLabel(ADAPTIVE_GRID)).toBe('Adaptive');
    expect(gridLabel({ fixed: null, density: -1, triplet: true })).toBe('Adaptive -1 T');
    expect(gridLabel({ fixed: eighth, density: 0, triplet: false })).toBe('1/8');
  });

  it('a fixed grid zoomed out draws a line every few steps, not a grey wall', () => {
    expect(drawnGridStep(1 / 8, 200)).toBe(1 / 8);
    expect(drawnGridStep(1 / 8, 2)).toBe(2);
    expect(drawnGridStep(1 / 8, 0)).toBe(1 / 8);
  });
});
