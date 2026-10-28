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

/** L'intestazione colorata di una clip (con il nome), in pixel. */
export const CLIP_HEADER = 14;

/** Le zone di una clip: il corpo la sposta, i bordi la ridimensionano, le maniglie negli angoli
 *  in alto (solo le clip audio) cambiano le dissolvenze. */
export type ClipZone = 'body' | 'start' | 'end' | 'fadeIn' | 'fadeOut';

/** Cosa c'è sotto il puntatore nell'area delle tracce. */
export type Hit =
  | { readonly kind: 'clip'; readonly zone: ClipZone; readonly trackIndex: number; readonly track: TrackId; readonly placement: Placement; readonly beat: Beats }
  | { readonly kind: 'lane'; readonly trackIndex: number; readonly track: TrackId; readonly beat: Beats }
  | { readonly kind: 'empty'; readonly beat: Beats };

/** Larghezza della zona dei bordi di una clip, che li ridimensiona. */
const EDGE_PX = 6;
/** Lato delle maniglie delle dissolvenze; sotto questa larghezza (in pixel) la clip non le ha. */
export const FADE_HANDLE_PX = 6;
const FADE_MIN_CLIP_PX = 28;

/** Dove stanno (x) le maniglie delle dissolvenze in entrata e in uscita di una clip: alla fine
 *  della dissolvenza, dentro la clip; null se la clip non ne ha (non è audio o è troppo stretta). */
export function fadeHandles(geo: TimelineGeometry, pl: Placement): { in: number; out: number } | null {
  const x0 = geo.beatToX(pl.start), x1 = geo.beatToX(placementEnd(pl)), h = FADE_HANDLE_PX / 2;
  if (pl.clip.kind !== 'audio' || x1 - x0 < FADE_MIN_CLIP_PX) return null;
  const inside = (x: number) => Math.max(x0 + h, Math.min(x1 - h, x));
  return { in: inside(geo.beatToX(pl.start + (pl.fadeIn ?? 0))), out: inside(geo.beatToX(placementEnd(pl) - (pl.fadeOut ?? 0))) };
}

/** Le righe della timeline sono le tracce che si vedono (`Project.visibleTracks`). */
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
  const zone: ClipZone = handles && near(handles.in) ? 'fadeIn' : handles && near(handles.out) ? 'fadeOut'
    : x - x0 < edge ? 'start' : x1 - x < edge ? 'end' : 'body';
  return { kind: 'clip', zone, trackIndex: index, track: track.id, placement, beat };
}

/** Clip i cui rettangoli toccano il riquadro [b0, b1] × tracce [i0, i1]. */
export function placementsInBox(project: Project, b0: Beats, b1: Beats, i0: number, i1: number) {
  const [lo, hi] = [Math.min(b0, b1), Math.max(b0, b1)];
  const [t0, t1] = [Math.max(0, Math.min(i0, i1)), Math.max(i0, i1)];
  return project.visibleTracks.slice(t0, t1 + 1).flatMap(t =>
    t.arrangement.filter(p => p.start < hi && placementEnd(p) > lo).map(p => ({ track: t.id, id: p.id })));
}
