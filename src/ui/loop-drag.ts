/* Dragging a loop region, as in Ableton: from the edges one end changes
 * keeping the other still, from the body it's moved whole, outside a new one is drawn.
 * It applies to the project's loop (timeline ruler) and to the clip's (editor). */
import type { Beats } from '../core/music-time';

export type LoopPart = 'start' | 'end' | 'body' | 'outside';

export interface BeatRange {
  readonly start: Beats;
  readonly end: Beats;
}

/** Distance in pixels within which an edge is grabbed. */
const EDGE_PX = 6;

/** Which part of the loop is under the pointer. */
export function loopPartAt(loop: BeatRange, x: number, beatToX: (b: Beats) => number): LoopPart {
  const x0 = beatToX(loop.start), x1 = beatToX(loop.end);
  const near0 = Math.abs(x - x0) <= EDGE_PX, near1 = Math.abs(x - x1) <= EDGE_PX;
  // a very narrow loop: the edge on the pointer's side wins
  if (near0 && near1) return x < (x0 + x1) / 2 ? 'start' : 'end';
  if (near0) return 'start';
  if (near1) return 'end';
  return x > x0 && x < x1 ? 'body' : 'outside';
}

export const LOOP_CURSOR: { readonly [P in LoopPart]: string } = {
  start: 'w-resize', end: 'e-resize', body: 'grab', outside: 'ew-resize',
};

const ordered = (a: Beats, b: Beats): BeatRange => ({ start: Math.min(a, b), end: Math.max(a, b) });

/** What the loop becomes dragging part `part` from beat `anchor` to beat `beat`. */
const DRAGS: { readonly [P in LoopPart]: (loop: BeatRange, anchor: Beats, beat: Beats, floor: Beats) => BeatRange } = {
  start: (l, _a, b) => ordered(b, l.end),
  end: (l, _a, b) => ordered(l.start, b),
  body: (l, a, b, floor) => {
    const delta = Math.max(b - a, floor - l.start);
    return { start: l.start + delta, end: l.end + delta };
  },
  outside: (_l, a, b) => ordered(a, b),
};

/** The dragged loop, or null if it would be empty. `floor` is the minimum allowed beat. */
export function dragLoop(part: LoopPart, loop: BeatRange, anchor: Beats, beat: Beats, floor: Beats = -Infinity): BeatRange | null {
  const r = DRAGS[part](loop, anchor, Math.max(floor, beat), floor);
  return r.end - r.start > 1e-6 ? r : null;
}
