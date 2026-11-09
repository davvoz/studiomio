/* Edits on several placed clips together (the timeline selection). */
import type { IdFactory, PlacementId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { between, keepBetween, placementEnd, type Placement } from '../model/arrangement';
import { AudioClip } from '../model/audio-clip';
import { paletteColor } from '../model/colors';
import type { TimeRange } from '../model/note-edits';
import type { Project } from '../model/project';
import type { SampleRef } from '../model/sample';
import { AudioTrack, GroupTrack } from '../model/track';
import { resizePlacement } from './edits';
import { edit, type Edit } from './project-store';

/** A placed clip, indicated by its track. */
export interface PlacementRef {
  readonly track: TrackId;
  readonly id: PlacementId;
}

export interface Relocation extends PlacementRef {
  readonly to: TrackId;
  readonly start: Beats;
  /** True to leave the original where it is and place a copy. */
  readonly copy: boolean;
}

/** The new edges of a placed clip. */
export interface ResizePlan extends PlacementRef {
  readonly start: Beats;
  readonly end: Beats;
}

export function findPlacement(p: Project, ref: PlacementRef): Placement | undefined {
  return p.track(ref.track)?.placement(ref.id);
}

/** Moves or copies several clips at once. First all those to move are removed, then
 *  they're all placed: so a clip doesn't cut another one of the selection that's about to move. */
export const relocate = (label: string, moves: readonly Relocation[]): Edit =>
  edit(label, (project, { ids }) => {
    const found = moves.map(m => {
      const pl = findPlacement(project, m);
      if (!pl) throw new Error(`clip ${m.id} not found`);
      return { m, pl };
    });
    let p = project;
    for (const { m } of found) if (!m.copy) p = p.updatingTrack(m.track, t => t.removingPlacement(m.id));
    for (const { m, pl } of found) {
      const placed: Placement = m.copy
        ? { ...pl, id: ids.next('placement'), clip: pl.clip.withId(ids.next('clip')), start: Math.max(0, m.start) }
        : { ...pl, start: Math.max(0, m.start) };
      p = p.updatingTrack(m.to, t => t.placing(placed, ids));
    }
    return p;
  });

/** Resizes several clips at once (a single undo step). */
export const resizeMany = (plans: readonly ResizePlan[]): Edit =>
  edit('Resize clip', (p, ctx) =>
    plans.reduce((acc, r) => (findPlacement(acc, r) ? resizePlacement(r.track, r.id, r).apply(acc, ctx) : acc), p));

export const deleteMany =(refs: readonly PlacementRef[]): Edit =>
  edit('Delete clip', p =>
    refs.reduce((acc, r) => (findPlacement(acc, r) ? acc.updatingTrack(r.track, t => t.removingPlacement(r.id)) : acc), p));

/** Copies the selection right after its end, like Ctrl+D in Live. */
export const duplicateMany = (refs: readonly PlacementRef[]): Edit =>
  edit('Duplicate', (p, ctx) => {
    const pls = refs.map(r => ({ r, pl: findPlacement(p, r) })).filter(x => x.pl) as { r: PlacementRef; pl: Placement }[];
    if (!pls.length) return p;
    const span = Math.max(...pls.map(x => placementEnd(x.pl))) - Math.min(...pls.map(x => x.pl.start));
    return relocate('Duplicate', pls.map(({ r, pl }) => ({ ...r, to: r.track, start: pl.start + span, copy: true }))).apply(p, ctx);
  });

/** Copies the stretch of the loop region, on all the tracks, right after the loop (the copy takes
 *  the place of what was there, gaps included) and moves the loop onto the copy: repeating it lengthens
 *  the piece one round at a time, like Ctrl+D on the loop in Live. */
export const duplicateLoopRegion = (): Edit =>
  edit('Duplicate loop', (project, { ids }) => {
    const { start, end } = project.loop, len = end - start;
    const p = project.tracks.reduce((acc, track) => {
      if (!between(track.arrangement, start, end + len).length) return acc;
      const pieces = between(track.arrangement, start, end).flatMap(pl => keepBetween(pl, start, end, pl.id) ?? []);
      return acc.updatingTrack(track.id, t => pieces.reduce(
        (tt, pl) => tt.placing({ ...pl, id: ids.next('placement'), clip: pl.clip.withId(ids.next('clip')), start: pl.start + len }, ids),
        t.clearing(end, end + len, ids),
      ));
    }, project);
    return p.withLoop({ start: end, end: end + len });
  });

/** Splits at point `at` the clips of the selection crossing it. */
export const splitMany = (refs: readonly PlacementRef[], at: Beats): Edit =>
  edit('Split', (p, { ids }) => refs.reduce((acc, r) => {
    const pl = findPlacement(acc, r);
    return pl && pl.start < at && placementEnd(pl) > at ? acc.updatingTrack(r.track, t => t.splitting(r.id, at, ids)) : acc;
  }, p));

/** Splits at the edges of [from, to) the clips of the selection crossing them: the stretch inside
 *  becomes a clip of its own. First the end (the left part keeps the id), then the start. */
export const splitRange = (refs: readonly PlacementRef[], from: Beats, to: Beats): Edit =>
  edit('Split', (p, ctx) => splitMany(refs, from).apply(splitMany(refs, to).apply(p, ctx), ctx));

/** As in Live, acting on a time selection splits the clips at its edges: the split
 *  project and the pieces inside the stretch, one per selected clip. */
export function cutOutRange(project: Project, ids: IdFactory, refs: readonly PlacementRef[], range: TimeRange): { project: Project; pieces: PlacementRef[] } {
  const next = splitRange(refs, range.start, range.end).apply(project, { ids });
  const pieces = refs.flatMap(r => {
    const pl = findPlacement(project, r);
    if (!pl) return [];
    const start = Math.max(pl.start, range.start);
    const piece = next.track(r.track)?.arrangement.find(x => Math.abs(x.start - start) < 1e-9 && x.start < range.end);
    return piece ? [{ track: r.track, id: piece.id }] : [];
  });
  return { project: next, pieces };
}

/** Adds a sample (if it isn't already in the project) and places it: on the indicated track if it's audio,
 *  otherwise on a new one. */
export const importSample = (sample: SampleRef, target: TrackId | null, start: Beats): Edit =>
  edit('Import audio', (p, { ids }) => {
    let next = p.sample(sample.id) ? p : p.addingSample(sample);
    let trackId = target && next.track(target)?.kind === 'audio' ? target : null;
    if (!trackId) {
      const t = AudioTrack.empty(ids.next('track'), sample.name, paletteColor(next.tracks.length), next.scenes.length);
      // on a group the new track goes at the end of the group
      next = target && next.track(target) instanceof GroupTrack ? next.addingTrack(t.withGroup(target), next.blockEnd(target)) : next.addingTrack(t);
      trackId = t.id;
    }
    const color = next.track(trackId)!.color;
    const clip = AudioClip.fromSample(ids.next('clip'), sample, color);
    const placement: Placement = { id: ids.next('placement'), clip, start: Math.max(0, start), length: clip.region.end - clip.region.start, offset: 0 };
    return next.updatingTrack(trackId, t => t.placing(placement, ids));
  });

/** Placed clips present in `next` but not in `prev` (to select what was just created). */
export function addedPlacements(prev: Project, next: Project): PlacementRef[] {
  const old = new Set(prev.tracks.flatMap(t => t.arrangement.map(p => p.id)));
  return next.tracks.flatMap(t => t.arrangement.filter(p => !old.has(p.id)).map(p => ({ track: t.id, id: p.id })));
}
