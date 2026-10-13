import type { TrackId } from '../../core/id';
import type { Beats, TimeSignature } from '../../core/music-time';
import { placementEnd, type Placement } from '../../model/arrangement';
import type { Project } from '../../model/project';

export const TRACK_HEIGHT = 72;
export const MIN_PX_PER_BEAT = 1.5;
export const MAX_PX_PER_BEAT = 600;

/** Corrispondenza tra posizioni musicali e pixel della timeline (zoom e scorrimento).
 *  Immutabile: zoom e scroll producono una nuova geometria. */
export class TimelineGeometry {
  constructor(
    readonly pxPerBeat = 24,
    /** Battito al bordo sinistro. */
    readonly scrollBeat: Beats = 0,
    /** Pixel nascosti sopra (scorrimento verticale delle tracce). */
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

  /** Indice della traccia sotto `y` (può essere fuori dall'elenco). */
  trackIndexAt(y: number): number {
    return Math.floor((y + this.scrollY) / this.trackHeight);
  }

  /** Zoom tenendo fermo il battito sotto `anchorX`. */
  zoomed(pxPerBeat: number, anchorX: number): TimelineGeometry {
    const px = Math.max(MIN_PX_PER_BEAT, Math.min(MAX_PX_PER_BEAT, pxPerBeat));
    const anchor = this.xToBeat(anchorX);
    return new TimelineGeometry(px, Math.max(0, anchor - anchorX / px), this.scrollY, this.trackHeight);
  }

  scrolled(scrollBeat: Beats, scrollY: number): TimelineGeometry {
    return new TimelineGeometry(this.pxPerBeat, Math.max(0, scrollBeat), Math.max(0, scrollY), this.trackHeight);
  }
}

/** Passo della griglia per lo zoom attuale: la suddivisione più fine larga almeno `minPx`. */
export function gridStep(pxPerBeat: number, signature: TimeSignature, minPx = 14): Beats {
  const bar = signature.beatsPerBar;
  const steps = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, bar, 2 * bar, 4 * bar, 8 * bar, 16 * bar, 32 * bar];
  return steps.find(s => s * pxPerBeat >= minPx) ?? steps[steps.length - 1];
}

export const snapTo = (b: Beats, step: Beats): Beats => Math.round(b / step) * step;

export type ClipZone = 'body' | 'start' | 'end';

/** Cosa c'è sotto il puntatore nell'area delle tracce. */
export type Hit =
  | { readonly kind: 'clip'; readonly zone: ClipZone; readonly trackIndex: number; readonly track: TrackId; readonly placement: Placement; readonly beat: Beats }
  | { readonly kind: 'lane'; readonly trackIndex: number; readonly track: TrackId; readonly beat: Beats }
  | { readonly kind: 'empty'; readonly beat: Beats };

/** Larghezza della zona dei bordi di una clip, che li ridimensiona. */
const EDGE_PX = 6;

export function hitTest(project: Project, geo: TimelineGeometry, x: number, y: number): Hit {
  const beat = geo.xToBeat(x);
  const index = geo.trackIndexAt(y);
  const track = project.tracks[index];
  if (!track) return { kind: 'empty', beat };
  const placement = track.arrangement.find(p => p.start <= beat && placementEnd(p) > beat);
  if (!placement) return { kind: 'lane', trackIndex: index, track: track.id, beat };
  const x0 = geo.beatToX(placement.start), x1 = geo.beatToX(placementEnd(placement));
  const edge = Math.min(EDGE_PX, (x1 - x0) / 4);
  const zone: ClipZone = x - x0 < edge ? 'start' : x1 - x < edge ? 'end' : 'body';
  return { kind: 'clip', zone, trackIndex: index, track: track.id, placement, beat };
}

/** Clip i cui rettangoli toccano il riquadro [b0, b1] × tracce [i0, i1]. */
export function placementsInBox(project: Project, b0: Beats, b1: Beats, i0: number, i1: number) {
  const [lo, hi] = [Math.min(b0, b1), Math.max(b0, b1)];
  const [t0, t1] = [Math.max(0, Math.min(i0, i1)), Math.max(i0, i1)];
  return project.tracks.slice(t0, t1 + 1).flatMap(t =>
    t.arrangement.filter(p => p.start < hi && placementEnd(p) > lo).map(p => ({ track: t.id, id: p.id })));
}
