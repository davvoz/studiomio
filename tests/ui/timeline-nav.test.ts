import { describe, expect, it } from 'vitest';
import type { PlacementId } from '../../src/core/id';
import { addMidiClip, setLoopRegion } from '../../src/store/edits';
import { TimelineGeometry, hitTest } from '../../src/ui/timeline/geometry';
import {
  FadeGesture, MarqueeGesture, MoveClipsGesture, ResizeClipGesture, type GestureHost,
} from '../../src/ui/timeline/gestures';
import { dropPlace, gestureFor, hoverCursor, isPan, newClipAt, rulerCursor } from '../../src/ui/timeline/lane-actions';
import {
  ZOOM_HISTORY, ZoomHistory, fitRange, revealing, scrollbarRange, scrolledWithin, selectionSpan, wheelMove,
} from '../../src/ui/timeline/timeline-nav';
import { UiState } from '../../src/ui/ui-state';
import { setup } from '../helpers/fixtures';

/** Audio (0) and two MIDI tracks (1, 2); clips at beats 0–8 and 16–20 on track 1. */
function project() {
  const s = setup({ audio: 1, midi: 2 });
  s.store.apply(addMidiClip(s.track(1), 0, 8));
  s.store.apply(addMidiClip(s.track(1), 16, 4));
  return s;
}

const geo = (px = 20, beat = 0, y = 0) => new TimelineGeometry(px, beat, y, 60);

describe('timeline navigation', () => {
  it('the playhead is followed only when it leaves the view (or reaches its last 8%)', () => {
    const g = geo(10);
    expect(revealing(g, 50, 1000)).toBeNull();
    expect(revealing(g, 95, 1000)?.scrollBeat).toBe(85);
    expect(revealing(geo(10, 40), 10, 1000)?.scrollBeat).toBe(0);
  });

  it('scrolling stops at the last track; time never goes below 0', () => {
    const { store } = project();
    const g = scrolledWithin(store.project, geo(), -4, 5000, 100);
    expect([g.scrollBeat, g.scrollY]).toEqual([0, 3 * 60 - 100 + 40]);
    expect(scrolledWithin(store.project, geo(), 8, 5000, 1000).scrollY).toBe(0);
  });

  it('the scrollbar reaches the end of the clips, the loop or the playhead', () => {
    const { store } = project();
    expect(scrollbarRange(store.project, geo(20), 400, 0)).toEqual({ total: 20 + 20, start: 0, visible: 20 });
    expect(scrollbarRange(store.project, geo(20), 400, 100).total).toBe(120);
    expect(scrollbarRange(store.project, geo(20, 300), 400, 0)).toEqual({ total: 320, start: 300, visible: 20 });
  });

  it('W shows the whole piece, at least four bars', () => {
    const { store } = project();
    expect(fitRange(store.project)).toEqual({ start: 0, end: 20 });
    expect(fitRange(setup().store.project)).toEqual({ start: 0, end: 16 });
    store.apply(setLoopRegion({ start: 0, end: 64 }));
    expect(fitRange(store.project).end).toBe(64);
  });

  it('Z: the drawn range, otherwise the selected clips\' span, otherwise nothing', () => {
    const { store, track } = project();
    const [a, b] = store.project.track(track(1))!.arrangement.map(pl => pl.id);
    expect(selectionSpan(store.project, { start: 2, end: 3 }, new Set([a]))).toEqual({ start: 2, end: 3 });
    expect(selectionSpan(store.project, null, new Set([a, b]))).toEqual({ start: 0, end: 20 });
    expect(selectionSpan(store.project, null, new Set<PlacementId>())).toBeNull();
  });

  it('the wheel scrolls (Shift: in time), with Ctrl it zooms around the pointer', () => {
    const g = geo(20, 10, 30);
    expect(wheelMove(g, { deltaX: 0, deltaY: 50, zoom: false, shift: false, x: 0 })).toEqual({ kind: 'scroll', beat: 10, y: 80, horizontal: false });
    expect(wheelMove(g, { deltaX: 0, deltaY: 40, zoom: false, shift: true, x: 0 })).toEqual({ kind: 'scroll', beat: 12, y: 30, horizontal: true });
    expect(wheelMove(g, { deltaX: -20, deltaY: 0, zoom: false, shift: false, x: 0 })).toMatchObject({ beat: 9, horizontal: true });
    const zoom = wheelMove(g, { deltaY: -400, deltaX: 0, zoom: true, shift: false, x: 200 });
    expect(zoom.kind).toBe('zoom');
    if (zoom.kind !== 'zoom') return;
    expect(zoom.geometry.pxPerBeat).toBeGreaterThan(20);
    expect(zoom.geometry.xToBeat(200)).toBeCloseTo(g.xToBeat(200));
    const left = wheelMove(g, { deltaY: -400, deltaX: 0, zoom: true, shift: false, x: -50 });
    expect(left.kind === 'zoom' && left.geometry.scrollBeat).toBeCloseTo(10);
  });

  it('X goes back through the last views, at most a fixed number', () => {
    const h = new ZoomHistory();
    expect(h.pop()).toBeUndefined();
    for (let i = 0; i <= ZOOM_HISTORY; i++) h.push(geo(10 + i));
    expect(h.pop()?.pxPerBeat).toBe(10 + ZOOM_HISTORY);
    let n = 1;
    while (h.pop()) n++;
    expect(n).toBe(ZOOM_HISTORY);
  });
});

