import type { TrackId } from '../../core/id';
import type { Beats, TimeSignature } from '../../core/music-time';
import { placementEnd, type Placement } from '../../model/arrangement';
import type { Project } from '../../model/project';

export const TRACK_HEIGHT = 72;
export const MIN_PX_PER_BEAT = 1.5;
export const MAX_PX_PER_BEAT = 600;

/** Correspondence between musical positions and timeline pixels (zoom and scrolling).
 *  Immutable: zoom and scroll produce a new geometry. */
export class TimelineGeometry {
  constructor(
    readonly pxPerBeat = 24,
    /** Beat at the left edge. */
    readonly scrollBeat: Beats = 0,
    /** Pixels hidden above (vertical scrolling of the tracks). */
    readonly scrollY = 0,
    readonly trackHeight = TRACK_HEIGHT,
  ) {}

  beatToX(b: Beats): number {
    return (b - this.scrollBeat) * this.pxPerBeat;
  }

  xToBeat(x: number): Beats {
    return this.scrollBeat + x / this.pxPerBeat;
  }

  trackTop(index: number): number {
    return index * this.trackHeight - this.scrollY;
  }

  /** Index of the track under `y` (it can be outside the list). */
  trackIndexAt(y: number): number {
    return Math.floor((y + this.scrollY) / this.trackHeight);
  }

  /** Zoom keeping the beat under `anchorX` still. */
  zoomed(pxPerBeat: number, anchorX: number): TimelineGeometry {
    const px = Math.max(MIN_PX_PER_BEAT, Math.min(MAX_PX_PER_BEAT, pxPerBeat));
    const anchor = this.xToBeat(anchorX);
    return new TimelineGeometry(px, Math.max(0, anchor - anchorX / px), this.scrollY, this.trackHeight);
  }

  scrolled(scrollBeat: Beats, scrollY: number): TimelineGeometry {
    return new TimelineGeometry(this.pxPerBeat, Math.max(0, scrollBeat), Math.max(0, scrollY), this.trackHeight);
  }
}

/** Grid step for the current zoom: the finest subdivision at least `minPx` wide. */
export function gridStep(pxPerBeat: number, signature: TimeSignature, minPx = 14): Beats {
  const bar = signature.beatsPerBar;
  const steps = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, bar, 2 * bar, 4 * bar, 8 * bar, 16 * bar, 32 * bar];
  return steps.find(s => s * pxPerBeat >= minPx) ?? steps[steps.length - 1];
}

export const snapTo = (b: Beats, step: Beats): Beats => Math.round(b / step) * step;

/** The coloured header of a clip (with the name), in pixels. */
export const CLIP_HEADER = 14;

/** A clip's zones: the body moves it, the edges resize it, the handles in the top
 *  corners (audio clips only) change the fades. */
export type ClipZone = 'body' | 'start' | 'end' | 'fadeIn' | 'fadeOut';

/** What's under the pointer in the tracks area. */
export type Hit =
  | { readonly kind: 'clip'; readonly zone: ClipZone; readonly trackIndex: number; readonly track: TrackId; readonly placement: Placement; readonly beat: Beats }
  | { readonly kind: 'lane'; readonly trackIndex: number; readonly track: TrackId; readonly beat: Beats }
  | { readonly kind: 'empty'; readonly beat: Beats };

/** Width of a clip's edge zone, which resizes it. */
const EDGE_PX = 6;
/** Side of the fade handles; below this width (in pixels) the clip doesn't have them. */
export const FADE_HANDLE_PX = 6;
const FADE_MIN_CLIP_PX = 28;

/** Where (x) the fade-in and fade-out handles of a clip are: at the end
 *  of the fade, inside the clip; null if the clip has none (it isn't audio or it's too narrow). */
export function fadeHandles(geo: TimelineGeometry, pl: Placement): { in: number; out: number } | null {
  const x0 = geo.beatToX(pl.start), x1 = geo.beatToX(placementEnd(pl)), h = FADE_HANDLE_PX / 2;
  if (pl.clip.kind !== 'audio' || x1 - x0 < FADE_MIN_CLIP_PX) return null;
  const inside = (x: number) => Math.max(x0 + h, Math.min(x1 - h, x));
  return { in: inside(geo.beatToX(pl.start + (pl.fadeIn ?? 0))), out: inside(geo.beatToX(placementEnd(pl) - (pl.fadeOut ?? 0))) };
}

/** The timeline's rows are the visible tracks (`Project.visibleTracks`). */
export function hitTest(project: Project, geo: TimelineGeometry, x: number, y: number): Hit {
  const beat = geo.xToBeat(x);
  const index = geo.trackIndexAt(y);
  const track = project.visibleTracks[index];
  if (!track) return { kind: 'empty', beat };
  const placement = track.arrangement.find(p => p.start <= beat && placementEnd(p) > beat);
  if (!placement) return { kind: 'lane', trackIndex: index, track: track.id, beat };
  const x0 = geo.beatToX(placement.start), x1 = geo.beatToX(placementEnd(placement));
  const handles = y - geo.trackTop(index) < CLIP_HEADER + 2 ? fadeHandles(geo, placement) : null;
  const near = (hx: number) => Math.abs(x - hx) <= FADE_HANDLE_PX / 2 + 2;
  const edge = Math.min(EDGE_PX, (x1 - x0) / 4);
  let zone: ClipZone = 'body';
  if (handles && near(handles.in)) zone = 'fadeIn';
  else if (handles && near(handles.out)) zone = 'fadeOut';
  else if (x - x0 < edge) zone = 'start';
  else if (x1 - x < edge) zone = 'end';
  return { kind: 'clip', zone, trackIndex: index, track: track.id, placement, beat };
}

/** Clips whose rectangles touch the box [b0, b1] × tracks [i0, i1]. */
export function placementsInBox(project: Project, b0: Beats, b1: Beats, i0: number, i1: number) {
  const [lo, hi] = [Math.min(b0, b1), Math.max(b0, b1)];
  const [t0, t1] = [Math.max(0, Math.min(i0, i1)), Math.max(i0, i1)];
  return project.visibleTracks.slice(t0, t1 + 1).flatMap(t =>
    t.arrangement.filter(p => p.start < hi && placementEnd(p) > lo).map(p => ({ track: t.id, id: p.id })));
}
