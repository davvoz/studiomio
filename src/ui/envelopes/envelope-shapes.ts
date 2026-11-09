/* A modulation's ready-made shapes: a wave written as points in the range [from, to]. A curve
 * makes only straight lines and steps, so the round ones are finely broken. A cycle repeats until it
 * fills the range; the last, if it doesn't fit entirely, is cut. */
import type { Beats } from '../../core/music-time';
import { MOD_SCALES, type EnvelopePoint, type ModScale } from '../../model/envelope';

export type ShapeId = 'sine' | 'triangle' | 'rampUp' | 'rampDown' | 'square' | 'pump' | 'steps' | 'drift';

/** What to put in the range. */
export interface ShapeChoice {
  readonly shape: ShapeId;
  /** Length of a cycle; 0: a single cycle over the whole range. */
  readonly cycle: Beats;
  /** How much of the scale it uses, from 0 to 1. */
  readonly depth: number;
  readonly invert: boolean;
  /** The random shapes: the same seed gives the same values again. */
  readonly seed: number;
}

/** A point of the cycle: where (from 0 to 1) and how much (from −1 to 1). */
type Knot = readonly [phase: number, level: number];

interface Shape {
  readonly id: ShapeId;
  readonly label: string;
  /** How many cycles are seen in the icon. */
  readonly icon: number;
  /** A cycle generator: `random` gives values between −1 and 1, `detail` says how dense the round ones are. */
  cycles(random: () => number, detail: number): () => readonly Knot[];
}

const fixed = (knots: readonly Knot[]) => () => () => knots;
const curve = (level: (phase: number) => number) => (_: unknown, detail: number) => {
  const knots = Array.from({ length: detail + 1 }, (_, i): Knot => [i / detail, level(i / detail)]);
  return () => knots;
};

export const SHAPES: readonly Shape[] = [
  { id: 'sine', label: 'Sine wave', icon: 1, cycles: curve(p => Math.sin(2 * Math.PI * p)) },
  { id: 'triangle', label: 'Triangle', icon: 1, cycles: fixed([[0, 0], [0.25, 1], [0.75, -1], [1, 0]]) },
  { id: 'rampUp', label: 'Ramp up', icon: 1, cycles: fixed([[0, -1], [1, 1]]) },
  { id: 'rampDown', label: 'Ramp down', icon: 1, cycles: fixed([[0, 1], [1, -1]]) },
  { id: 'square', label: 'Square', icon: 1, cycles: fixed([[0, 1], [0.5, 1], [0.5, -1], [1, -1]]) },
  // down at once, then back up quickly: like a sidechained kick
  { id: 'pump', label: 'Pump', icon: 2, cycles: curve(p => 1 - 2 * (1 - p) ** 4) },
  {
    id: 'steps', label: 'Random steps', icon: 5,
    cycles: random => () => { const v = random(); return [[0, v], [1, v]]; },
  },
  {
    id: 'drift', label: 'Smooth random', icon: 5,
    cycles: random => {
      let a = random();
      return () => { const from = a; a = random(); return [[0, from], [1, a]]; };
    },
  },
];

/** A round shape has at most this many points per cycle, and at least this many (if the cycles are many). */
const DETAIL = { max: 32, min: 6, total: 2048 } as const;
/** The transposition has a scale of 4 octaves: at most a shape uses one per side. */
const TRANSPOSE_REACH = 12;
const EPS = 1e-9;

/** Numbers depending only on the seed (mulberry32), between −1 and 1. */
function randomFrom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** Where the shape reaches on the scale. The volume has the neutral at the top: there it uses only the part below,
 *  all of it. */
function reachOf(scale: ModScale, depth: number): { low: number; high: number } {
  const reach = scale === MOD_SCALES.transpose ? TRANSPOSE_REACH : Infinity;
  return {
    low: scale.neutral - Math.min(reach, scale.neutral - scale.min) * depth,
    high: scale.neutral + Math.min(reach, scale.max - scale.neutral) * depth,
  };
}

/** The shape's points in [from, to], in absolute beats. */
export function shapePoints(choice: ShapeChoice, from: Beats, to: Beats, scale: ModScale): EnvelopePoint[] {
  const shape = SHAPES.find(s => s.id === choice.shape)!;
  const length = to - from, cycle = choice.cycle > 0 ? choice.cycle : length;
  const count = Math.ceil(length / cycle - EPS);
  const detail = Math.max(DETAIL.min, Math.min(DETAIL.max, Math.floor(DETAIL.total / count)));
  const { low, high } = reachOf(scale, choice.depth);
  const valueOf = (level: number) => low + (((choice.invert ? -level : level) + 1) / 2) * (high - low);
  const next = shape.cycles(randomFrom(choice.seed), detail);
  const out: EnvelopePoint[] = [];
  for (let i = 0; i < count; i++) {
    for (const [phase, level] of next()) {
      const beat = from + (i + phase) * cycle, value = valueOf(level);
      if (beat <= to + EPS) {
        out.push({ beat: Math.min(beat, to), value });
        continue;
      }
      // the cycle doesn't fit: it's cut at the end of the range, on the line it was drawing
      const last = out[out.length - 1];
      out.push({ beat: to, value: last.value + ((value - last.value) * (to - last.beat)) / (beat - last.beat) });
      return out;
    }
  }
  return out;
}
