import { describe, expect, it } from 'vitest';
import type { PlacementId } from '../../src/core/id';
import { AudioClip } from '../../src/model/audio-clip';
import type { Project } from '../../src/model/project';
import { addMidiClip, addSample, setLoopRegion } from '../../src/store/edits';
import { edit } from '../../src/store/project-store';
import { TimelineGeometry, hitTest, type Hit } from '../../src/ui/timeline/geometry';
import {
  FadeGesture, LoopRegionGesture, MarqueeGesture, MoveClipsGesture, PanGesture, ResizeClipGesture, ScrubGesture,
  type GestureHost,
} from '../../src/ui/timeline/gestures';
import type { Pointer } from '../../src/ui/kit/pointer';
import { UiState } from '../../src/ui/ui-state';
import { fakeContext } from '../helpers/canvas';
import { sampleRef, setup } from '../helpers/fixtures';

/** 20 px per beat, 60 px per track. Audio track (0) with an 8-beat clip, MIDI tracks (1, 2): clips 0–8 and 16–20 on 1. */
function harness(step: number | null = null) {
  const s = setup({ audio: 1, midi: 2 });
  const sample = sampleRef(s.ids);
  s.store.apply(addSample(sample));
  s.store.apply(edit('place', (p: Project, { ids }) => p.updatingTrack(s.track(0), t =>
    t.placing({ id: ids.next('placement') as PlacementId, start: 0, length: 8, offset: 0, clip: AudioClip.fromSample(ids.next('clip'), sample, '#fff') }, ids))));
  s.store.apply(addMidiClip(s.track(1), 0, 8));
  s.store.apply(addMidiClip(s.track(1), 16, 4));
  const ui = new UiState(), seeks: number[] = [];
  let invalidated = 0;
  const host: GestureHost = {
    store: s.store, ui, geo: new TimelineGeometry(20, 0, 0, 60),
    snapStep: p => (p.alt ? null : step), seek: b => seeks.push(b), invalidate: () => { invalidated++; },
  };
  const clips = (t: number) => s.store.project.track(s.track(t))!.arrangement;
  const hit = (x: number, y: number) => hitTest(s.store.project, host.geo, x, y) as Extract<Hit, { kind: 'clip' }>;
  return { ...s, ui, host, seeks, clips, hit, get invalidated() { return invalidated; } };
}

const at = (x: number, y: number, mods: Partial<Pointer> = {}): Pointer => ({ x, y, shift: false, alt: false, ctrl: false, ...mods });

describe('moving clips', () => {
  it('a drag moves the clip; a click only selects it', () => {
    const h = harness();
    const id = h.clips(1)[0].id;
    const click = new MoveClipsGesture(h.host, h.hit(40, 90), at(40, 90));
    click.move(at(41, 90));
    click.end();
    expect([...h.ui.selection]).toEqual([id]);
    expect(click.hidden.size).toBe(0);
    const g = new MoveClipsGesture(h.host, h.hit(40, 90), at(40, 90));
    g.move(at(120, 90));
    expect(g.hidden.has(id)).toBe(true);
    expect(g.preview).toBeNull();
    const ctx = fakeContext();
    g.paint(ctx, h.host.geo);
    expect(ctx.calls).toContain('fill');
    g.end();
    expect(h.clips(1).map(pl => pl.start)).toEqual([4, 16]);
  });

  it('Ctrl copies onto another track and selects the copy; Shift adds to the selection', () => {
    const h = harness();
    h.ui.select([h.clips(1)[1].id]);
    const g = new MoveClipsGesture(h.host, h.hit(40, 90), at(40, 90, { shift: true }));
    expect(h.ui.selection.size).toBe(2);
    g.move(at(40, 150, { ctrl: true }));
    expect(g.hidden.size).toBe(0);
    g.end();
    expect(h.clips(1)).toHaveLength(2);
    expect(h.clips(2).map(pl => pl.start)).toEqual([0, 16]);
    expect([...h.ui.selection]).toEqual(h.clips(2).map(pl => pl.id));
  });

  it('back at the start, cancelled or with the project changed meanwhile nothing moves', () => {
    const h = harness();
    const back = new MoveClipsGesture(h.host, h.hit(40, 90), at(40, 90));
    back.move(at(100, 90));
    back.move(at(40, 90));
    back.end();
    const cancelled = new MoveClipsGesture(h.host, h.hit(40, 90), at(40, 90));
    cancelled.move(at(100, 90));
    cancelled.cancel();
    cancelled.end();
    const changed = new MoveClipsGesture(h.host, h.hit(40, 90), at(40, 90));
    changed.move(at(100, 90));
    h.store.apply(setLoopRegion({ start: 0, end: 4 }));
    changed.end();
    expect(h.clips(1).map(pl => pl.start)).toEqual([0, 16]);
    expect(h.invalidated).toBeGreaterThan(3);
  });

  it('the grabbed time range is cut out and moved alone, then stays selected', () => {
    const h = harness();
    const id = h.clips(1)[0].id;
    h.ui.select([id], { start: 2, end: 4 });
    const g = new MoveClipsGesture(h.host, h.hit(60, 90), at(60, 90));
    g.move(at(300, 150));
    expect(g.preview).not.toBeNull();
    g.end();
    expect(h.clips(1).map(pl => [pl.start, pl.length])).toEqual([[0, 2], [4, 4], [16, 4]]);
    expect(h.clips(2).map(pl => [pl.start, pl.length])).toEqual([[14, 2]]);
    expect([...h.ui.selection]).toEqual([h.clips(2)[0].id]);
  });

  it('grabbing a clip outside the selected range takes the whole clip', () => {
    const h = harness();
    const id = h.clips(1)[0].id;
    h.ui.select([id], { start: 2, end: 4 });
    new MoveClipsGesture(h.host, h.hit(120, 90), at(120, 90));
    expect(h.ui.range).toBeNull();
  });
});

