/* Trascinamento di una regione di loop, come in Ableton: dai bordi se ne cambia un estremo
 * tenendo fermo l'altro, dal corpo la si sposta intera, fuori se ne disegna una nuova.
 * Vale per il loop del progetto (righello della timeline) e per quello della clip (editor). */
import type { Beats } from '../core/music-time';

export type LoopPart = 'start' | 'end' | 'body' | 'outside';

export interface BeatRange {
  readonly start: Beats;
  readonly end: Beats;
}

/** Distanza in pixel entro cui si afferra un bordo. */
const EDGE_PX = 6;

/** Quale parte del loop c'è sotto il puntatore. */
export function loopPartAt(loop: BeatRange, x: number, beatToX: (b: Beats) => number): LoopPart {
  const x0 = beatToX(loop.start), x1 = beatToX(loop.end);
  const near0 = Math.abs(x - x0) <= EDGE_PX, near1 = Math.abs(x - x1) <= EDGE_PX;
  // un loop molto stretto: vince il bordo dalla parte del puntatore
  if (near0 && near1) return x < (x0 + x1) / 2 ? 'start' : 'end';
  if (near0) return 'start';
  if (near1) return 'end';
  return x > x0 && x < x1 ? 'body' : 'outside';
}

export const LOOP_CURSOR: { readonly [P in LoopPart]: string } = {
  start: 'w-resize', end: 'e-resize', body: 'grab', outside: 'ew-resize',
};

const ordered = (a: Beats, b: Beats): BeatRange => ({ start: Math.min(a, b), end: Math.max(a, b) });

/** Come diventa il loop trascinando la parte `part` dal battito `anchor` al battito `beat`. */
const DRAGS: { readonly [P in LoopPart]: (loop: BeatRange, anchor: Beats, beat: Beats, floor: Beats) => BeatRange } = {
  start: (l, _a, b) => ordered(b, l.end),
  end: (l, _a, b) => ordered(l.start, b),
  body: (l, a, b, floor) => {
    const delta = Math.max(b - a, floor - l.start);
    return { start: l.start + delta, end: l.end + delta };
  },
  outside: (_l, a, b) => ordered(a, b),
};

/** Il loop trascinato, o null se sarebbe vuoto. `floor` è il battito minimo ammesso. */
export function dragLoop(part: LoopPart, loop: BeatRange, anchor: Beats, beat: Beats, floor: Beats = -Infinity): BeatRange | null {
  const r = DRAGS[part](loop, anchor, Math.max(floor, beat), floor);
  return r.end - r.start > 1e-6 ? r : null;
}
