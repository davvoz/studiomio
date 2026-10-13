/* Calcoli dell'editor delle clip: asse dei battiti, corrispondenza battiti ↔ secondi del
 * sample, modifiche di regione e loop sempre valide. Funzioni pure. */
import type { Beats, Seconds, TempoMap } from '../../core/music-time';
import { placementSegments } from '../../engine/segments';
import type { Placement } from '../../model/arrangement';
import type { AudioClip } from '../../model/audio-clip';
import type { WarpMarkers } from '../../model/warp-markers';

/** Asse orizzontale dell'editor: battiti della clip (possono essere negativi, prima di 1.1.1). */
export class BeatAxis {
  constructor(readonly pxPerBeat = 40, readonly startBeat: Beats = 0) {}

  beatToX(b: Beats): number {
    return (b - this.startBeat) * this.pxPerBeat;
  }

  xToBeat(x: number): Beats {
    return this.startBeat + x / this.pxPerBeat;
  }

  zoomed(pxPerBeat: number, anchorX: number): BeatAxis {
    const px = Math.max(2, Math.min(4000, pxPerBeat));
    return new BeatAxis(px, this.xToBeat(anchorX) - anchorX / px);
  }

  scrolled(startBeat: Beats): BeatAxis {
    return new BeatAxis(this.pxPerBeat, startBeat);
  }

  /** Asse che mostra [b0, b1] in `width` pixel, con un po' di margine. */
  static fit(b0: Beats, b1: Beats, width: number): BeatAxis {
    const span = Math.max(1e-3, b1 - b0), pad = span * 0.03;
    return new BeatAxis(Math.max(2, width / (span + 2 * pad)), b0 - pad);
  }
}

/** Battito della clip → secondo del sample: con il warp passa per i marker, senza il sample
 *  scorre al tempo del progetto alla velocità data dal transpose (come nel motore). */
export function contentToSeconds(clip: AudioClip, tempo: TempoMap): (b: Beats) => Seconds {
  if (clip.warp.enabled) return b => clip.warp.markers.timeOf(b);
  const rate = Math.pow(2, clip.pitch / 12);
  return b => tempo.secondsAt(b) * rate;
}

/** Secondo del sample → battito della clip (l'inverso di contentToSeconds). */
export function secondsToContent(clip: AudioClip, tempo: TempoMap): (t: Seconds) => Beats {
  if (clip.warp.enabled) return t => clip.warp.markers.beatOf(t);
  const rate = Math.pow(2, clip.pitch / 12);
  return t => tempo.beatAt(t / rate);
}

const MIN_LEN = 1 / 16;

/** Regione [start, end) resa valida: ordinata, non vuota, compatibile con il loop attivo. */
export function withRegionSafe(clip: AudioClip, start: Beats, end: Beats): AudioClip {
  let s = Math.min(start, end - MIN_LEN), e = Math.max(end, s + MIN_LEN);
  if (clip.loop.enabled && s >= clip.loop.end - MIN_LEN) s = clip.loop.end - MIN_LEN;
  e = Math.max(e, s + MIN_LEN);
  return clip.withRegion({ start: s, end: e });
}

/** Loop [start, end) acceso; se la clip partirebbe dopo la fine del loop, parte dal loop. */
export function withLoopSafe(clip: AudioClip, start: Beats, end: Beats, enabled = true): AudioClip {
  const s = Math.min(start, end), e = Math.max(end, s + MIN_LEN);
  let c = clip;
  if (enabled && c.region.start >= e) c = c.withRegion({ start: s, end: Math.max(c.region.end, e) });
  return c.withLoop({ enabled, start: s, end: e });
}

/** Trascinamento con Maiusc: l'audio scorre sotto il marker `i`, che resta sul suo battito.
 *  Lo spostamento si misura sulla mappa com'era all'inizio del gesto. */
export function shiftAudioUnderMarker(
  frozen: WarpMarkers, i: number, fromBeat: Beats, toBeat: Beats, duration: Seconds,
): WarpMarkers {
  const dt = frozen.timeOf(toBeat) - frozen.timeOf(fromBeat);
  return frozen.withMarkerTime(i, frozen.markers[i].t - dt, duration);
}

/** Battito della clip che suona al battito `timelineBeat` della timeline, o null se la
 *  clip posata non suona lì. */
export function contentBeatAt(pl: Placement, timelineBeat: Beats): Beats | null {
  const s = placementSegments(pl).find(x => x.start <= timelineBeat && x.end > timelineBeat);
  return s ? s.contentStart + (timelineBeat - s.start) : null;
}

/** Battito della timeline in cui la clip posata suona per la prima volta il battito `content`. */
export function timelineBeatOf(pl: Placement, content: Beats): Beats | null {
  for (const s of placementSegments(pl)) {
    const t = s.start + (content - s.contentStart);
    if (t >= s.start && t < s.end) return t;
  }
  return null;
}