describe('lane actions', () => {
  it('pressing starts the gesture of what is underneath, with its cursor', () => {
    const { store, track } = project();
    const g = geo(20), ui = new UiState();
    const host = { store, ui, geo: g, snapStep: () => null, seek: () => {}, invalidate: () => {}, reveal: () => {} } as unknown as GestureHost;
    const at = (beat: number, y: number) => hitTest(store.project, g, g.beatToX(beat), y);
    const p = { x: 0, y: 0, shift: false, alt: false, ctrl: false };
    const body = at(4, 90), start = at(0.05, 90), lane = at(12, 90), empty = at(4, 1000);
    expect(body.kind === 'clip' && body.track).toBe(track(1));
    expect(gestureFor(host, body, p)).toBeInstanceOf(MoveClipsGesture);
    expect(hoverCursor(body)).toBe('grab');
    expect(gestureFor(host, start, p)).toBeInstanceOf(ResizeClipGesture);
    expect(hoverCursor(start)).toBe('ew-resize');
    expect(gestureFor(host, lane, p)).toBeInstanceOf(MarqueeGesture);
    expect(hoverCursor(lane)).toBe('default');
    expect(gestureFor(host, empty, p)).toBeInstanceOf(MarqueeGesture);
    expect(hoverCursor(empty)).toBe('default');
    const fade = { ...body, zone: 'fadeIn' } as typeof body;
    expect(gestureFor(host, fade, p)).toBeInstanceOf(FadeGesture);
    expect(hoverCursor(fade)).toBe('col-resize');
  });

  it('the ruler\'s cursors: zoom on the numbers, text on the scrub strip, the loop\'s edges', () => {
    const loop = { start: 4, end: 8 }, toX = (b: number) => b * 10;
    expect(rulerCursor('numbers', loop, 0, toX)).toBe('zoom-in');
    expect(rulerCursor('scrub', loop, 0, toX)).toBe('text');
    expect(rulerCursor('loop', loop, 40, toX)).not.toBe(rulerCursor('loop', loop, 60, toX));
  });

  it('the middle button pans, and Ctrl+Alt with the left one', () => {
    expect(isPan({ button: 1, ctrl: false, alt: false })).toBe(true);
    expect(isPan({ button: 0, ctrl: true, alt: true })).toBe(true);
    expect(isPan({ button: 0, ctrl: true, alt: false })).toBe(false);
    expect(isPan({ button: 2, ctrl: true, alt: true })).toBe(false);
  });

  it('a drop falls on the track underneath, on the grid; below the tracks on none', () => {
    const { store, track } = project();
    expect(dropPlace(store.project, geo(20), 1, 61, 70)).toEqual({ track: track(1), beat: 3 });
    expect(dropPlace(store.project, geo(20), 4, 61, 500)).toEqual({ track: null, beat: 4 });
    expect(dropPlace(store.project, geo(20, 0), 1, -100, 10).beat).toBe(0);
  });

  it('double click on an empty MIDI lane: a one-bar clip at the bar\'s start; not on audio or clips', () => {
    const { store, track } = project();
    const g = geo(20), at = (beat: number, y: number) => hitTest(store.project, g, g.beatToX(beat), y);
    expect(newClipAt(store.project, at(13, 90))).toEqual({ track: track(1), start: 12, length: 4 });
    expect(newClipAt(store.project, at(13, 30))).toBeNull();
    expect(newClipAt(store.project, at(4, 90))).toBeNull();
    expect(newClipAt(store.project, at(4, 1000))).toBeNull();
  });
});
