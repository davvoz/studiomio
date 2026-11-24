/* A curve's points edited as the lane does: a range replaced, cut out, cleared, painted in a step,
 * brought onto another scale, simplified. Pure functions on the points (sorted by beat). */
import type { Beats } from '../../core/music-time';
import { envelopeValueAt, type EnvelopePoint, type ModScale } from '../../model/envelope';

/** Two beats closer than this are the same beat. */
export const EPS = 1e-9;

/** The value right before `beat` (on a step, the left one). */
export function valueBefore(points: readonly EnvelopePoint[], beat: Beats, neutral: number): number {
  if (!points.length) return neutral;
  let i = -1;
  while (i + 1 < points.length && points[i + 1].beat < beat - EPS) i++;
  if (i < 0) return points[0].value;
  const a = points[i], b = points[i + 1];
  if (!b) return a.value;
  return a.value + ((b.value - a.value) * (beat - a.beat)) / (b.beat - a.beat);
}

/** The curve with the points `inner` in place of the range [from, to]: outside it stays as it was (at the edges it
 *  jumps). On an empty curve only they exist: before and after the curve stays flat. */
export function replaceRange(points: readonly EnvelopePoint[], from: Beats, to: Beats, inner: readonly EnvelopePoint[], neutral: number): EnvelopePoint[] {
  if (!points.length) return simplify(inner);
  const before = valueBefore(points, from, neutral);
  const after = points.length ? envelopeValueAt(points, to) : neutral;
  return simplify([
    ...points.filter(p => p.beat < from - EPS),
    { beat: from, value: before }, ...inner, { beat: to, value: after },
    ...points.filter(p => p.beat > to + EPS),
  ]);
}

/** The curve with a shape in place of the range [from, to]. On an empty curve outside the range the
 *  neutral line remains. */
export function placeShape(points: readonly EnvelopePoint[], from: Beats, to: Beats, inner: readonly EnvelopePoint[], neutral: number): EnvelopePoint[] {
  return replaceRange(points.length ? points : [{ beat: 0, value: neutral }, { beat: to, value: neutral }], from, to, inner, neutral);
}

/** A step at value `value` in [from, to]: outside the curve stays as it was (at the edges it jumps). */
export const paintStep = (points: readonly EnvelopePoint[], from: Beats, to: Beats, value: number, neutral: number): EnvelopePoint[] =>
  replaceRange(points.length ? points : [{ beat: from, value: neutral }, { beat: to, value: neutral }], from, to, [{ beat: from, value }, { beat: to, value }], neutral);

/** The range [from, to] of the curve, with the beats relative to `from`. */
export function sliceRange(points: readonly EnvelopePoint[], from: Beats, to: Beats, neutral: number): EnvelopePoint[] {
  if (!points.length) return [];
  const inside = points.filter(p => p.beat > from + EPS && p.beat < to - EPS);
  return simplify([
    { beat: from, value: envelopeValueAt(points, from) }, ...inside, { beat: to, value: valueBefore(points, to, neutral) },
  ].map(p => ({ beat: p.beat - from, value: p.value })));
}

/** In the range [from, to] no modulation. If nothing else remains, the curve disappears. */
export function clearRange(points: readonly EnvelopePoint[], from: Beats, to: Beats, neutral: number): EnvelopePoint[] {
  if (points.every(p => p.beat >= from - EPS && p.beat <= to + EPS)) return [];
  const out = paintStep(points, from, to, neutral, neutral);
  return out.every(p => Math.abs(p.value - neutral) < EPS) ? [] : out;
}

/** A curve's values brought onto another scale: the neutral line stays neutral, the extremes
 *  go onto the extremes. */
export function rescalePoints(points: readonly EnvelopePoint[], from: ModScale, to: ModScale): EnvelopePoint[] {
  if (from === to) return [...points];
  const up = (from.max - from.neutral) || 1, down = (from.neutral - from.min) || 1;
  return points.map(p => {
    const d = p.value - from.neutral;
    return { beat: p.beat, value: to.neutral + (d >= 0 ? (d / up) * (to.max - to.neutral) : (d / down) * (to.neutral - to.min)) };
  });
}

/** Removes the points that don't change the curve: the duplicates, those between two with the same
 *  value, and the first if it has another on the same beat (before the first point the curve is
 *  the first anyway). */
export function simplify(points: readonly EnvelopePoint[]): EnvelopePoint[] {
  const out: EnvelopePoint[] = [];
  for (const p of points) {
    const a = out.at(-1), b = out.at(-2);
    if (a?.beat === p.beat && a.value === p.value) continue;
    if (a && b && a.value === p.value && b.value === p.value) out.pop();
    out.push(p);
  }
  if (out.length > 1 && out[0].beat === out[1].beat) out.shift();
  return out;
}
