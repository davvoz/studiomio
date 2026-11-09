import type { OnsetEnvelope } from './onset';

const BEATS_PER_BAR = 4;
const LOOP_BARS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];

function autocorr(f: Float32Array, lag: number): number {
  let s = 0;
  const n = f.length - lag;
  for (let i = 0; i < n; i++) s += f[i] * f[i + lag];
  return n > 0 ? s / n : 0;
}

/** Brings the tempo into the 80–160 BPM octave. */
function foldOctave(bpm: number): number {
  while (bpm < 80) bpm *= 2;
  while (bpm >= 160) bpm /= 2;
  return bpm;
}

/** For loops: if a duration of whole bars explains the estimated tempo within 4%, it wins. */
function snapToWholeBars(bpm: number, durationSec: number): number {
  if (durationSec <= 0.5 || durationSec > 60) return bpm;
  let snap: number | null = null, err = 0.04;
  for (const bars of LOOP_BARS) {
    const c = (bars * BEATS_PER_BAR * 60) / durationSec;
    if (c < 60 || c > 200) continue;
    for (const mult of [0.5, 1, 2]) {
      const e = Math.abs(c / (bpm * mult) - 1);
      if (e < err) { err = e; snap = c; }
    }
  }
  return snap ? foldOctave(snap) : bpm;
}

/** Tempo estimate: autocorrelation of the onset with a preference around 120 BPM and,
 *  for loops, snapping to a duration of whole bars. */
export function estimateTempo(envl: OnsetEnvelope, durationSec: number): number {
  const { flux, frameRate } = envl;
  const n = flux.length;
  if (n < 16) return 120;
  const win = Math.max(1, Math.round(0.4 * frameRate));
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + flux[i];
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - win), b = Math.min(n, i + win + 1);
    f[i] = Math.max(0, flux[i] - (pre[b] - pre[a]) / (b - a));
  }
  const lMin = Math.max(2, Math.floor((frameRate * 60) / 220));
  const lMax = Math.min(n - 2, Math.ceil((frameRate * 60) / 50));
  const ac = new Float64Array(lMax * 4 + 3);
  for (let L = lMin - 1; L <= Math.min(lMax * 4 + 2, n - 2); L++) ac[L] = autocorr(f, L);
  let bestL = 0, best = -Infinity;
  for (let L = lMin; L <= lMax; L++) {
    const bpm = (60 * frameRate) / L;
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const s = (ac[L] + 0.5 * (ac[2 * L] || 0) + 0.25 * (ac[4 * L] || 0)) * w;
    if (s > best) { best = s; bestL = L; }
  }
  if (!bestL) return 120;
  // parabolic interpolation of the peak
  let L = bestL;
  const y0 = ac[bestL - 1], y1 = ac[bestL], y2 = ac[bestL + 1];
  const den = y0 - 2 * y1 + y2;
  if (den < 0) L = bestL + (0.5 * (y0 - y2)) / den;
  const bpm = snapToWholeBars(foldOctave((60 * frameRate) / L), durationSec);
  return Math.round(bpm * 100) / 100;
}
