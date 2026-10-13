import type { Samples } from '../types';
import type { OnsetEnvelope } from './onset';

/** Porta la posizione del transiente all'inizio reale dell'attacco. */
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

/** Picchi della curva di onset sopra una soglia adattiva. `sensitivity` 0..1.
 *  Restituisce posizioni in campioni. */
export function detectTransients(mono: Samples, envl: OnsetEnvelope, sensitivity: number): number[] {
  const { flux, hop, frameRate } = envl;
  const n = flux.length;
  let max = 0;
  for (let i = 0; i < n; i++) if (flux[i] > max) max = flux[i];
  if (max <= 0) return [];
  const f = flux.map(v => v / max);
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + f[i];
  const w = Math.max(2, Math.round(0.1 * frameRate));
  const sens = Math.max(0, Math.min(1, sensitivity));
  const delta = 0.02 + (1 - sens) * 0.3;
  const mult = 1.1 + (1 - sens) * 0.9;
  const minGap = Math.round(0.035 * frameRate);
  const peaks: { i: number; v: number }[] = [];
  for (let i = 1; i < n - 1; i++) {
    const v = f[i];
    if (v < delta) continue;
    let isMax = true;
    for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) {
      if (j < i ? f[j] >= v : f[j] > v) { isMax = false; break; }
    }
    if (!isMax) continue;
    const a = Math.max(0, i - w), b = Math.min(n, i + w + 1);
    const mean = (pre[b] - pre[a]) / (b - a);
    if (v < mean * mult + delta * 0.5) continue;
    const last = peaks[peaks.length - 1];
    if (last && i - last.i < minGap) {
      if (v > last.v) { last.i = i; last.v = v; }
      continue;
    }
    peaks.push({ i, v });
  }
  const out: number[] = [];
  for (const p of peaks) {
    const pos = refineOnset(mono, p.i * hop, hop);
    if (!out.length || pos - out[out.length - 1] > hop) out.push(pos);
  }
  return out;
}
