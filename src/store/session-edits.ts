/* Session edits: clips in the slots and scenes. Like the others, pure functions that
 * return an Edit (they can be undone). A slot is (track, scene index). */
import type { ClipId, SceneId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { AudioClip } from '../model/audio-clip';
import type { Clip, Color } from '../model/clip';
import { paletteColor } from '../model/colors';
import { MidiClip } from '../model/midi-clip';
import type { Project } from '../model/project';
import type { SampleRef } from '../model/sample';
import { AudioTrack, GroupTrack, type Track } from '../model/track';
import { edit, type Edit } from './project-store';

export interface SlotRef {
  readonly track: TrackId;
  readonly slot: number;
}

const requireTrack = (p: Project, id: TrackId): Track => {
  const t = p.track(id);
  if (!t) throw new Error(`track ${id} not found`);
  return t;
};

/** Session clips loop, as in Live. */
const looping = <C extends Clip>(clip: C): C => clip.withLoop({ ...clip.loop, enabled: true });

/** An empty one-bar MIDI clip in the slot. */
export const newSlotMidiClip = ({ track, slot }: SlotRef): Edit =>
  edit('New MIDI clip', (p, { ids }) => {
    const t = requireTrack(p, track);
    return p.updatingTrack(track, x => x.withSlot(slot, MidiClip.empty(ids.next('clip'), 'Clip MIDI', t.color, p.signature.beatsPerBar)));
  });

/** Empties several slots in a single step. */
export const clearSlots = (refs: readonly SlotRef[]): Edit =>
  edit('Delete clip', p => refs.reduce((q, r) => q.updatingTrack(r.track, t => t.withSlot(r.slot, null)), p));

/** Moves (or copies) all together the clips of `refs`, by `columns` columns (among the visible
 *  tracks) and `rows` scenes. You can't leave the grid or end up on a track of another
 *  kind: in that case nothing moves. Those that were in their place are replaced. */
export const moveSlots = (refs: readonly SlotRef[], columns: number, rows: number, copy: boolean): Edit =>
  edit(copy ? 'Copy clip' : 'Move clip', (p, { ids }) => {
    const tracks = p.visibleTracks;
    const moves = refs.flatMap(r => {
      const clip = requireTrack(p, r.track).slots[r.slot];
      if (!clip) return [];
      const to = tracks[tracks.findIndex(t => t.id === r.track) + columns];
      const slot = r.slot + rows;
      if (!to || slot < 0 || slot >= p.scenes.length) throw new Error('The selection doesn\'t fit: it would leave the grid.');
      if (!to.accepts(clip)) throw new TypeError('the clip doesn\'t go on this track');
      return [{ from: r, clip, track: to.id, slot }];
    });
    if (!columns && !rows) return p;
    const cleared = copy ? p : moves.reduce((q, m) => q.updatingTrack(m.from.track, t => t.withSlot(m.from.slot, null)), p);
    return moves.reduce((q, m) => q.updatingTrack(m.track, t => t.withSlot(m.slot, copy ? m.clip.withId(ids.next('clip')) : m.clip)), cleared);
  });

/** A copy of the clips of `refs` right below the block they form. As for a single clip, if
 *  even a single place is taken (or doesn't exist) the needed scenes are inserted first. */
export const duplicateSlots = (refs: readonly SlotRef[]): Edit =>
  edit('Duplicate clip', (p, { ids }) => {
    const filled = refs.filter(r => requireTrack(p, r.track).slots[r.slot]);
    if (!filled.length) throw new Error('the slots are empty');
    const top = Math.min(...filled.map(r => r.slot)), below = Math.max(...filled.map(r => r.slot)) + 1, height = below - top;
    const free = filled.every(r => r.slot + height < p.scenes.length && !requireTrack(p, r.track).slots[r.slot + height]);
    let next = p;
    if (!free) for (let i = 0; i < height; i++) next = next.addingScene({ id: ids.next('scene'), name: String(next.scenes.length + 1) }, below);
    return filled.reduce((q, r) => q.updatingTrack(r.track, t => t.withSlot(r.slot + height, t.slots[r.slot]!.withId(ids.next('clip')))), next);
  });

/** Changes clip `clip` in the track's slots (notes, warp, name…). */
export const updateSlotClip = <C extends Clip>(label: string, track: TrackId, clip: ClipId, fn: (c: C) => Clip): Edit =>
  edit(label, p => p.updatingTrack(track, t => {
    const slot = t.slots.findIndex(c => c?.id === clip);
    if (slot < 0) throw new Error(`clip ${clip} not found in the slots`);
    return t.withSlot(slot, fn(t.slots[slot] as C));
  }));

/** An audio imported into the slot: on the given track if it's audio, otherwise on a new one. */
export const importSampleToSlot = (sample: SampleRef, target: TrackId | null, slot: number): Edit =>
  edit('Import audio', (p, { ids }) => {
    let next = p.sample(sample.id) ? p : p.addingSample(sample);
    let track = target && next.track(target)?.kind === 'audio' ? target : null;
    if (!track) {
      const t = AudioTrack.empty(ids.next('track'), sample.name, paletteColor(next.tracks.length), next.scenes.length);
      // on a group the new track goes at the end of the group
      next = target && next.track(target) instanceof GroupTrack ? next.addingTrack(t.withGroup(target), next.blockEnd(target)) : next.addingTrack(t);
      track = t.id;
    }
    const clip = looping(AudioClip.fromSample(ids.next('clip'), sample, next.track(track)!.color));
    return next.updatingTrack(track, t => t.withSlot(slot, clip));
  });

// ------------------------------------------------------------------ scene

/** An empty scene at position `index` (at the end if missing). */
export const insertScene = (index?: number): Edit =>
  edit('New scene', (p, { ids }) => p.addingScene({ id: ids.next('scene'), name: String(p.scenes.length + 1) }, index));

/** Moves the scene, with its clips, to position `toIndex` (counted without it). */
export const moveScene = (id: SceneId, toIndex: number): Edit =>
  edit('Move scene', p => p.movingScene(id, toIndex));

export const renameScene = (id: SceneId, name: string): Edit =>
  edit('Rename scene', p => p.renamingScene(id, name));

export const deleteScene = (id: SceneId): Edit => edit('Delete scene', p => p.removingScene(id));

/** Colours the scene (without `color`: no colour). */
export const setSceneColor = (id: SceneId, color?: Color): Edit =>
  edit(color ? 'Scene colour' : 'Remove the scene colour', p => p.recoloringScene(id, color));

/** Capture and insert scene, as in Live: a new scene below `index` with the playing clips
 *  (`playing`: track → clip). The clips themselves go into the new scene and in their place
 *  copies remain: whoever plays continues without interruption, but now from the new row. */
export const captureScene = (index: number, playing: ReadonlyMap<TrackId, ClipId>): Edit =>
  edit('Capture and insert scene', (p, { ids }) => {
    const at = index + 1;
    let next = p.addingScene({ id: ids.next('scene'), name: String(p.scenes.length + 1) }, at);
    for (const [track, id] of playing) {
      const slot = next.track(track)?.slots.findIndex(c => c?.id === id) ?? -1;
      if (slot < 0) continue;
      next = next.updatingTrack(track, t => t.withSlot(slot, t.slots[slot]!.withId(ids.next('clip'))).withSlot(at, t.slots[slot]));
    }
    return next;
  });

/** A copy of the scene right below, with copies of its clips. */
export const duplicateScene = (id: SceneId): Edit =>
  edit('Duplicate scene', (p, { ids }) => {
    const index = p.scenes.findIndex(s => s.id === id);
    if (index < 0) throw new Error(`scene ${id} not found`);
    const source = p.scenes[index];
    let next = p.addingScene({ id: ids.next('scene'), name: `${source.name} copy`, ...(source.color ? { color: source.color } : {}) }, index + 1);
    for (const t of p.tracks) {
      const clip = t.slots[index];
      if (clip) next = next.updatingTrack(t.id, x => x.withSlot(index + 1, clip.withId(ids.next('clip'))));
    }
    return next;
  });

/** Scene `index` on the timeline from beat `at`: each track places there a copy of the clip
 *  of its slot, `length` long (the loops repeat, the other clips play once). What
 *  was underneath is shortened or removed, as when pasting. */
export const sceneToArrangement = (index: number, at: Beats, length: Beats): Edit =>
  edit('Scene to the arrangement', (p, { ids }) => p.tracks.reduce((next, t) => {
    const clip = t instanceof GroupTrack ? null : t.slots[index];
    if (!clip) return next;
    const placed = { id: ids.next('placement'), clip: clip.withId(ids.next('clip')), start: Math.max(0, at), length, offset: 0 };
    return next.updatingTrack(t.id, x => x.placing(placed, ids));
  }, p));

/** A clip for a slot, with the rendered file it plays if it's new. */
export interface SceneClip {
  readonly track: TrackId;
  readonly clip: Clip;
  readonly sample?: SampleRef;
}

/** The opposite of sceneToArrangement: a new scene at the bottom with the given clips, looping. */
export const arrangementToScene = (name: string, clips: readonly SceneClip[]): Edit =>
  edit('Arrangement to session', (p, { ids }) => {
    const at = p.scenes.length;
    return clips.reduce((next, { track, clip, sample }) => {
      const withSample = sample && !next.sample(sample.id) ? next.addingSample(sample) : next;
      return withSample.updatingTrack(track, t => t.withSlot(at, looping(clip)));
    }, p.addingScene({ id: ids.next('scene'), name }, at));
  });
