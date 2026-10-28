/* Cosa suona una traccia in una finestra di programmazione, sull'orologio continuo: i tratti
 * della sua timeline dove la segue, quelli delle clip della session lanciate altrove. I
 * player (audio, MIDI) suonano tratti, senza sapere da dove vengono. */
import type { Beats } from '../core/music-time';
import { placementEnd, type Placement } from '../model/arrangement';
import type { Clip } from '../model/clip';
import type { Track } from '../model/track';
import type { ScheduleWindow } from './scheduler';
import { clipSegmentsBetween, type Segment } from './segments';
import { slotClip, type Program } from './session';

/** Un tratto continuo di una clip sull'orologio: da `start` a `end` suona il contenuto della
 *  clip a partire dal battito `contentStart`. */
export interface Piece<C extends Clip = Clip> {
  readonly clip: C;
  readonly start: number;
  readonly end: number;
  readonly contentStart: Beats;
  /** Le dissolvenze della clip posata, se ne ha (solo sulla timeline). */
  readonly fades?: PieceFades;
}

/** Le dissolvenze di una clip posata sull'orologio: la clip va da `start` a `end`, sale per
 *  `fadeIn` battiti e scende negli ultimi `fadeOut`. */
export interface PieceFades {
  readonly start: number;
  readonly end: number;
  readonly fadeIn: Beats;
  readonly fadeOut: Beats;
}

/** Il guadagno delle dissolvenze (0..1) al punto `at` dell'orologio. */
export function fadeGainAt(f: PieceFades, at: number): number {
  const up = f.fadeIn > 0 ? (at - f.start) / f.fadeIn : 1, down = f.fadeOut > 0 ? (f.end - at) / f.fadeOut : 1;
  return Math.max(0, Math.min(1, up, down));
}

const EPS = 1e-9;

/** I tratti di `track` che toccano la finestra `w`. `arrangement` dà (e ricorda) i tratti di
 *  una clip posata. Un tratto già in corso parte dove la sua parte comincia: all'inizio della
 *  corsa per la timeline, all'ultima partenza da capo per la session (ai giri di loop della
 *  timeline le clip della session continuano senza ripartire). */
export function piecesInWindow<C extends Clip>(
  track: Track<C>, programs: readonly Program[], w: ScheduleWindow, arrangement: (p: Placement<C>) => readonly Segment[],
): Piece<C>[] {
  const from = w.from + w.shift, to = w.to + w.shift;
  const out: Piece<C>[] = [];
  const push = (clip: C, seg: Segment, start: number, end: number, segStart: number, fades?: PieceFades) => {
    if (end - start > EPS) out.push({ clip, start, end, contentStart: seg.contentStart + (start - segStart), ...(fades && { fades }) });
  };
  for (const prog of programs) {
    if (prog.until <= from || prog.from >= to) continue;
    const src = prog.source;
    if (src.kind === 'arrangement') {
      const lo = Math.max(w.from, w.runStart);
      for (const p of track.arrangement) {
        if (p.start >= w.to || placementEnd(p) <= lo) continue;
        const fades = p.fadeIn || p.fadeOut
          ? { start: p.start + w.shift, end: placementEnd(p) + w.shift, fadeIn: p.fadeIn ?? 0, fadeOut: p.fadeOut ?? 0 }
          : undefined;
        for (const seg of arrangement(p)) {
          const start = Math.max(seg.start, w.runStart) + w.shift, end = Math.min(seg.end, w.runEnd) + w.shift;
          push(p.clip, seg, Math.max(start, prog.from), Math.min(end, prog.until), seg.start + w.shift, fades);
        }
      }
    } else {
      const clip = slotClip(track, src.clip) as C | null;
      if (!clip) continue;
      for (const seg of clipSegmentsBetween(clip, src.origin, Math.max(from, prog.from), to)) {
        push(clip, seg, Math.max(seg.start, prog.from, w.fresh), Math.min(seg.end, prog.until), seg.start);
      }
    }
  }
  return out;
}
