/* Moving around the timeline, without the DOM: following the playhead, how far it scrolls, the
 * scrollbar, the wheel, Live's Z / W / X zooms and their history. */
import type { PlacementId } from '../../core/id';
import type { Beats } from '../../core/music-time';
import { placementEnd } from '../../model/arrangement';
import type { TimeRange } from '../../model/note-edits';
import type { Project } from '../../model/project';
import type { TimelineGeometry } from './geometry';

/** How many views X can go back through. */
export const ZOOM_HISTORY = 32;

/** The view bringing `beat` into view (the playhead leaving the screen): null if it's already
 *  between the left edge and 92% of `width`. */
export function revealing(g: TimelineGeometry, beat: Beats, width: number): TimelineGeometry | null {
  const x = g.beatToX(beat);
  return x < 0 || x > width * 0.92 ? g.scrolled(beat - (width * 0.1) / g.pxPerBeat, g.scrollY) : null;
}

/** The view at beat `beat` (left edge) and `y` pixels scrolled, without going past the last track
 *  (`height`: the lanes' height). */
export function scrolledWithin(p: Project, g: TimelineGeometry, beat: Beats, y: number, height: number): TimelineGeometry {
  const maxY = Math.max(0, p.visibleTracks.length * g.trackHeight - height + 40);
  return g.scrolled(beat, Math.min(maxY, y));
}

/** The scrollbar under the timeline: it scrolls up to bringing the end of the piece (or of the loop,
 *  or the playhead at `position`) to the left edge. */
export function scrollbarRange(p: Project, g: TimelineGeometry, width: number, position: Beats): { total: number; start: number; visible: number } {
  const visible = width / g.pxPerBeat;
  const content = Math.max(p.arrangementEnd, p.loop.end, position);
  return { total: Math.max(content, g.scrollBeat) + visible, start: g.scrollBeat, visible };
}

/** W: the whole piece, up to the end of the last clip (or of the loop), at least four bars. */
export const fitRange = (p: Project): TimeRange => ({ start: 0, end: Math.max(p.arrangementEnd, p.loop.end, 4 * p.signature.beatsPerBar) });

/** Z: the time range drawn in the clips, otherwise the span of the selected clips (null: nothing). */
export function selectionSpan(p: Project, range: TimeRange | null, ids: ReadonlySet<PlacementId>): TimeRange | null {
  if (range) return range;
  const chosen = p.tracks.flatMap(t => t.arrangement.filter(pl => ids.has(pl.id)));
  if (!chosen.length) return null;
  return { start: Math.min(...chosen.map(pl => pl.start)), end: Math.max(...chosen.map(placementEnd)) };
}

/** A wheel turn, as the view reads it. */
export interface Wheel {
  readonly deltaX: number;
  readonly deltaY: number;
  /** Ctrl (or ⌘): zoom. */
  readonly zoom: boolean;
  readonly shift: boolean;
  /** Where the pointer is, from the lanes' left edge (the zoom's anchor). */
  readonly x: number;
}

/** What a wheel turn does: zooms around the pointer, or scrolls (`horizontal`: it moves in time,
 *  which suspends Follow while playing). Shift scrolls horizontally: Chromium on Windows already
 *  delivers it as deltaX (with deltaY at 0). */
export type WheelMove =
  | { readonly kind: 'zoom'; readonly geometry: TimelineGeometry }
  | { readonly kind: 'scroll'; readonly beat: Beats; readonly y: number; readonly horizontal: boolean };

export function wheelMove(g: TimelineGeometry, w: Wheel): WheelMove {
  if (w.zoom) return { kind: 'zoom', geometry: g.zoomed(g.pxPerBeat * Math.exp(-w.deltaY * 0.0025), Math.max(0, w.x)) };
  const dx = w.shift ? w.deltaX || w.deltaY : w.deltaX, dy = w.shift ? 0 : w.deltaY;
  return { kind: 'scroll', beat: g.scrollBeat + dx / g.pxPerBeat, y: g.scrollY + dy, horizontal: !!dx };
}

/** The views before each Z or W, for X (zoom back), as in Live. */
export class ZoomHistory {
  private readonly views: TimelineGeometry[] = [];

  push(g: TimelineGeometry): void {
    this.views.push(g);
    if (this.views.length > ZOOM_HISTORY) this.views.shift();
  }

  pop(): TimelineGeometry | undefined {
    return this.views.pop();
  }
}
