import type { IdFactory, PlacementId } from '../core/id';
import type { Beats } from '../core/music-time';
import type { Clip } from './clip';

/** A clip placed on a track's timeline. */
export interface Placement<C extends Clip = Clip> {
  readonly id: PlacementId;
  readonly clip: C;
  /** Start on the timeline. */
  readonly start: Beats;
  /** Length on the timeline (it can exceed the clip if it's looping). */
  readonly length: Beats;
  /** Clip beats skipped at the start (left edge trimmed). */
  readonly offset: Beats;
  /** Fade-in and fade-out, in beats (audio clips, as in Live). */
  readonly fadeIn?: Beats;
  readonly fadeOut?: Beats;
}

export type Lane<C extends Clip = Clip> = readonly Placement<C>[];

export const placementEnd = (p: Placement): Beats => p.start + p.length;

const EPS = 1e-9;

/** A clip without loop can't last longer than its content: the length is limited. */
function fitToClip<C extends Clip>(p: Placement<C>): Placement<C> {
  if (p.offset < 0) throw new RangeError(`negative offset: ${p.offset}`);
  const length = Math.min(p.length, p.clip.playLength - p.offset);
  if (!(length > EPS)) throw new RangeError(`invalid length: ${p.length}`);
  return fitFades(length === p.length ? p : { ...p, length });
}

/** The fades within the clip's length (the fade-in has priority); the
 *  zero ones disappear. */
function fitFades<C extends Clip>(p: Placement<C>): Placement<C> {
  if (p.fadeIn === undefined && p.fadeOut === undefined) return p;
  const { fadeIn = 0, fadeOut = 0, ...rest } = p;
  const fi = Math.min(Math.max(0, fadeIn), p.length), fo = Math.min(Math.max(0, fadeOut), p.length - fi);
  return { ...rest, ...(fi > EPS ? { fadeIn: fi } : {}), ...(fo > EPS ? { fadeOut: fo } : {}) };
}

/** Part of `p` that remains keeping only [from, to) of the timeline, or null if nothing remains. */
export function keepBetween<C extends Clip>(p: Placement<C>, from: Beats, to: Beats, id: PlacementId): Placement<C> | null {
  const s = Math.max(p.start, from), e = Math.min(placementEnd(p), to);
  if (e - s <= EPS) return null;
  // a trimmed edge loses its fade
  const { fadeIn, fadeOut, ...rest } = p;
  return fitFades({
    ...rest, id, start: s, length: e - s, offset: p.offset + (s - p.start),
    ...(fadeIn && s <= p.start + EPS ? { fadeIn } : {}),
    ...(fadeOut && e >= placementEnd(p) - EPS ? { fadeOut } : {}),
  });
}

/** Places `placement` on the lane. As in Live, the new clip wins: the clips underneath are
 *  shortened, split in two or removed. The result is sorted by start. */
export function place<C extends Clip>(lane: Lane<C>, placement: Placement<C>, ids: IdFactory): Placement<C>[] {
  placement = fitToClip(placement);
  const id = placement.id;
  return [...clear(lane.filter(p => p.id !== id), placement.start, placementEnd(placement), ids), placement]
    .sort((a, b) => a.start - b.start);
}

/** Empties [from, to) of the lane: the straddling clips are shortened or split in two. */
export function clear<C extends Clip>(lane: Lane<C>, from: Beats, to: Beats, ids: IdFactory): Placement<C>[] {
  const out: Placement<C>[] = [];
  for (const p of lane) {
    if (placementEnd(p) <= from + EPS || p.start >= to - EPS) {
      out.push(p);
      continue;
    }
    const left = keepBetween(p, -Infinity, from, p.id);
    // if the clip sticks out on both sides, the right part becomes a new clip
    const right = keepBetween(p, to, Infinity, left ? ids.next('placement') : p.id);
    if (left) out.push(left);
    if (right) out.push(right);
  }
  return out;
}

export function remove<C extends Clip>(lane: Lane<C>, id: PlacementId): Placement<C>[] {
  return lane.filter(p => p.id !== id);
}

/** Changes a placed clip and places it again (moving or lengthening it can cover the neighbours). */
export function update<C extends Clip>(
  lane: Lane<C>, id: PlacementId, fn: (p: Placement<C>) => Placement<C>, ids: IdFactory,
): Placement<C>[] {
  const p = lane.find(x => x.id === id);
  if (!p) throw new Error(`clip ${id} not found on the track`);
  return place(lane, fn(p), ids);
}

/** Splits a placed clip in two at point `at` of the timeline. */
export function split<C extends Clip>(lane: Lane<C>, id: PlacementId, at: Beats, ids: IdFactory): Placement<C>[] {
  const p = lane.find(x => x.id === id);
  if (!p) throw new Error(`clip ${id} not found on the track`);
  const left = keepBetween(p, -Infinity, at, p.id);
  const right = keepBetween(p, at, Infinity, ids.next('placement'));
  if (!left || !right) return [...lane];
  return [...remove(lane, id), left, right].sort((a, b) => a.start - b.start);
}

/** Placed clips overlapping [from, to). */
export function between<C extends Clip>(lane: Lane<C>, from: Beats, to: Beats): Placement<C>[] {
  return lane.filter(p => p.start < to && placementEnd(p) > from);
}

/** End of the lane's last clip (0 if empty). */
export const laneEnd = (lane: Lane): Beats => lane.reduce((m, p) => Math.max(m, placementEnd(p)), 0);
