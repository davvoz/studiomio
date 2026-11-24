import { describe, expect, it } from 'vitest';
import type { ClipId } from '../../src/core/id';
import { TimeSignature } from '../../src/core/music-time';
import { MidiClip } from '../../src/model/midi-clip';
import { BeatAxis } from '../../src/ui/clip-editor/clip-geometry';
import {
  FRAME, FlagGesture, IdleGesture, LoopBandGesture, PanGesture, frameCursor, frameGestureFor, frameHit, paintBeatGrid, paintClipRuler,
  type ClipHost,
} from '../../src/ui/clip-editor/clip-frame';
import type { Pointer } from '../../src/ui/timeline/gestures';
import { fakeContext } from '../helpers/canvas';

const at = (x: number, y: number, mods: Partial<Pointer> = {}): Pointer => ({ x, y, shift: false, alt: false, ctrl: false, ...mods });

/** A 4-beat looping clip, 40 px per beat from beat 0; the host applies the commits to it. */
function editor(step: number | null = 0.5) {
  let clip = MidiClip.empty('c1' as ClipId, 'Clip', '#fff', 4);
  const labels: string[] = [], seeks: number[] = [];
  const host: ClipHost<MidiClip> = {
    axis: new BeatAxis(40, 0),
    snapStep: p => (p.alt ? null : step),
    commit: (label, fn) => { labels.push(label); clip = fn(clip); },
    seekContent: b => seeks.push(b),
    setAxis: () => {},
    invalidate: () => {},
  };
  return { host, labels, seeks, get clip() { return clip; } };
}

describe('the clip editor\'s ruler', () => {
  it('what is under the pointer: the loop band, the flags, the ruler, nothing lower', () => {
    const { host, clip } = editor();
    expect(frameHit(host.axis, clip, 80, 2)).toEqual({ kind: 'loop', part: 'body' });
    expect(frameHit(host.axis, clip, 2, FRAME.loopBand + 2)).toEqual({ kind: 'flag', edge: 'start' });
    expect(frameHit(host.axis, clip, 158, FRAME.loopBand + 2)).toEqual({ kind: 'flag', edge: 'end' });
    expect(frameHit(host.axis, clip, 80, FRAME.loopBand + 2)).toEqual({ kind: 'ruler' });
    expect(frameHit(host.axis, clip, 80, FRAME.ruler)).toBeNull();
  });

  it('each part starts its gesture and shows its cursor', () => {
    const { host, clip } = editor();
    expect(frameGestureFor.loop(host, clip, { kind: 'loop', part: 'end' }, at(160, 2))).toBeInstanceOf(LoopBandGesture);
    expect(frameGestureFor.flag(host, clip, { kind: 'flag', edge: 'end' }, at(160, 15))).toBeInstanceOf(FlagGesture);
    expect(frameGestureFor.ruler(host, clip, { kind: 'ruler' }, at(80, 15)).cursor).toBe('zoom-in');
    expect([frameCursor.loop({ kind: 'loop', part: 'start' }), frameCursor.flag({ kind: 'flag', edge: 'start' }), frameCursor.ruler({ kind: 'ruler' })])
      .toEqual(['w-resize', 'ew-resize', 'zoom-in']);
  });

  it('the flags move the clip\'s start and end on the grid, shown before release', () => {
    const e = editor();
    const start = new FlagGesture(e.host, 'start');
    start.end();
    expect(e.labels).toEqual([]);
    start.move(at(70, 15));
    expect(start.preview(e.clip).region.start).toBe(2);
    start.end();
    const end = new FlagGesture(e.host, 'end');
    end.move(at(195, 15, { alt: true }));
    end.end();
    expect(e.labels).toEqual(['Clip start', 'Clip end']);
    expect(e.clip.region.start).toBe(2);
    expect(e.clip.region.end).toBeCloseTo(4.875);
    const cancelled = new FlagGesture(e.host, 'end');
    cancelled.move(at(300, 15));
    cancelled.cancel();
    expect(cancelled.preview(e.clip)).toBe(e.clip);
  });

  it('the loop band: a click turns it off, the body carries the start along, an edge doesn\'t', () => {
    const e = editor();
    const click = new LoopBandGesture(e.host, e.clip.loop, 'body', at(80, 2));
    expect(click.cursor).toBe('grabbing');
    click.move(at(81, 2));
    click.end();
    expect(e.clip.loop.enabled).toBe(false);
    const body = new LoopBandGesture(e.host, e.clip.loop, 'body', at(80, 2));
    body.move(at(120, 2));
    expect(body.preview(e.clip).loop.start).toBe(1);
    body.end();
    expect([e.clip.loop.start, e.clip.loop.end, e.clip.region.start]).toEqual([1, 5, 1]);
    const edge = new LoopBandGesture(e.host, e.clip.loop, 'end', at(200, 2));
    edge.move(at(280, 2));
    edge.end();
    expect([e.clip.loop.start, e.clip.loop.end, e.clip.region.start]).toEqual([1, 7, 1]);
    const empty = new LoopBandGesture(e.host, e.clip.loop, 'outside', at(400, 2));
    empty.move(at(405, 2));
    empty.cancel();
    expect(empty.preview(e.clip)).toBe(e.clip);
    empty.end();
    expect(e.labels).toHaveLength(3);
  });

  it('a click on the ruler moves the cursor there; elsewhere and when dragged it doesn\'t; idle does nothing', () => {
    const e = editor();
    new PanGesture(e.host, at(80, 15), true).end(at(80, 15));
    new PanGesture(e.host, at(80, 60)).end(at(80, 60));
    const dragged = new PanGesture(e.host, at(80, 15), true);
    dragged.move(at(120, 15));
    dragged.cancel();
    dragged.end(at(120, 15));
    expect(dragged.preview(e.clip)).toBe(e.clip);
    expect(e.seeks).toEqual([2]);
    const idle = new IdleGesture<MidiClip>();
    idle.move();
    idle.end();
    idle.cancel();
    expect([idle.cursor, idle.preview(e.clip)]).toEqual(['default', e.clip]);
  });
});

describe('painting the frame', () => {
  it('grid and ruler at every zoom, with the loop on and off', () => {
    const sig = TimeSignature.COMMON;
    for (const px of [2, 12, 40, 400]) {
      const g = fakeContext(), axis = new BeatAxis(px, -1);
      paintBeatGrid(g, axis, 800, FRAME.ruler, 300, 0.25, sig);
      paintClipRuler(g, axis, 800, MidiClip.empty('c1' as ClipId, 'Clip', '#fff', 4), sig);
      expect(g.calls).toContain('fillText');
      expect(g.calls).toContain('fillRect');
    }
    const off = MidiClip.empty('c1' as ClipId, 'Clip', '#fff', 4).withLoop({ enabled: false, start: 0, end: 4 });
    const g = fakeContext();
    paintClipRuler(g, new BeatAxis(40, 0), 400, off, sig);
    expect(g.calls.filter(c => c === 'fill')).toHaveLength(2);
  });
});
