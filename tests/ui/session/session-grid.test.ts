import { describe, expect, it } from 'vitest';
import type { TrackId } from '../../../src/core/id';
import type { TrackSessionState } from '../../../src/engine/session';
import { BusTrack, GroupTrack } from '../../../src/model/track';
import { addBus, groupTracks, setBusFolded } from '../../../src/store/edits';
import { newSlotMidiClip } from '../../../src/store/session-edits';
import { browserDropTarget, indexSpot, movedRefs, slotOffset, trackSpot, type Span } from '../../../src/ui/session/session-drop';
import { busColumn, busRights, gridColumns, gridRows, masterColumn, ringArea, row } from '../../../src/ui/session/session-layout';
import { clipProgress, isArmed, sessionPlayback, slotFace } from '../../../src/ui/session/slot-face';
import { setup } from '../../helpers/fixtures';

const idle: TrackSessionState = { playing: null, queued: null, followsArrangement: true };

describe('slot face', () => {
  const { store, track } = setup({ audio: 1, midi: 1 });
  store.apply(newSlotMidiClip({ track: track(1), slot: 0 }));
  const audio = store.project.track(track(0))!, midi = store.project.track(track(1))!, clip = midi.slots[0]!;

  it('a clip: ▶, or ● lit while recording into it', () => {
    expect(slotFace(midi, clip, false, false)).toMatchObject({ button: 'launch', recording: false });
    expect(slotFace(midi, clip, false, false).title).toContain(clip.name);
    expect(slotFace(midi, clip, true, true)).toMatchObject({ button: 'recording', recording: true });
  });

  it('an empty slot: ● when armed, lit while recording, ■ otherwise (audio says it imports)', () => {
    expect(slotFace(midi, null, false, true).button).toBe('record');
    expect(slotFace(midi, null, true, false).button).toBe('recording');
    expect(slotFace(midi, null, false, false)).toEqual({ button: 'stop', recording: false, title: '' });
    expect(slotFace(audio, null, false, false).title).toMatch(/import an audio file/);
  });

  it('only MIDI tracks are armed', () => {
    expect(isArmed(midi, new Set([midi.id, audio.id]))).toBe(true);
    expect(isArmed(audio, new Set([audio.id]))).toBe(false);
    expect(isArmed(midi, new Set())).toBe(false);
  });

  it('progress goes from 0 to 1 along the clip and wraps with the loop', () => {
    const length = clip.loop.end - clip.loop.start;
    expect(clipProgress(clip, 0)).toBe(0);
    expect(clipProgress(clip, length / 2)).toBeCloseTo(0.5);
    expect(clipProgress(clip, length * 1.25)).toBeCloseTo(0.25);
  });
});

describe('session playback', () => {
  it('playing, queued and stopping slots; scenes play when one of their clips plays', () => {
    const { store, track } = setup({ midi: 2 });
    store.apply(newSlotMidiClip({ track: track(0), slot: 0 }));
    store.apply(newSlotMidiClip({ track: track(1), slot: 1 }));
    const states: Record<string, TrackSessionState> = {
      [track(0)]: { playing: { slot: 0, elapsed: 1 }, queued: 'stop', followsArrangement: false },
      [track(1)]: { playing: null, queued: { slot: 1 }, followsArrangement: true },
    };
    const state = sessionPlayback(store.project, t => states[t.id] ?? idle);
    const a = state.tracks.get(track(0))!, b = state.tracks.get(track(1))!;
    expect(a.slots[0].playing).toBe(true);
    expect(a.slots[0].progress).toBeGreaterThan(0);
    expect(a.slots[1]).toEqual({ playing: false, queued: false, progress: 0 });
    expect(a.stopQueued && a.taken).toBe(true);
    expect(b.slots[1]).toEqual({ playing: false, queued: true, progress: 0 });
    expect(b.stopQueued || b.taken).toBe(false);
    expect(state.scenes.map(s => [s.playing, s.queued])).toEqual([[true, false], [false, true], [false, false], [false, false]]);
  });

  it('a group\'s slots: from its tracks, row by row', () => {
    const { store, track } = setup({ midi: 2 });
    const [first, second] = [track(0), track(1)];
    store.apply(newSlotMidiClip({ track: first, slot: 2 }));
    store.apply(groupTracks([first, second]));
    const group = store.project.tracks.find(t => t instanceof GroupTrack)!;
    const states: Record<string, TrackSessionState> = { [first]: { playing: { slot: 2, elapsed: 0 }, queued: null, followsArrangement: false } };
    const g = sessionPlayback(store.project, t => states[t.id] ?? idle).tracks.get(group.id)!;
    expect(g.slots.map(s => s.playing)).toEqual([false, false, true, false]);
    expect(g.slots[2].progress).toBe(0);
  });
});

