/* Calculations of the timeline gestures: where the dragged or resized clips end up.
 * Pure functions, used both for the preview during the drag and for the final
 * change on release. */
import type { PlacementId } from '../../core/id';
import type { Beats } from '../../core/music-time';
import { placementEnd, type Placement } from '../../model/arrangement';
import type { Project } from '../../model/project';
import type { PlacementRef, Relocation, ResizePlan } from '../../store/selection-edits';
import { findPlacement } from '../../store/selection-edits';
import { snapTo } from './geometry';

/** The selected clips, with their current track (clip ids are unique in the project). */
export function resolveSelection(project: Project, ids: ReadonlySet<PlacementId>): PlacementRef[] {
  return project.tracks.flatMap(t => t.arrangement.filter(p => ids.has(p.id)).map(p => ({ track: t.id, id: p.id })));
}

/** Offset in beats such that the grabbed clip (which started at `start`) ends up on the grid. */
export function snappedDelta(start: Beats, rawDelta: Beats, step: Beats | null): Beats {
  const target = Math.max(0, start + rawDelta);
  return (step ? snapTo(target, step) : target) - start;
}

/** Where the selected clips go moving them by `deltaBeats` and `deltaTracks` rows (the visible
 *  tracks). If a target track doesn't exist or doesn't accept the clip (a group doesn't
 *  accept any), the clips stay on their tracks. */
export function planMove(project: Project, refs: readonly PlacementRef[], deltaBeats: Beats, deltaTracks: number, copy: boolean): Relocation[] {
  const rows = project.visibleTracks;
  const index = new Map(rows.map((t, i) => [t.id, i]));
  const items = refs.map(r => ({ r, pl: findPlacement(project, r)! })).filter(x => x.pl && index.has(x.r.track));
  const fits = (dt: number) => items.every(({ r, pl }) => {
    const target = rows[index.get(r.track)! + dt];
    return target !== undefined && target.accepts(pl.clip);
  });
  const dt = deltaTracks !== 0 && fits(deltaTracks) ? deltaTracks : 0;
  return items.map(({ r, pl }) => ({
    ...r, copy,
    to: rows[index.get(r.track)! + dt].id,
    start: Math.max(0, pl.start + deltaBeats),
  }));
}

/** New edges dragging the left (`start`) or right (`end`) one up to `beat`.
 *  On the left it doesn't go past the start of the content; on the right, if the clip isn't looping,
 *  not past the end of the content. */
export function planResize(pl: Placement, edge: 'start' | 'end', beat: Beats, minLength: Beats): { start: Beats; end: Beats } {
  const end = placementEnd(pl);
  if (edge === 'start') {
    const earliest = Math.max(0, pl.start - pl.offset);
    return { start: Math.min(Math.max(beat, earliest), end - minLength), end };
  }
  const latest = pl.start + pl.clip.playLength - pl.offset;
  return { start: pl.start, end: Math.max(pl.start + minLength, Math.min(beat, latest)) };
}

/** As in Live, dragging the edge of a selected clip moves the same edge of the whole
 *  selection, by the same amount: `beat` is where the grabbed clip's edge goes (`grabbed`),
 *  the others stop each at their own limits. */
export function planResizeMany(
  project: Project, refs: readonly PlacementRef[], grabbed: Placement, edge: 'start' | 'end', beat: Beats, minLength: Beats,
): ResizePlan[] {
  const edgeOf = (pl: Placement) => (edge === 'start' ? pl.start : placementEnd(pl));
  const delta = planResize(grabbed, edge, beat, minLength)[edge] - edgeOf(grabbed);
  return refs.flatMap(r => {
    const pl = findPlacement(project, r);
    return pl ? [{ ...r, ...planResize(pl, edge, edgeOf(pl) + delta, minLength) }] : [];
  });
}
