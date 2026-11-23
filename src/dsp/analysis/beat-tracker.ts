import type { OnsetEnvelope } from './onset';

/** Beat tracking with dynamic programming (Ellis 2007). Returns positions in samples. */
export function trackBeats(envl: OnsetEnvelope, bpm: number): number[] {
  const { flux, hop, frameRate } = envl;
  const n = flux.length;
  const period = (frameRate * 60) / bpm;
  const o = standardized(flux);
  const score = new Float64Array(n), back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2), hi = Math.round(2 * period);
  for (let i = 0; i < n; i++) {
    const { best, at } = bestPrevious(score, i, lo, hi, period);
    score[i] = o[i] + (at >= 0 ? Math.max(0, best) : 0);
    back[i] = at >= 0 && best > 0 ? at : -1;
  }
  let end = n - 1, bestEnd = -Infinity;
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) {
    if (score[i] > bestEnd) { bestEnd = score[i]; end = i; }
  }
  const beats: number[] = [];
  for (let i = end; i >= 0; i = back[i]) beats.push(i * hop);
  return beats.reverse();
}

/** The curve divided by its standard deviation (by 1 if it's flat). */
function standardized(flux: ArrayLike<number>): Float64Array {
  const n = flux.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += flux[i];
  mean /= n;
  let sd = 0;
  for (let i = 0; i < n; i++) sd += (flux[i] - mean) ** 2;
  sd = Math.sqrt(sd / n) || 1;
  const o = new Float64Array(n);
  for (let i = 0; i < n; i++) o[i] = flux[i] / sd;
  return o;
}

/** How far apart beats like to be: the penalty for a gap away from the period. */
const TIGHTNESS = 100;

/** The best previous beat for frame `i` (between half and twice the period before), and its score. */
function bestPrevious(score: Float64Array, i: number, lo: number, hi: number, period: number): { best: number; at: number } {
  let best = -Infinity, at = -1;
  for (let j = Math.max(0, i - hi); j <= i - lo; j++) {
    const r = Math.log((i - j) / period);
    const v = score[j] - TIGHTNESS * r * r;
    if (v > best) { best = v; at = j; }
  }
  return { best, at };
}
