import { describe, expect, it } from 'vitest';
import { sequentialIds, type ClipId } from '../../src/core/id';
import { Tempo, TimeSignature } from '../../src/core/music-time';
import { AudioClip } from '../../src/model/audio-clip';
import { BeatAxis } from '../../src/ui/clip-editor/clip-geometry';
import { MarkerGesture, editorCursor, editorGestureFor, editorHit, type EditorHit, type EditorHost } from '../../src/ui/clip-editor/editor-gestures';
import { LAYOUT, paintEditor } from '../../src/ui/clip-editor/editor-painter';
import { PanGesture } from '../../src/ui/clip-editor/clip-frame';
import type { Peaks } from '../../src/ui/waveform';
import type { Pointer } from '../../src/ui/kit/pointer';
import { fakeContext } from '../helpers/canvas';
import { sampleRef } from '../helpers/fixtures';

const at = (x: number, y: number, mods: Partial<Pointer> = {}): Pointer => ({ x, y, shift: false, alt: false, ctrl: false, ...mods });
const STRIP = LAYOUT.ruler + 10;

/** A 4 s loop at 120 BPM (8 beats, transients every half second), 40 px per beat: markers at x 0 and 320. */
function editor() {
  const sample = sampleRef(sequentialIds());
  let clip = AudioClip.fromSample('c1' as ClipId, sample, '#fff');
  const labels: string[] = [], selected: number[] = [];
  const host: EditorHost = {
    axis: new BeatAxis(40, 0),
    clip: () => clip, duration: () => 4, transients: () => sample.analysis!.transients,
    selectMarker: i => selected.push(i),
    snapStep: p => (p.alt ? null : 0.25),
    commit: (label, fn) => { labels.push(label); clip = fn(clip); },
    seekContent: () => {}, setAxis: () => {}, invalidate: () => {},
  };
  return { host, labels, selected, get clip() { return clip; } };
}

describe('audio editor: what is under the pointer', () => {
  it('ruler, waveform, markers, transients, the bare strip; without warp only the strip', () => {
    const e = editor();
    const hit = (x: number, y: number) => editorHit(e.host, e.clip, x, y);
    expect(hit(60, 5).kind).toBe('loop');
    expect(hit(60, LAYOUT.top + 20)).toEqual({ kind: 'wave' });
    expect(hit(3, STRIP)).toEqual({ kind: 'marker', index: 0 });
    expect(hit(41, STRIP)).toEqual({ kind: 'transient', t: 0.5 });
    expect(hit(60, STRIP)).toEqual({ kind: 'strip' });
    expect(editorHit(e.host, e.clip.withWarp({ enabled: false }), 41, STRIP)).toEqual({ kind: 'strip' });
    const cursors = [editorCursor.marker({ kind: 'marker', index: 0 }), editorCursor.transient({ kind: 'transient', t: 0 }),
      editorCursor.strip({ kind: 'strip' }), editorCursor.wave({ kind: 'wave' })];
    expect(cursors).toEqual(['ew-resize', 'copy', 'default', 'grab']);
  });
});

describe('audio editor: warp markers', () => {
  it('a marker dragged lands on the grid; a click only selects it', () => {
    const e = editor();
    const hit: EditorHit = { kind: 'marker', index: 1 };
    const click = editorGestureFor.marker(e.host, e.clip, hit, at(320, STRIP));
    click.move(at(321, STRIP));
    click.end(at(321, STRIP));
    expect(e.labels).toEqual([]);
    const g = editorGestureFor.marker(e.host, e.clip, hit, at(320, STRIP));
    g.move(at(363, STRIP));
    expect(g.preview(e.clip).warp.markers.markers[1].b).toBe(9);
    g.end(at(363, STRIP));
    expect(e.labels).toEqual(['Move warp marker']);
    expect(e.clip.warp.markers.markers[1].b).toBe(9);
    expect(e.selected).toEqual([1, 1]);
  });

  it('with Shift the audio slides under the marker; cancelled, nothing changes', () => {
    const e = editor();
    const g = new MarkerGesture(e.host, e.clip.warp.markers, 1, at(320, STRIP, { shift: true }));
    g.move(at(340, STRIP, { shift: true }));
    g.end();
    expect(e.labels).toEqual(['Move audio under the marker']);
    expect(e.clip.warp.markers.markers[1].b).toBe(8);
    const cancelled = new MarkerGesture(e.host, e.clip.warp.markers, 1, at(320, STRIP));
    cancelled.move(at(400, STRIP));
    cancelled.cancel();
    expect(cancelled.preview(e.clip)).toBe(e.clip);
  });

  it('a transient clicked becomes a marker; dragged, it moves too', () => {
    const e = editor();
    editorGestureFor.transient(e.host, e.clip, { kind: 'transient', t: 1 }, at(80, STRIP)).end(at(80, STRIP));
    expect(e.labels).toEqual(['Add warp marker']);
    expect(e.clip.warp.markers.markers).toHaveLength(3);
    const g = editorGestureFor.transient(e.host, e.clip, { kind: 'transient', t: 2 }, at(160, STRIP));
    g.move(at(170, STRIP, { alt: true }));
    g.end(at(170, STRIP));
    expect(e.labels.at(-1)).toBe('Move warp marker');
    expect(editorGestureFor.wave(e.host, e.clip, { kind: 'wave' }, at(0, 100))).toBeInstanceOf(PanGesture);
    expect(editorGestureFor.strip(e.host, e.clip, { kind: 'strip' }, at(0, STRIP)).cursor).toBe('default');
  });
});

describe('audio editor: painting', () => {
  it('waveform, region, transients, markers with the tempo, the hovered transient, the playhead', () => {
    const e = editor();
    const peaks = { range: (t0: number) => (t0 < 2 ? [-0.5, 0.5] : [0, 0]) } as unknown as Peaks;
    const base = {
      width: 400, height: 200, axis: e.host.axis, duration: 4, transients: e.host.transients(), peaks,
      tempo: new Tempo(120), signature: TimeSignature.COMMON, grid: 0.25,
    };
    const g = fakeContext();
    paintEditor({ ...base, g, clip: e.clip.withRegion({ start: 1, end: 6 }), selectedMarker: 1, hoverTransient: 1, playhead: 2 });
    expect(g.calls).toContain('fillText');
    const plain = fakeContext();
    paintEditor({
      ...base, g: plain, clip: e.clip.withWarp({ enabled: false }), peaks: null, transients: Array.from({ length: 100 }, (_, i) => i * 0.04),
      selectedMarker: -1, hoverTransient: 1, playhead: null,
    });
    expect(plain.calls).not.toContain('stroke');
  });
});
