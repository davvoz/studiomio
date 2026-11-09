/* Prisma's curves, shared by the engine and the panel's drawing: the curve of a stage (of the
 * envelopes and the drawn LFOs) and the LFO shapes. A shape goes from 0 to 1 (unipolar):
 * the matrix makes it bipolar (−1…1) if needed. A drawn LFO is a row of points, from the
 * first (always at the start of the cycle) to the last (always at the end), joined by segments that
 * can be curved. Pure data: they run in the AudioWorklet and in the interface. */
import { clamp01 } from '../../../core/math';

/** At most this many points in a drawn LFO. */
export const LFO_POINTS = 16;
/** Samples of the table the engine puts an LFO's shape in (one cycle). */
export const LFO_TABLE_SIZE = 1024;

export const LFO_SHAPES = ['Sine', 'Triangle', 'Saw ↑', 'Saw ↓', 'Square', 'Drawn', 'S&H', 'Smooth random'] as const;
export const LFO_SHAPE = { sine: 0, triangle: 1, sawUp: 2, sawDown: 3, square: 4, drawn: 5, sampleHold: 6, smoothRandom: 7 } as const;

/** The random shapes have no table: they change at every cycle. */
export const isRandomShape = (shape: number): boolean => shape === LFO_SHAPE.sampleHold || shape === LFO_SHAPE.smoothRandom;

/** A point of a drawn LFO: position in the cycle and value in 0…1; `curve` (−100…100) bends
 *  the segment starting here towards the next point. */
export interface LfoPoint {
  readonly x: number;
  readonly y: number;
  readonly curve: number;
}

/** How far a segment has gone (0…1) after `t` (0…1) of its time: with positive `curve`
 *  it runs at the start and slows down at the end (like an exponential charge or discharge), with
 *  negative the opposite; at 0 it's a straight line. */
export function bend(t: number, curve: number): number {
  if (Math.abs(curve) < 0.5) return t;
  const k = -curve * 0.08;
  return Math.expm1(k * t) / Math.expm1(k);
}

/** The parameters of an LFO's points (`l1Pts`, `l1X3`, `l1Y3`, `l1C3`…). */
export const pointParam = (lfo: number, axis: 'X' | 'Y' | 'C', k: number): string => `l${lfo}${axis}${k}`;
export const pointCountParam = (lfo: number): string => `l${lfo}Pts`;

/** An LFO's points from its parameters: the first at x = 0, the last at x = 1, the others in
 *  order (with equal x they stay in the given order: it's a step). */
export function pointsOf(values: Readonly<Record<string, number>>, lfo: number): LfoPoint[] {
  const n = Math.max(2, Math.min(LFO_POINTS, Math.round(values[pointCountParam(lfo)] ?? 3)));
  const points: LfoPoint[] = [];
  for (let k = 1; k <= n; k++) {
    let x = clamp01(values[pointParam(lfo, 'X', k)] ?? 0.5);
    if (k === 1) x = 0;
    else if (k === n) x = 1;
    points.push({ x, y: clamp01(values[pointParam(lfo, 'Y', k)] ?? 0), curve: values[pointParam(lfo, 'C', k)] ?? 0 });
  }
  const inner = points.slice(1, -1).map((p, i) => ({ p, i })).sort((a, b) => a.p.x - b.p.x || a.i - b.i).map(e => e.p);
  return [points[0], ...inner, points[n - 1]];
}

/** The parameters describing `points` for LFO `lfo`. */
export function pointValues(lfo: number, points: readonly LfoPoint[]): Record<string, number> {
  const out: Record<string, number> = { [pointCountParam(lfo)]: points.length };
  points.forEach((p, i) => {
    out[pointParam(lfo, 'X', i + 1)] = round3(p.x);
    out[pointParam(lfo, 'Y', i + 1)] = round3(p.y);
    out[pointParam(lfo, 'C', i + 1)] = Math.round(p.curve);
  });
  return out;
}

/** The value of a drawn LFO at `phase` (0…1). */
export function drawnValue(points: readonly LfoPoint[], phase: number): number {
  let i = 0;
  while (i < points.length - 2 && points[i + 1].x <= phase) i++;
  const a = points[i], b = points[i + 1], w = b.x - a.x;
  if (w <= 1e-9) return b.y;
  return a.y + (b.y - a.y) * bend(clamp01((phase - a.x) / w), a.curve);
}

/** The value of a fixed shape at `phase` (0…1): they all start from the bottom, like an envelope. */
export function shapeValue(shape: number, phase: number): number {
  switch (shape) {
    case LFO_SHAPE.triangle: return phase < 0.5 ? 2 * phase : 2 - 2 * phase;
    case LFO_SHAPE.sawUp: return phase;
    case LFO_SHAPE.sawDown: return 1 - phase;
    case LFO_SHAPE.square: return phase < 0.5 ? 1 : 0;
    default: return 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
  }
}

/** A fixed shape as points, to start drawing from there. The sine is made of four
 *  curved segments: it resembles it closely. */
export function pointsForShape(shape: number): LfoPoint[] {
  const p = (x: number, y: number, curve = 0): LfoPoint => ({ x, y, curve });
  switch (shape) {
    case LFO_SHAPE.triangle: return [p(0, 0), p(0.5, 1), p(1, 0)];
    case LFO_SHAPE.sawUp: return [p(0, 0), p(1, 1)];
    case LFO_SHAPE.sawDown: return [p(0, 1), p(1, 0)];
    case LFO_SHAPE.square: return [p(0, 1), p(0.5, 1), p(0.5, 0), p(1, 0)];
    case LFO_SHAPE.sine: return [p(0, 0, -45), p(0.25, 0.5, 45), p(0.5, 1, -45), p(0.75, 0.5, 45), p(1, 0)];
    default: return [p(0, 0), p(0.5, 1), p(1, 0)];
  }
}

/** Fills `out` with one cycle of the shape (fixed or drawn). */
export function fillShape(out: Float32Array, shape: number, points: readonly LfoPoint[]): void {
  const n = out.length;
  for (let i = 0; i < n; i++) {
    const phase = i / n;
    out[i] = shape === LFO_SHAPE.drawn ? drawnValue(points, phase) : shapeValue(shape, phase);
  }
}

/** A random number in 0…1 fixed for each integer (S&H: the same cycle gives the same value). */
export function hash01(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 0xffffffff;
}

/** The value of a random shape in cycle `cycle` at `phase`: S&H holds the cycle's value,
 *  the smooth one glides (cosine) towards the next cycle's value. */
export function randomValue(shape: number, cycle: number, phase: number): number {
  const a = hash01(cycle);
  if (shape !== LFO_SHAPE.smoothRandom) return a;
  const t = 0.5 - 0.5 * Math.cos(Math.PI * phase);
  return a + (hash01(cycle + 1) - a) * t;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
