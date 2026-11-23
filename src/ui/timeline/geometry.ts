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

/** Dragging in a ruler's numbers, as in Live: every pixel down zooms in by this much (up: out). */
const RULER_ZOOM_PER_PX = 0.012;

/** How much a vertical drag of `dy` pixels in a ruler zooms (×2 every ~58 px down). */
export const rulerZoom = (dy: number): number => Math.exp(dy * RULER_ZOOM_PER_PX);

/** Margin left on each side when a range is brought into view, in fractions of the range. */
const SHOW_MARGIN = 0.04;

/** The view showing [start, end) across `width` pixels, with a small margin on each side
 *  (Live's Z on the selection and W on the whole piece); the vertical scroll stays. */
export function geometryShowing(g: TimelineGeometry, start: Beats, end: Beats, width: number): TimelineGeometry {
  const span = Math.max(end - start, 1 / 4) * (1 + 2 * SHOW_MARGIN);
  const px = Math.max(MIN_PX_PER_BEAT, Math.min(MAX_PX_PER_BEAT, Math.max(1, width) / span));
  const middle = (start + end) / 2;
  return new TimelineGeometry(px, Math.max(0, middle - width / px / 2), g.scrollY, g.trackHeight);
}

/** A fixed grid the user can choose, as in Live: note values (a beat is a quarter) and bars. */
export interface FixedGrid {
  readonly label: string;
  step(signature: TimeSignature): Beats;
}

export const FIXED_GRIDS: readonly FixedGrid[] = [
  { label: '1/32', step: () => 1 / 8 },
  { label: '1/16', step: () => 1 / 4 },
  { label: '1/8', step: () => 1 / 2 },
  { label: '1/4', step: () => 1 },
  { label: '1/2', step: () => 2 },
  { label: '1 bar', step: s => s.beatsPerBar },
  { label: '2 bars', step: s => 2 * s.beatsPerBar },
  { label: '4 bars', step: s => 4 * s.beatsPerBar },
  { label: '8 bars', step: s => 8 * s.beatsPerBar },
];

/** The grid chosen by the user, as in Live: adaptive (it follows the zoom) or fixed; with
 *  triplets the steps shorter than a bar last 2/3. */
export interface GridSetting {
  /** Index in FIXED_GRIDS, or null: adaptive. */
  readonly fixed: number | null;
  /** Adaptive only: from −2 (narrowest) to +2 (widest); each step halves or doubles the lines' spacing. */
  readonly density: number;
  readonly triplet: boolean;
}

export const ADAPTIVE_GRID: GridSetting = { fixed: null, density: 0, triplet: false };

export const GRID_DENSITY = { min: -2, max: 2 } as const;

/** Ctrl+1 (`by` −1, narrower) and Ctrl+2 (+1, wider), as in Live: a fixed grid moves to the next
 *  value, an adaptive one changes its density. */
export function nudgeGrid(g: GridSetting, by: -1 | 1): GridSetting {
  if (g.fixed !== null) return { ...g, fixed: Math.max(0, Math.min(FIXED_GRIDS.length - 1, g.fixed + by)) };
  return { ...g, density: Math.max(GRID_DENSITY.min, Math.min(GRID_DENSITY.max, g.density + by)) };
}

/** An adaptive grid's density, as " +1" or " -2" (nothing at 0). */
function densityLabel(density: number): string {
  if (!density) return '';
  const sign = density > 0 ? '+' : '';
  return ` ${sign}${density}`;
}

/** The grid's label: "Adaptive" (with its density) or the fixed value, "T" for triplets. */
export function gridLabel(g: GridSetting): string {
  const name = g.fixed === null ? `Adaptive${densityLabel(g.density)}` : FIXED_GRIDS[g.fixed].label;
  return g.triplet ? `${name} T` : name;
}

/** Grid step (the snap's too): with the adaptive grid the finest subdivision at least `minPx`
 *  wide at this zoom, with a fixed one its value. */
export function gridStep(pxPerBeat: number, signature: TimeSignature, minPx = 14, setting: GridSetting = ADAPTIVE_GRID): Beats {
  const bar = signature.beatsPerBar;
  const triplet = (s: Beats) => (setting.triplet && s < bar ? (s * 2) / 3 : s);
  const fixed = setting.fixed === null ? undefined : FIXED_GRIDS[setting.fixed];
  if (fixed) return triplet(fixed.step(signature));
  const steps = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, bar, 2 * bar, 4 * bar, 8 * bar, 16 * bar, 32 * bar].map(triplet);
  const need = minPx * Math.pow(2, setting.density);
  return steps.find(s => s * pxPerBeat >= need) ?? steps.at(-1)!;
}

/** Lines closer than this aren't drawn (a fixed grid zoomed out would be a grey wall). */
const MIN_LINE_PX = 4;

/** The step at which to draw the grid's lines: the grid's, or a multiple of it if the lines would
 *  be too close (the snap stays on the grid's step). */
export function drawnGridStep(step: Beats, pxPerBeat: number): Beats {
  if (!(step > 0 && pxPerBeat > 0)) return step;
  let s = step;
  while (s * pxPerBeat < MIN_LINE_PX) s *= 2;
  return s;
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
