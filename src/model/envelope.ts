/* A clip's modulations (Live's clip envelopes): curves drawn in the clip's time
 * that move a track parameter while the clip plays, relative to the value the
 * parameter has (the knob stays where it is: the curve moves it). They loop with the clip and
 * apply both on the timeline and in the session. Here are the data and the pure operations. */
import type { DeviceId } from '../core/id';
import type { Beats } from '../core/music-time';

/** What a curve moves: volume or pan of the track, a parameter of a device of the
 *  track (the instrument, or an effect by id) or the transpose of the audio clip itself. */
export type ModTarget =
  | { readonly kind: 'mixer'; readonly param: 'volume' | 'pan' }
  | { readonly kind: 'device'; readonly device: DeviceId | typeof INSTRUMENT_DEVICE; readonly param: string }
  | { readonly kind: 'clip'; readonly param: 'transpose' };

/** An audio clip's transpose, like Live's "Transposition" curve: semitones added to
 *  the clip's. */
export const CLIP_TRANSPOSE: ModTarget = { kind: 'clip', param: 'transpose' };

/** The "instrument" device in the targets (the effects have their own id). */
export const INSTRUMENT_DEVICE = 'instrument';

export interface EnvelopePoint {
  /** Clip beat (like the notes and the warp). */
  readonly beat: Beats;
  /** In the scale of the target type (see MOD_SCALES). */
  readonly value: number;
}

export interface ClipEnvelope {
  readonly target: ModTarget;
  /** Sorted by beat; two points on the same beat make a step. */
  readonly points: readonly EnvelopePoint[];
}

/** The scale of a target type's values: limits and neutral value (no modulation). */
export interface ModScale {
  readonly min: number;
  readonly max: number;
  readonly neutral: number;
}

/** Volume: how much of the track's volume remains (1 = all, 0 = silence). Pan: offset
 *  (−1 all the way left … +1 all the way right). Parameter: knob offset, in
 *  fractions of its travel (−1 … +1). */
export const MOD_SCALES = {
  volume: { min: 0, max: 1, neutral: 1 },
  pan: { min: -1, max: 1, neutral: 0 },
  param: { min: -1, max: 1, neutral: 0 },
  transpose: { min: -48, max: 48, neutral: 0 },
} as const satisfies Readonly<Record<string, ModScale>>;

export type ModScaleKind = keyof typeof MOD_SCALES;

export const scaleKindOf = (t: ModTarget): ModScaleKind => (t.kind === 'device' ? 'param' : t.param);

export const scaleOf = (t: ModTarget): ModScale => MOD_SCALES[scaleKindOf(t)];

/** A key identifying the target: "mixer:volume", "clip:transpose", "instrument:cutoff",
 *  "<effect id>:time". */
export const targetKey = (t: ModTarget): string => (t.kind === 'device' ? `${t.device}:${t.param}` : `${t.kind}:${t.param}`);

/** The target of a key (the opposite of targetKey), or null if it isn't valid. */
export function parseTargetKey(key: string): ModTarget | null {
  const i = key.indexOf(':');
  if (i <= 0 || i === key.length - 1) return null;
  const owner = key.slice(0, i), param = key.slice(i + 1);
  if (owner === 'mixer') return param === 'volume' || param === 'pan' ? { kind: 'mixer', param } : null;
  if (owner === 'clip') return param === 'transpose' ? CLIP_TRANSPOSE : null;
  return { kind: 'device', device: owner as DeviceId, param };
}

export const sameTarget = (a: ModTarget, b: ModTarget): boolean => targetKey(a) === targetKey(b);

const clamp = (v: number, s: ModScale) => Math.max(s.min, Math.min(s.max, v));

/** The curve's value at beat `beat`: before the first point it's the first, after the last
 *  the last, in between the straight line between the two neighbours. On a step it's already the next point. */
export function envelopeValueAt(points: readonly EnvelopePoint[], beat: Beats): number {
  const n = points.length;
  if (n === 0) return NaN;
  if (beat < points[0].beat) return points[0].value;
  // the last point with beat <= beat (binary search)
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].beat <= beat) lo = mid;
    else hi = mid - 1;
  }
  const a = points[lo], b = points[lo + 1];
  if (!b || b.beat === a.beat) return a.value;
  return a.value + ((b.value - a.value) * (beat - a.beat)) / (b.beat - a.beat);
}

/** The stretches of [from, to) in which the curve, rounded to the nearest integer, stays the same
 *  (the transpose plays in semitones): each stretch with its value. */
export function steppedRuns(points: readonly EnvelopePoint[], from: Beats, to: Beats): { from: Beats; to: Beats; value: number }[] {
  const out: { from: Beats; to: Beats; value: number }[] = [];
  const add = (a: Beats, b: Beats, value: number) => {
    if (b - a <= 1e-9) return;
    const last = out[out.length - 1];
    if (last && last.value === value) last.to = b;
    else out.push({ from: a, to: b, value });
  };
  const round = (v: number) => Math.round(v) + 0; // niente −0
  const cuts = [from, ...points.map(p => p.beat).filter(b => b > from && b < to), to];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], b = cuts[i + 1];
    if (b - a <= 1e-9) continue;
    // between two points the curve is a straight line: the values just inside the two ends
    const eps = (b - a) * 1e-6;
    const va = envelopeValueAt(points, a + eps), vb = envelopeValueAt(points, b - eps);
    let at = a, value = round(va);
    const dir = Math.sign(vb - va);
    // where the line crosses k ± 0.5 the semitone changes
    for (let k = value; dir !== 0 && k !== round(vb); k += dir) {
      const edge = a + eps + ((k + dir / 2 - va) / (vb - va)) * (b - a - 2 * eps);
      add(at, edge, k);
      at = edge;
      value = k + dir;
    }
    add(at, b, value);
  }
  return out;
}

/** The whole semitones the curve touches (from the lowest to the highest). */
export function steppedValues(points: readonly EnvelopePoint[]): number[] {
  if (!points.length) return [];
  const vs = points.map(p => Math.round(p.value));
  const out: number[] = [];
  for (let v = Math.min(...vs); v <= Math.max(...vs); v++) out.push(v + 0);
  return out;
}

/** Valid points: inside the scale, non-negative beats, in order (the order of those with the same
 *  beat stays the given one: it decides which side the step is on). */
export function normalizePoints(points: readonly EnvelopePoint[], scale: ModScale): EnvelopePoint[] {
  return points
    .map((p, i) => ({ p: { beat: Math.max(0, p.beat), value: clamp(p.value, scale) }, i }))
    .sort((a, b) => a.p.beat - b.p.beat || a.i - b.i)
    .map(x => x.p);
}

/** The curves with the target's one replaced (or added); without points the curve disappears. */
export function withEnvelope(envelopes: readonly ClipEnvelope[], target: ModTarget, points: readonly EnvelopePoint[]): ClipEnvelope[] {
  if (!points.length) return envelopes.filter(e => !sameTarget(e.target, target));
  const env = { target, points: normalizePoints(points, scaleOf(target)) };
  const i = envelopes.findIndex(e => sameTarget(e.target, target));
  return i < 0 ? [...envelopes, env] : envelopes.map((e, k) => (k === i ? env : e));
}