describe('session layout', () => {
  const buses = (folded: boolean[]) => folded.map((f, i) => BusTrack.empty(`b${i}` as TrackId, `Bus ${i}`, '#fff').withFolded(f) as BusTrack);

  it('rows: headers, scenes, stop, space, mixer', () => {
    expect([row.head, row.scene(0), row.scene(3), row.stop(4), row.mixer(4)]).toEqual([1, 2, 5, 6, 8]);
    expect(gridRows(4)).toBe('auto repeat(4, var(--session-row)) auto 1fr auto');
  });

  it('columns: the tracks, the space, the buses (narrow when collapsed), the master', () => {
    expect(gridColumns(3, buses([false, true]))).toBe('repeat(3, var(--session-col)) minmax(0, 1fr) var(--session-col) var(--session-folded) var(--session-master)');
    expect(gridColumns(0, [])).toBe('minmax(0, 1fr) var(--session-master)');
    expect([busColumn(3, 0), busColumn(3, 1), masterColumn(3, 2)]).toEqual([5, 6, 7]);
  });

  it('a bus is pinned at the master\'s width plus the buses after it', () => {
    expect(busRights(buses([false, true]))).toEqual([
      'calc(var(--session-master) + 2px + var(--session-folded) + 2px)',
      'calc(var(--session-master) + 2px)',
    ]);
  });

  it('the controller\'s box is clipped to the grid, hidden if it starts outside', () => {
    expect(ringArea(null, 4, 4)).toBeNull();
    expect(ringArea({ track: 4, scene: 0, width: 8, height: 5 }, 4, 4)).toBeNull();
    expect(ringArea({ track: 1, scene: 2, width: 8, height: 5 }, 4, 4)).toEqual({ row: 4, column: 2, rows: 2, columns: 3 });
  });
});

describe('session drops', () => {
  const spans = (...starts: number[]): Span[] => starts.map(s => ({ start: s, end: s + 100 }));

  it('a track: before the column in its left half, after in its right half, at the end past the tracks', () => {
    const { store, track } = setup({ midi: 3 });
    const p = store.project, heads = spans(0, 100, 200);
    expect(trackSpot(p, track(0), heads, 120, false)).toEqual({ drop: { before: track(1) }, at: 99 });
    expect(trackSpot(p, track(0), heads, 180, false)).toEqual({ drop: { after: track(1) }, at: 201 });
    expect(trackSpot(p, track(0), heads, 50, false)).toBeNull();
    expect(trackSpot(p, track(0), heads, 500, false)).toEqual({ drop: { end: true }, at: 301 });
    expect(trackSpot(p, track(0), heads, 120, true)).toEqual({ drop: { end: true }, at: 301 });
  });

  it('a track dropped on an open group goes first inside it; not into its own group', () => {
    const { store, track } = setup({ midi: 3 });
    const [outside, member] = [track(0), track(2)];
    store.apply(groupTracks([track(1), member]));
    const p = store.project, group = p.tracks.find(t => t instanceof GroupTrack)!;
    const col = p.visibleTracks.findIndex(t => t.id === group.id);
    const heads = spans(...p.visibleTracks.map((_, i) => i * 100));
    expect(trackSpot(p, outside, heads, col * 100 + 80, false)?.drop).toEqual({ first: group.id });
    const inner = p.visibleTracks.findIndex(t => t.id === member);
    expect(inner).toBeGreaterThan(col);
    expect(trackSpot(p, group.id, heads, inner * 100 + 20, false)).toBeNull();
  });

  it('a bus or a scene: its new index, null where it already is', () => {
    const items = spans(0, 100, 200);
    expect(indexSpot(0, items, 160)).toEqual({ drop: 1, at: 199 });
    expect(indexSpot(2, items, 10)).toEqual({ drop: 0, at: -1 });
    expect(indexSpot(0, items, 500)).toEqual({ drop: 2, at: 301 });
    expect(indexSpot(1, items, 60)).toBeNull();
    expect(indexSpot(1, items, 160)).toBeNull();
  });

  it('clips moved across columns and rows land in the same shape', () => {
    const { store, track } = setup({ midi: 3 });
    const tracks = store.project.visibleTracks;
    const off = slotOffset(tracks, { track: track(0), slot: 0 }, { track: track(1), slot: 2 });
    expect(off).toEqual({ columns: 1, rows: 2 });
    expect(movedRefs(tracks, [{ track: track(0), slot: 0 }, { track: track(1), slot: 1 }], off.columns, off.rows))
      .toEqual([{ track: track(1), slot: 2 }, { track: track(2), slot: 3 }]);
  });

  it('a browser item: the slot underneath, the master, a column (sample in the first free slot, device on the chain), or a new track', () => {
    const { store, track } = setup({ audio: 1 });
    store.apply(addBus());
    const p = store.project, sample = { payload: { kind: 'sample' } } as never, device = { payload: { kind: 'device' } } as never;
    const none = { slot: null, master: false, track: null };
    expect(browserDropTarget(p, sample, { ...none, slot: { track: track(0), slot: 2 } })).toEqual({ kind: 'slot', track: track(0), slot: 2 });
    expect(browserDropTarget(p, device, { ...none, master: true })).toEqual({ kind: 'chain', owner: 'master' });
    expect(browserDropTarget(p, sample, { ...none, track: track(0) })).toEqual({ kind: 'slot', track: track(0), slot: 0 });
    expect(browserDropTarget(p, device, { ...none, track: track(0) })).toEqual({ kind: 'chain', owner: track(0) });
    expect(browserDropTarget(p, sample, none)).toEqual({ kind: 'slot', track: null, slot: 0 });
    expect(browserDropTarget(p, device, none)).toEqual({ kind: 'lane', track: null, beat: 0 });
    store.apply(setBusFolded(p.buses[0].id, true));
  });
});
