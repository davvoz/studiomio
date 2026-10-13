import type { OnsetEnvelope } from './onset';

/** Beat tracking con programmazione dinamica (Ellis 2007). Restituisce posizioni in campioni. */
export function trackBeats(envl: OnsetEnvelope, bpm: number): number[] {
  const { flux, hop, frameRate } = envl;
  const n = flux.length;
  const period = (frameRate * 60) / bpm;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += flux[i];
  mean /= n;
  let sd = 0;
  for (let i = 0; i < n; i++) sd += (flux[i] - mean) ** 2;
  sd = Math.sqrt(sd / n) || 1;
  const o = new Float64Array(n);
  for (let i = 0; i < n; i++) o[i] = flux[i] / sd;
  const score = new Float64Array(n), back = new Int32Array(n).fill(-1);
  const tight = 100;
  const lo = Math.round(period / 2), hi = Math.round(2 * period);
  for (let i = 0; i < n; i++) {
    let best = -Infinity, bi = -1;
    for (let j = i - hi; j <= i - lo; j++) {
      if (j < 0) continue;
      const r = Math.log((i - j) / period);
      const v = score[j] - tight * r * r;
      if (v > best) { best = v; bi = j; }
    }
    score[i] = o[i] + (bi >= 0 ? Math.max(0, best) : 0);
    back[i] = bi >= 0 && best > 0 ? bi : -1;
  }
  let end = n - 1, bestEnd = -Infinity;
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) {
    if (score[i] > bestEnd) { bestEnd = score[i]; end = i; }
  }
  const beats: number[] = [];
  for (let i = end; i >= 0; i = back[i]) beats.push(i * hop);
  return beats.reverse();
}
