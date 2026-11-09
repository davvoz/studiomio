/* The app's clipboard (internal, not the system's): clips, piano roll notes, devices or
 * a stretch of a modulation curve. An immutable snapshot is copied; pasting creates copies with new ids. */
import { asId, type TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { placementEnd, type Placement } from '../model/arrangement';
import type { Clip } from '../model/clip';
import type { EnvelopePoint, ModScale } from '../model/envelope';
import type { Note } from '../model/midi-clip';
import type { NoteChange, Selection } from '../model/note-edits';
import type { Project } from '../model/project';
import type { CopiedDevices } from './device-clipboard';
import { edit, type Edit } from './project-store';
import { findPlacement, type PlacementRef } from './selection-edits';
import type { SlotRef } from './session-edits';

/** A copied clip: its track is relative to the first copied track, the start to the first beat. */
export interface CopiedPlacement {
  readonly trackOffset: number;
  readonly placement: Placement;
  /** Copied from the session: its scene, relative to the first copied one. */
  readonly slotOffset?: number;
}

export interface CopiedClips {
  readonly kind: 'clips';
  readonly items: readonly CopiedPlacement[];
  /** From the start of the first clip to the end of the last. */
  readonly span: Beats;
  /** The topmost track copied from. */
  readonly sourceTrack: TrackId;
}

export interface CopiedNotes {
  readonly kind: 'notes';
  /** Starts relative to the first note; pitches unchanged. */
  readonly notes: readonly Note[];
  readonly span: Beats;
  /** Where the first copied note started. */
  readonly origin: Beats;
}

/** A stretch of a modulation curve: it's pasted on another parameter or in another clip. */
export interface CopiedEnvelope {
  readonly kind: 'envelope';
  /** Beats relative to the start of the stretch. */
  readonly points: readonly EnvelopePoint[];
  readonly span: Beats;
  /** Where the stretch started. */
  readonly origin: Beats;
  /** The kind of values of the curve: pasted on another kind it's rescaled. */
  readonly scale: ModScale;
}

export type ClipboardContent = CopiedClips | CopiedNotes | CopiedDevices | CopiedEnvelope;

/** The clipboard's content, shared by timeline and piano roll. */
export class Clipboard {
  content: ClipboardContent | null = null;

  get clips(): CopiedClips | null {
    return this.content?.kind === 'clips' ? this.content : null;
  }

  get notes(): CopiedNotes | null {
    return this.content?.kind === 'notes' ? this.content : null;
  }

  get devices(): CopiedDevices | null {
    return this.content?.kind === 'devices' ? this.content : null;
  }

  get envelope(): CopiedEnvelope | null {
    return this.content?.kind === 'envelope' ? this.content : null;
  }
}

// ------------------------------------------------------------------ clip

/** The track positions are those of the timeline's rows (the visible tracks). */
export function copyClips(project: Project, refs: readonly PlacementRef[]): CopiedClips | null {
  const found = refs.flatMap(r => {
    const pl = findPlacement(project, r);
    const index = project.visibleTracks.findIndex(t => t.id === r.track);
    return pl && index >= 0 ? [{ pl, index }] : [];
  });
  if (!found.length) return null;
  const top = Math.min(...found.map(f => f.index));
  const start = Math.min(...found.map(f => f.pl.start));
  return {
    kind: 'clips',
    items: found.map(({ pl, index }) => ({ trackOffset: index - top, placement: { ...pl, start: pl.start - start } })),
    span: Math.max(...found.map(f => placementEnd(f.pl))) - start,
    sourceTrack: project.visibleTracks[top].id,
  };
}

/** Pastes from beat `at`, with the first copied track on the one at index `firstTrack`.
 *  The clips that would end up on a track that doesn't exist or of another kind are skipped. */
export const pasteClips = (content: CopiedClips, firstTrack: number, at: Beats): Edit =>
  edit('Paste', (project, { ids }) => content.items.reduce((p, { trackOffset, placement }) => {
    const track = p.visibleTracks[firstTrack + trackOffset];
    if (!track?.accepts(placement.clip)) return p;
    const placed: Placement = {
      ...placement, id: ids.next('placement'), clip: placement.clip.withId(ids.next('clip')), start: Math.max(0, at + placement.start),
    };
    return p.updatingTrack(track.id, t => t.placing(placed, ids));
  }, project));

// ------------------------------------------------------------------ note

export function copyNotes(notes: readonly Note[], sel: Selection): CopiedNotes | null {
  const chosen = notes.filter(n => sel.has(n));
  if (!chosen.length) return null;
  const origin = Math.min(...chosen.map(n => n.start));
  return {
    kind: 'notes',
    notes: chosen.map(n => ({ ...n, start: n.start - origin })),
    span: Math.max(...chosen.map(n => n.start + n.duration)) - origin,
    origin,
  };
}

/** The clipboard's notes starting from beat `at`; they stay selected. */
export function pasteNotes(notes: readonly Note[], content: CopiedNotes, at: Beats): NoteChange {
  const pasted = content.notes.map(n => ({ ...n, start: Math.max(0, at) + n.start }));
  return { notes: [...notes, ...pasted], selected: pasted };
}

// ------------------------------------------------------------------ session

/** How long a session clip lasts, if it's put on the timeline. */
const slotLength = (clip: Clip): Beats => (clip.loop.enabled ? clip.loop.end : clip.region.end) - clip.region.start;

/** A slot's clip in the clipboard, like a clip copied from the timeline: it's pasted in another
 *  slot or, at the cursor, on the timeline. */
export const copySlotClip = (project: Project, track: TrackId, slot: number): CopiedClips | null =>
  copySlotClips(project, [{ track, slot }]);

/** The clips of several slots in the clipboard, remembering how they sat in the grid: they're pasted with the
 *  same shape from one slot on. On the timeline the scenes go one after the other. */
export function copySlotClips(project: Project, refs: readonly SlotRef[]): CopiedClips | null {
  const columns = new Map(project.visibleTracks.map((t, i) => [t.id, i]));
  const found = refs.flatMap(({ track, slot }) => {
    const clip = project.track(track)?.slots[slot], column = columns.get(track);
    return clip && column !== undefined ? [{ track, slot, clip, column, length: slotLength(clip) }] : [];
  });
  if (!found.length) return null;
  const left = Math.min(...found.map(f => f.column)), top = Math.min(...found.map(f => f.slot));
  // the start of each scene: after the longest clip of those before
  const rows = [...new Set(found.map(f => f.slot))].sort((a, b) => a - b);
  const starts = new Map<number, Beats>();
  const span = rows.reduce((at, row) => {
    starts.set(row, at);
    return at + Math.max(...found.filter(f => f.slot === row).map(f => f.length));
  }, 0);
  return {
    kind: 'clips', span, sourceTrack: found.find(f => f.column === left)!.track,
    items: found.map(f => ({
      trackOffset: f.column - left, slotOffset: f.slot - top,
      placement: { id: asId('copied'), clip: f.clip, start: starts.get(f.slot)!, length: f.length, offset: 0 },
    })),
  };
}

/** Where each clipboard clip would go if pasted with the grid's shape from the given slot. */
function gridTargets(p: Project, content: CopiedClips, track: TrackId, slot: number) {
  const tracks = p.visibleTracks, first = tracks.findIndex(t => t.id === track);
  return content.items.flatMap(({ trackOffset, slotOffset = 0, placement }) => {
    const t = tracks[first + trackOffset];
    return t?.accepts(placement.clip) ? [{ track: t.id, slot: slot + slotOffset, clip: placement.clip }] : [];
  });
}

/** The clipboard clips that have the shape of a grid (copied from the session). */
const isGrid = (content: CopiedClips) => content.items.length > 1 && content.items.every(i => i.slotOffset !== undefined);

/** The slots a paste will fill. */
export function pasteSlots(p: Project, content: CopiedClips, track: TrackId, slot: number): SlotRef[] {
  if (!isGrid(content)) return [{ track, slot }];
  return gridTargets(p, content, track, slot).map(t => ({ track: t.track, slot: t.slot }));
}

/** Pastes into the slot: several clips copied from the session take back their shape (those that
 *  would end up on a track that doesn't exist or of another kind are skipped, and if needed scenes
 *  are added at the bottom); otherwise, the first clipboard clip the track accepts. Always
 *  looping, like the session clips. If none fits, TypeError. */
export const pasteToSlot = (content: CopiedClips, track: TrackId, slot: number): Edit =>
  edit('Paste', (p, { ids }) => {
    if (isGrid(content)) {
      const targets = gridTargets(p, content, track, slot);
      if (!targets.length) throw new TypeError('the clipboard has no clips for these tracks');
      let next = p;
      while (next.scenes.length <= Math.max(...targets.map(t => t.slot))) next = next.addingScene({ id: ids.next('scene'), name: String(next.scenes.length + 1) });
      return targets.reduce((q, t) => q.updatingTrack(t.track, x => x.withSlot(t.slot, t.clip.withId(ids.next('clip')).withLoop({ ...t.clip.loop, enabled: true }))), next);
    }
    const t = p.track(track);
    const clip = content.items.map(i => i.placement.clip).find(c => t?.accepts(c));
    if (!clip) throw new TypeError('the clipboard has no clips for this track');
    return p.updatingTrack(track, x => x.withSlot(slot, clip.withId(ids.next('clip')).withLoop({ ...clip.loop, enabled: true })));
  });
