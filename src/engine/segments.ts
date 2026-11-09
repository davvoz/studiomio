import type { Beats } from '../core/music-time';
import type { Placement } from '../model/arrangement';
import type { Clip } from '../model/clip';

/** A continuous stretch of a clip on the timeline: from `start` to `end` it plays the clip's
 *  content starting from beat `contentStart`, without jumps. */
export interface Segment {
  readonly start: Beats;
  readonly end: Beats;
  readonly contentStart: Beats;
}

const EPS = 1e-9;

/** Breaks a placed clip into its continuous stretches: one if the clip isn't looping,
 *  one for each round (plus the possible attack before the loop) if it is. */
export function placementSegments(p: Placement): Segment[] {
  const { clip } = p;
  const out: Segment[] = [];
  const endElapsed = p.offset + p.length;
  let elapsed = p.offset;
  while (endElapsed - elapsed > EPS) {
    const c = clip.contentBeatAt(elapsed);
    if (c === null) break;
    // up to the next jump: the end of the loop or the end of the region
    const limit = clip.loop.enabled ? clip.loop.end : clip.region.end;
    const len = Math.min(limit - c, endElapsed - elapsed);
    if (len <= EPS) break;
    const start = p.start + (elapsed - p.offset);
    out.push({ start, end: start + len, contentStart: c });
    elapsed += len;
  }
  return out;
}

/** Stretch of `s` to start in a scheduling window, or null.
 *  `runStart`/`runEnd` bound the transport's continuous run (from play or from the start
 *  of the loop round to the end of the loop): a stretch already running at the start of the run
 *  starts from there, and nothing plays beyond the end of the run. */
export function segmentToStart(
  s: Segment, window: { readonly from: Beats; readonly to: Beats; readonly runStart: Beats; readonly runEnd: Beats },
): Segment | null {
  const start = Math.max(s.start, window.runStart);
  const end = Math.min(s.end, window.runEnd);
  if (start < window.from - EPS || start >= window.to - EPS || end - start <= EPS) return null;
  return { start, end, contentStart: s.contentStart + (start - s.start) };
}

/** The stretches of a clip launched in the session: it plays from `origin` (where its start starts)
 *  and, if it's looping, repeats endlessly. Returns only the stretches touching [lo, hi), so
 *  a clip running for hours costs as much as one just started. */
export function clipSegmentsBetween(clip: Clip, origin: number, lo: number, hi: number): Segment[] {
  const { region, loop } = clip;
  const out: Segment[] = [];
  // the first stretch goes from the start of the clip to the end of the loop (or of the clip); then the rounds
  const firstLen = (loop.enabled ? loop.end : region.end) - region.start;
  if (!loop.enabled) {
    if (origin < hi && origin + firstLen > lo) out.push({ start: origin, end: origin + firstLen, contentStart: region.start });
    return out;
  }
  const loopLen = loop.end - loop.start;
  if (origin + firstLen > lo && origin < hi) out.push({ start: origin, end: origin + firstLen, contentStart: region.start });
  let k = Math.max(0, Math.floor((lo - origin - firstLen) / loopLen));
  for (let start = origin + firstLen + k * loopLen; start < hi; k++, start += loopLen) {
    if (start + loopLen > lo) out.push({ start, end: start + loopLen, contentStart: loop.start });
  }
  return out;
}
