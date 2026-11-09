/* Automatic warp tools (Auto-Warp, Follow tempo): pure functions producing a
 * new warp map, like WarpMio's commands of the same name. */
import type { Beats, Seconds } from '../core/music-time';
import { WarpMarkers, type WarpMarker } from './warp-markers';

/** Where to put 1.1.1: the start of the sample or one of the first transients (in the first 2 s or in the
 *  first 30%), choosing the one on which the most transients align with the tempo grid.
 *  On a tie the earliest wins. A hit right at the start of the file isn't detected as a
 *  transient (there's nothing before it): it's counted as if it were there, because loops usually
 *  start with a hit; a sample starting with silence still has many more
 *  transients aligned on its first real hit. */
export function firstHit(transients: readonly Seconds[], duration: Seconds, tempo: number): Seconds {
  const period = 60 / tempo, tolerance = 0.03;
  const hits = transients.some(t => t < 0.02) ? transients : [0, ...transients];
  const aligned = (offset: Seconds) => hits.filter(t => {
    const phase = ((t - offset) % period + period) % period;
    return Math.min(phase, period - phase) < tolerance;
  }).length;
  const candidates = [0, ...transients.filter(t => t >= 0.02 && t < Math.min(2, duration * 0.3))];
  let best = 0, bestScore = aligned(0);
  for (const c of candidates) {
    const score = aligned(c);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

/** Constant tempo on the detected tempo, with 1.1.1 on the first hit. */
export function autoWarp(tempo: number, transients: readonly Seconds[], duration: Seconds): WarpMarkers {
  return WarpMarkers.straight(tempo, duration, firstHit(transients, duration, tempo));
}

/** Variable tempo from beat tracking (live recordings): a marker on the first beat
 *  of each bar and on the last one, each snapped to the nearest transient within 35 ms.
 *  Returns null if too few beats were found. */
export function followTempo(
  beats: readonly Seconds[], transients: readonly Seconds[], tempo: number, duration: Seconds, beatsPerBar: Beats,
): WarpMarkers | null {
  if (beats.length < 3) return null;
  const snapped = beats.map(b => {
    let best = b, bd = 0.035;
    for (const t of transients) {
      const d = Math.abs(t - b);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  });
  const ms: WarpMarker[] = [];
  if (snapped[0] > 0.01) ms.push({ t: 0, b: (-snapped[0] * tempo) / 60 });
  snapped.forEach((t, k) => {
    if (k % beatsPerBar === 0 || k === snapped.length - 1) ms.push({ t, b: k });
  });
  const last = ms[ms.length - 1];
  if (duration - last.t > 0.01) ms.push({ t: duration, b: last.b + ((duration - last.t) * tempo) / 60 });
  return WarpMarkers.of(ms, tempo);
}

/** Interprets the sample at double (×2) or half (:2) tempo. */
export const scaleTempo = (markers: WarpMarkers, factor: number): WarpMarkers => markers.withGlobalBpm(markers.globalBpm * factor);
