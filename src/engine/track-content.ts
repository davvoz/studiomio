/* What a track plays in a scheduling window, on the continuous clock: the stretches
 * of its timeline where it follows it, those of the session clips launched elsewhere. The
 * players (audio, MIDI) play stretches, without knowing where they come from. */
import type { Beats } from '../core/music-time';
import { placementEnd, type Placement } from '../model/arrangement';
import type { Clip } from '../model/clip';
import type { Track } from '../model/track';
import type { ScheduleWindow } from './scheduler';
import { clipSegmentsBetween, type Segment } from './segments';
import { slotClip, type Program } from './session';

/** A continuous stretch of a clip on the clock: from `start` to `end` it plays the clip's
 *  content starting from beat `contentStart`. */
export interface Piece<C extends Clip = Clip> {
  readonly clip: C;
  readonly start: number;
  readonly end: number;
  readonly contentStart: Beats;
  /** The placed clip's fades, if it has any (only on the timeline). */
  readonly fades?: PieceFades;
}

/** The fades of a placed clip on the clock: the clip goes from `start` to `end`, rises for
 *  `fadeIn` beats and falls in the last `fadeOut`. */
export interface PieceFades {
  readonly start: number;
  readonly end: number;
  readonly fadeIn: Beats;
  readonly fadeOut: Beats;
}

/** The fades' gain (0..1) at point `at` of the clock. */
export function fadeGainAt(f: PieceFades, at: number): number {
  const up = f.fadeIn > 0 ? (at - f.start) / f.fadeIn : 1, down = f.fadeOut > 0 ? (f.end - at) / f.fadeOut : 1;
  return Math.max(0, Math.min(1, up, down));
}

const EPS = 1e-9;

/** The stretches of `track` touching window `w`. `arrangement` gives (and remembers) the stretches of
 *  a placed clip. A stretch already running starts where its part begins: at the start of the
 *  run for the timeline, at the last start from the top for the session (at the timeline's loop rounds
 *  the session clips continue without restarting). */
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
