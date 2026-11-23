/* Where things dropped on the session go, decided on positions the view has already measured
 * (no DOM here): a track or a bus moved among the columns, a scene among the rows, clips moved
 * across slots, a browser item dropped on the grid. */
import type { BrowserItem, LoadTarget } from '../../browser/item';
import type { TrackId } from '../../core/id';
import { MASTER, type Project } from '../../model/project';
import { GroupTrack, type Track } from '../../model/track';
import type { TrackDrop } from '../../store/edits';
import type { SlotRef } from '../../store/session-edits';

/** An element's extent along the axis of the drag (left–right for columns, top–bottom for rows). */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** Where a drop goes, and where along the axis the line showing it is drawn. */
export interface Spot<T> {
  readonly drop: T;
  readonly at: number;
}

const middle = (s: Span): number => s.start + (s.end - s.start) / 2;

/** Where track `id` dropped at `x` goes: in the left half of a column before it, in the right
 *  half after it (at the top of the tracks, if it's an open group); after the last, or over the
 *  buses and the master (`pastTracks`), at the end. `heads`: the visible tracks' headers. Null
 *  over itself or over one of its own tracks. */
export function trackSpot(p: Project, id: TrackId, heads: readonly Span[], x: number, pastTracks: boolean): Spot<TrackDrop> | null {
  const tracks = p.visibleTracks;
  const i = heads.findIndex(h => x < h.end + 2);
  if (pastTracks || i < 0) return { drop: { end: true }, at: heads.at(-1)!.end + 1 };
  const t = tracks[i], h = heads[i];
  if (t.id === id || p.isInGroup(t.id, id)) return null;
  if (x < middle(h)) return { drop: { before: t.id }, at: h.start - 1 };
  return { drop: t instanceof GroupTrack && !t.folded ? { first: t.id } : { after: t.id }, at: h.end + 1 };
}

/** Where the item at index `from` of a list (the buses, the scenes) dropped at `pos` goes: before
 *  the item in whose first half it is, after the last otherwise. Null where it already is. */
export function indexSpot(from: number, items: readonly Span[], pos: number): Spot<number> | null {
  let at = items.findIndex(s => pos < middle(s));
  if (at < 0) at = items.length;
  if (at === from || at === from + 1) return null;
  return { drop: at > from ? at - 1 : at, at: at < items.length ? items[at].start - 1 : items.at(-1)!.end + 1 };
}

/** Columns and rows from slot `from` to slot `to` (`tracks`: the visible ones, in order). */
export function slotOffset(tracks: readonly Track[], from: SlotRef, to: SlotRef): { readonly columns: number; readonly rows: number } {
  const column = (t: TrackId) => tracks.findIndex(x => x.id === t);
  return { columns: column(to.track) - column(from.track), rows: to.slot - from.slot };
}

/** Where the clips `refs` end up moved by `columns` and `rows` (`tracks`: the columns before the move). */
export function movedRefs(tracks: readonly Track[], refs: readonly SlotRef[], columns: number, rows: number): SlotRef[] {
  return refs.map(r => ({ track: tracks[tracks.findIndex(x => x.id === r.track) + columns].id, slot: r.slot + rows }));
}

/** What's under a browser item dropped on the grid: a slot, the master's head, a column's head or strip. */
export interface DropHit {
  readonly slot: SlotRef | null;
  readonly master: boolean;
  readonly track: TrackId | null;
}

/** Where a browser item dropped on the grid goes: the slot underneath; on a column's head (or on
 *  the mixer) its track (a sample in the first free slot, a device on its chain); on the master
 *  its chain; elsewhere a new track. */
export function browserDropTarget(p: Project, item: BrowserItem, hit: DropHit): LoadTarget {
  if (hit.slot) return { kind: 'slot', ...hit.slot };
  if (hit.master) return { kind: 'chain', owner: MASTER };
  const track = hit.track ? p.track(hit.track) : undefined;
  const audio = item.payload?.kind === 'sample' || item.payload?.kind === 'file';
  if (!track) return audio ? { kind: 'slot', track: null, slot: 0 } : { kind: 'lane', track: null, beat: 0 };
  if (!audio) return { kind: 'chain', owner: track.id };
  return { kind: 'slot', track: track.id, slot: Math.max(track.slots.findIndex(c => !c), 0) };
}
