/* Strumenti di warp automatici (Auto-Warp, Segui tempo): funzioni pure che producono una
 * nuova mappa di warp, come i comandi omonimi di WarpMio. */
import type { Beats, Seconds } from '../core/music-time';
import { WarpMarkers, type WarpMarker } from './warp-markers';

/** Dove mettere 1.1.1: l'inizio del sample o uno dei primi transienti (nei primi 2 s o nel
 *  primo 30%), scegliendo quello su cui si allineano alla griglia del tempo più transienti.
 *  A parità vince il più presto. Un colpo proprio all'inizio del file non viene rilevato come
 *  transiente (non c'è niente prima): lo si conta come se ci fosse, perché i loop di solito
 *  partono da un colpo; un sample che inizia con del silenzio ha comunque molti più
 *  transienti allineati sul suo primo colpo vero. */
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

/** Tempo costante sul tempo rilevato, con 1.1.1 sul primo colpo. */
export function autoWarp(tempo: number, transients: readonly Seconds[], duration: Seconds): WarpMarkers {
  return WarpMarkers.straight(tempo, duration, firstHit(transients, duration, tempo));
}

/** Tempo variabile da un beat tracking (registrazioni dal vivo): un marker sul primo battito
 *  di ogni battuta e sull'ultimo, ciascuno agganciato al transiente più vicino entro 35 ms.
 *  Restituisce null se i battiti trovati sono troppo pochi. */
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

/** Interpreta il sample a tempo doppio (×2) o dimezzato (:2). */
export const scaleTempo = (markers: WarpMarkers, factor: number): WarpMarkers => markers.withGlobalBpm(markers.globalBpm * factor);
