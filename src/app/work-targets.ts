/* Where the app's actions go when nothing says it: a browser item loaded with a double click, audio
 * files imported from the menu, the clip "Show automation" draws in. */
import type { BrowserItem, LoadTarget } from '../browser/item';
import type { ClipId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import type { ChainOwner, Project } from '../model/project';
import { findClip, placementRef, slotRef, type ClipRef } from '../store/clip-ref';
import type { SlotRef } from '../store/session-edits';

/** Where the user is working: the chain open at the bottom, the session's chosen slot (null in
 *  the timeline), the chosen track, the cursor. */
export interface WorkPlace {
  readonly chain: ChainOwner | null;
  readonly session: { readonly slot: SlotRef | null } | null;
  readonly track: TrackId | null;
  readonly cursor: Beats;
}

/** Where an item loaded with a double click goes: a device in the chain open at the bottom, a
 *  sample in the chosen session slot (or the chosen track's first) or at the cursor of the chosen
 *  track in the timeline. */
export function browserTarget(item: BrowserItem, at: WorkPlace): LoadTarget {
  const audio = item.payload?.kind === 'sample' || item.payload?.kind === 'file';
  if (!audio && at.chain) return { kind: 'chain', owner: at.chain };
  if (at.session && audio) return { kind: 'slot', track: at.session.slot?.track ?? at.track, slot: at.session.slot?.slot ?? 0 };
  return { kind: 'lane', track: at.track, beat: at.cursor };
}

/** Where imported audio files go: in the session the chosen slot (or a new track from the first
 *  scene), in the timeline the cursor. */
export type ImportTarget =
  | { readonly kind: 'slots'; readonly track: TrackId | null; readonly slot: number }
  | { readonly kind: 'timeline'; readonly beat: Beats };

export function importTarget(at: Pick<WorkPlace, 'session' | 'cursor'>): ImportTarget {
  if (at.session) return { kind: 'slots', track: at.session.slot?.track ?? null, slot: at.session.slot?.slot ?? 0 };
  return { kind: 'timeline', beat: at.cursor };
}

/** The track's clip "Show automation" draws in: the last one opened, or the one playing, or the
 *  first it has (a slot's, then the timeline's); null if it has none. */
export function automationClip(p: Project, id: TrackId, last: ClipRef | undefined, playing: ClipId | undefined): ClipRef | null {
  const track = p.track(id);
  if (!track) return null;
  if (last && findClip(p, last)) return last;
  if (playing) return slotRef(id, playing);
  const slot = track.slots.find(Boolean);
  if (slot) return slotRef(id, slot.id);
  const placed = track.arrangement[0];
  return placed ? placementRef(id, placed.id) : null;
}
