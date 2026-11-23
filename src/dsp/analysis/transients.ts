import type { Samples } from '../types';
import type { OnsetEnvelope } from './onset';

/** Brings the transient's position to the real start of the attack. */
function refineOnset(x: Samples, center: number, hop: number): number {
  const B = 32, len = x.length;
  const lo = Math.max(0, center - 3 * hop), hi = Math.min(len, center + 2 * hop);
  const nB = Math.floor((hi - lo) / B);
  if (nB < 4) return center;
  const env = new Float32Array(nB);
  for (let j = 0; j < nB; j++) {
    let m = 0;
    for (let i = lo + j * B, e = i + B; i < e; i++) { const v = Math.abs(x[i]); if (v > m) m = v; }
    env[j] = m;
  }
  let jb = 1, best = -Infinity;
  for (let j = 1; j < nB; j++) {
    const r = env[j] - Math.max(env[j - 1], j > 1 ? env[j - 2] : 0);
    if (r > best) { best = r; jb = j; }
  }
  const peak = env[jb];
  let j = jb, steps = 0;
  while (j > 0 && steps < 6 && env[j - 1] < env[j] && env[j - 1] > 0.12 * peak) { j--; steps++; }
  return lo + j * B;
}

/** Peaks of the onset curve above an adaptive threshold. `sensitivity` 0..1.
 *  Returns positions in samples. */
export function detectTransients(mono: Samples, envl: OnsetEnvelope, sensitivity: number): number[] {
  const { flux, hop, frameRate } = envl;
  const n = flux.length;
  let max = 0;
  for (let i = 0; i < n; i++) if (flux[i] > max) max = flux[i];
  if (max <= 0) return [];
  const f = flux.map(v => v / max);
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + f[i];
  const sens = Math.max(0, Math.min(1, sensitivity));
  const rules: PeakRules = {
    pre,
    w: Math.max(2, Math.round(0.1 * frameRate)),
    delta: 0.02 + (1 - sens) * 0.3,
    mult: 1.1 + (1 - sens) * 0.9,
    minGap: Math.round(0.035 * frameRate),
  };
  const out: number[] = [];
  for (const p of pickPeaks(f, rules)) {
    const pos = refineOnset(mono, p.i * hop, hop);
    if (!out.length || pos - out.at(-1)! > hop) out.push(pos);
  }
  return out;
}

/** How a peak must stand out: over `delta`, over the local mean (window `w` around, from the
 *  prefix sums `pre`) times `mult`, at least `minGap` frames after the previous one. */
interface PeakRules {
  readonly pre: Float64Array;
  readonly w: number;
  readonly delta: number;
  readonly mult: number;
  readonly minGap: number;
}

/** The peaks of the curve `f`: of two too close, the higher. */
function pickPeaks(f: ArrayLike<number>, rules: PeakRules): { i: number; v: number }[] {
  const n = f.length, peaks: { i: number; v: number }[] = [];
  for (let i = 1; i < n - 1; i++) {
    const v = f[i];
    if (v < rules.delta || !isLocalMax(f, i) || !standsOut(v, i, n, rules)) continue;
    const last = peaks.at(-1);
    if (!last || i - last.i >= rules.minGap) peaks.push({ i, v });
    else if (v > last.v) {
      last.i = i;
      last.v = v;
    }
  }
  return peaks;
}

/** The highest of the three frames on each side (the first of equal ones). */
function isLocalMax(f: ArrayLike<number>, i: number): boolean {
  const v = f[i];
  for (let j = Math.max(0, i - 3); j <= Math.min(f.length - 1, i + 3); j++) {
    if (j < i ? f[j] >= v : f[j] > v) return false;
  }
  return true;
}

function standsOut(v: number, i: number, n: number, rules: PeakRules): boolean {
  const a = Math.max(0, i - rules.w), b = Math.min(n, i + rules.w + 1);
  const mean = (rules.pre[b] - rules.pre[a]) / (b - a);
  return v >= mean * rules.mult + rules.delta * 0.5;
}