describe('resizing clips', () => {
  it('the end edge lengthens the clip, at least a sixteenth without the grid', () => {
    const h = harness();
    const g = new ResizeClipGesture(h.host, h.hit(158, 90));
    expect(g.hidden.size).toBe(1);
    g.move(at(240, 90));
    g.paint(fakeContext(), h.host.geo);
    g.end();
    expect(h.clips(1)[0]).toHaveLength(12);
  });

  it('unchanged or cancelled, nothing happens; the selected clips resize together', () => {
    const h = harness();
    const unchanged = new ResizeClipGesture(h.host, h.hit(158, 90));
    unchanged.move(at(160, 90));
    unchanged.end();
    unchanged.cancel();
    expect(h.clips(1)[0]).toHaveLength(8);
    h.ui.select([h.clips(0)[0].id, h.clips(1)[0].id]);
    const both = new ResizeClipGesture(h.host, h.hit(158, 90));
    both.move(at(100, 90));
    both.end();
    expect([h.clips(0)[0].length, h.clips(1)[0].length]).toEqual([5, 5]);
  });
});

describe('fades', () => {
  it('the handles set the fades, within the clip, in one undo step', () => {
    const h = harness();
    const pl = h.clips(0)[0];
    const hit = (zone: 'fadeIn' | 'fadeOut'): Extract<Hit, { kind: 'clip' }> => ({ kind: 'clip', zone, trackIndex: 0, track: h.track(0), placement: h.clips(0)[0], beat: 0 });
    const fadeIn = new FadeGesture(h.host, hit('fadeIn'));
    fadeIn.move(at(20, 2));
    fadeIn.move(at(40, 2));
    fadeIn.end();
    fadeIn.paint();
    expect(h.clips(0)[0].fadeIn).toBe(2);
    const fadeOut = new FadeGesture(h.host, hit('fadeOut'));
    fadeOut.move(at(-500, 2));
    fadeOut.cancel();
    expect(h.clips(0)[0].fadeOut).toBe(6);
    h.store.undo();
    h.store.undo();
    expect(h.clips(0)[0].fadeIn ?? 0).toBe(pl.fadeIn ?? 0);
    new FadeGesture(h.host, hit('fadeIn')).end();
  });
});

describe('box selection', () => {
  it('a box taking clips partly keeps that range; a click clears the selection, with Shift it doesn\'t', () => {
    const h = harness(1);
    const g = new MarqueeGesture(h.host, at(10, 70));
    const ctx = fakeContext();
    g.paint(ctx, h.host.geo);
    expect(ctx.calls).toHaveLength(0);
    g.move(at(95, 100));
    g.paint(ctx, h.host.geo);
    expect(ctx.calls).toContain('fillRect');
    g.end(at(95, 100));
    expect(h.ui.selection.size).toBe(1);
    expect(h.ui.range).toEqual({ start: 1, end: 5 });
    const shiftClick = new MarqueeGesture(h.host, at(10, 70));
    shiftClick.end(at(10, 70, { shift: true }));
    expect(h.ui.selection.size).toBe(1);
    const click = new MarqueeGesture(h.host, at(10, 70));
    click.end(at(10, 70));
    click.cancel();
    expect(h.ui.selection.size).toBe(0);
  });

  it('a box around whole clips selects them without a range', () => {
    const h = harness(1);
    const g = new MarqueeGesture(h.host, at(0, 70));
    g.end(at(500, 10));
    expect(h.ui.selection.size).toBe(3);
    expect(h.ui.range).toBeNull();
  });
});

describe('the loop in the ruler', () => {
  it('a click turns it on or off; the body moves it; outside draws a new one', () => {
    const h = harness(1);
    h.store.apply(setLoopRegion({ start: 4, end: 8, enabled: false }));
    const click = new LoopRegionGesture(h.host, at(120, 5));
    expect(click.cursor).toBe('grabbing');
    click.move(at(121, 5));
    click.end();
    expect(h.store.project.loop.enabled).toBe(true);
    const body = new LoopRegionGesture(h.host, at(120, 5));
    body.move(at(160, 5));
    body.move(at(200, 5));
    body.end();
    body.paint();
    expect(h.store.project.loop).toMatchObject({ start: 8, end: 12 });
    h.store.undo();
    expect(h.store.project.loop).toMatchObject({ start: 4, end: 8 });
    const outside = new LoopRegionGesture(h.host, at(400, 5));
    expect(outside.cursor).toBe('ew-resize');
    outside.move(at(405, 5));
    outside.move(at(480, 5));
    outside.cancel();
    expect(h.store.project.loop).toMatchObject({ start: 20, end: 24 });
  });
});

describe('scrolling and the playhead', () => {
  it('panning follows the hand; scrubbing moves the playhead on the grid', () => {
    const h = harness(1);
    const scrolls: [number, number][] = [];
    const pan = new PanGesture({ ...h.host, geo: new TimelineGeometry(20, 10, 30, 60) }, at(100, 100), (b, y) => scrolls.push([b, y]));
    pan.move(at(60, 80));
    pan.end();
    pan.cancel();
    pan.paint();
    expect(scrolls).toEqual([[12, 50]]);
    const scrub = new ScrubGesture(h.host, at(31, 5));
    scrub.move(at(-40, 5));
    scrub.move(at(95, 5, { alt: true }));
    scrub.end();
    scrub.cancel();
    scrub.paint();
    expect(h.seeks).toEqual([2, 0, 4.75]);
  });
});
