import type { Beats, Seconds } from '../core/music-time';

/** Un punto della mappa di warp: il secondo `t` del sample cade sul battito `b` della clip. */
export interface WarpMarker {
  readonly t: Seconds;
  readonly b: Beats;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Distanza minima tra marker: in tempo (spostando l'audio) e in battiti (trascinando). */
const MIN_GAP_T = 0.001;
const MIN_GAP_B = 0.01;

/** Mappa di warp di una clip audio (come in WarpMio e in Live): lineare a tratti tra i marker,
 *  estrapolata al tempo di base fuori da essi. Immutabile: ogni modifica restituisce una
 *  nuova mappa. */
export class WarpMarkers {
  readonly markers: readonly WarpMarker[];
  /** Tempo del sample usato fuori dai marker e quando ce n'è meno di due. */
  readonly baseBpm: number;

  private constructor(markers: readonly WarpMarker[], baseBpm: number) {
    this.markers = markers;
    this.baseBpm = baseBpm;
  }

  /** Marker ordinati, senza doppioni e con battiti crescenti. */
  static of(markers: readonly WarpMarker[], baseBpm: number): WarpMarkers {
    if (!(baseBpm > 0)) throw new RangeError(`tempo di base non valido: ${baseBpm}`);
    const sorted = [...markers].sort((p, q) => p.t - q.t);
    const out: WarpMarker[] = [];
    for (const m of sorted) {
      const l = out[out.length - 1];
      if (l && (m.t - l.t < 1e-5 || m.b - l.b < 1e-5)) continue;
      out.push({ t: m.t, b: m.b });
    }
    return new WarpMarkers(out, baseBpm);
  }

  /** Tempo costante: il secondo `firstBeatAt` è il battito 0 (1.1.1), con un marker anche
   *  all'inizio del sample se il primo battito non è lì, e uno alla fine. */
  static straight(bpm: number, duration: Seconds, firstBeatAt: Seconds = 0): WarpMarkers {
    const ms: WarpMarker[] = [];
    if (firstBeatAt > 0) ms.push({ t: 0, b: (-firstBeatAt * bpm) / 60 });
    ms.push({ t: firstBeatAt, b: 0 });
    ms.push({ t: duration, b: ((duration - firstBeatAt) * bpm) / 60 });
    return WarpMarkers.of(ms, bpm);
  }

  get length(): number {
    return this.markers.length;
  }

  /** Battito della clip in cui suona il secondo `t` del sample. */
  beatOf(t: Seconds): Beats {
    const ms = this.markers, n = ms.length, k = this.baseBpm / 60;
    if (n === 0) return t * k;
    if (n === 1) return ms[0].b + (t - ms[0].t) * k;
    const i = WarpMarkers.segment(n, j => ms[j].t, t);
    const a = ms[i], c = ms[i + 1];
    return a.b + ((t - a.t) * (c.b - a.b)) / (c.t - a.t);
  }

  /** Secondo del sample che suona al battito `b` della clip. */
  timeOf(b: Beats): Seconds {
    const ms = this.markers, n = ms.length, k = this.baseBpm / 60;
    if (n === 0) return b / k;
    if (n === 1) return ms[0].t + (b - ms[0].b) / k;
    const i = WarpMarkers.segment(n, j => ms[j].b, b);
    const a = ms[i], c = ms[i + 1];
    return a.t + ((b - a.b) * (c.t - a.t)) / (c.b - a.b);
  }

  /** Tempo medio tra il primo e l'ultimo marker. */
  get globalBpm(): number {
    const m = this.markers;
    if (m.length < 2) return this.baseBpm;
    return (60 * (m[m.length - 1].b - m[0].b)) / (m[m.length - 1].t - m[0].t);
  }

  /** Tempo del segmento che parte dal marker `i` (l'ultimo marker usa il segmento prima). */
  segmentBpm(i: number): number {
    const m = this.markers;
    if (i < 0 || m.length < 2) return this.globalBpm;
    const j = i < m.length - 1 ? i : i - 1;
    return (60 * (m[j + 1].b - m[j].b)) / (m[j + 1].t - m[j].t);
  }

  /** Indice del marker entro `tolerance` secondi da `t`, o -1. */
  indexNear(t: Seconds, tolerance = 0.002): number {
    return this.markers.findIndex(m => Math.abs(m.t - t) < tolerance);
  }

  /** Aggiunge un marker in `t` senza cambiare la mappa (cade dove già suona).
   *  Se ce n'è già uno vicino restituisce la mappa invariata e il suo indice. */
  withMarkerAt(t: Seconds): { readonly markers: WarpMarkers; readonly index: number } {
    const near = this.indexNear(t);
    if (near >= 0) return { markers: this, index: near };
    const added = WarpMarkers.of([...this.markers, { t, b: this.beatOf(t) }], this.baseBpm);
    return { markers: added, index: added.indexNear(t) };
  }

  /** Servono sempre almeno due marker. */
  canRemove(i: number): boolean {
    return i >= 0 && i < this.markers.length && this.markers.length > 2;
  }

  without(i: number): WarpMarkers {
    if (!this.canRemove(i)) throw new RangeError('servono almeno due warp marker');
    return new WarpMarkers(this.markers.filter((_, j) => j !== i), this.baseBpm);
  }

  /** Trascina il marker `i` sul battito `b` (l'audio si allunga o si accorcia attorno). */
  withMarkerBeat(i: number, b: Beats): WarpMarkers {
    const ms = this.markers;
    const lo = i > 0 ? ms[i - 1].b + MIN_GAP_B : -Infinity;
    const hi = i < ms.length - 1 ? ms[i + 1].b - MIN_GAP_B : Infinity;
    return this.replace(i, { t: ms[i].t, b: clamp(b, lo, hi) });
  }

  /** Sposta l'audio sotto il marker `i`: cambia il secondo del sample, il battito resta. */
  withMarkerTime(i: number, t: Seconds, duration: Seconds): WarpMarkers {
    const ms = this.markers;
    const lo = i > 0 ? ms[i - 1].t + MIN_GAP_T : 0;
    const hi = i < ms.length - 1 ? ms[i + 1].t - MIN_GAP_T : duration;
    return this.replace(i, { t: clamp(t, lo, hi), b: ms[i].b });
  }

  /** Imposta il tempo del segmento che parte dal marker `i`: i marker successivi scorrono. */
  withSegmentBpm(i: number, bpm: number): WarpMarkers {
    const m = this.markers;
    if (m.length < 2) return this.withGlobalBpm(bpm);
    const j = i < m.length - 1 ? i : i - 1;
    const d = m[j].b + ((m[j + 1].t - m[j].t) * bpm) / 60 - m[j + 1].b;
    return new WarpMarkers(m.map((x, k) => (k > j ? { t: x.t, b: x.b + d } : x)), this.baseBpm);
  }

  /** Scala tutta la mappa al nuovo tempo, tenendo fermo il primo marker. */
  withGlobalBpm(bpm: number): WarpMarkers {
    const m = this.markers, old = this.globalBpm, b0 = m.length ? m[0].b : 0;
    return new WarpMarkers(m.map(x => ({ t: x.t, b: b0 + ((x.b - b0) * bpm) / old })), bpm);
  }

  /** Il secondo `t` diventa il battito 0 (1.1.1). */
  withOrigin(t: Seconds): WarpMarkers {
    const d = this.beatOf(t);
    return new WarpMarkers(this.markers.map(m => ({ t: m.t, b: m.b - d })), this.baseBpm);
  }

  /** Porta i battiti dei marker sulla griglia `step`, scartando quelli che collidono. */
  quantized(step: Beats): WarpMarkers {
    const out: WarpMarker[] = [];
    for (const m of this.markers) {
      const b = Math.round(m.b / step) * step;
      if (!out.length || b > out[out.length - 1].b + 1e-6) out.push({ t: m.t, b });
    }
    return new WarpMarkers(out, this.baseBpm);
  }

  /** Riparte da un tempo costante (il tempo medio attuale), mantenendo la posizione di inizio. */
  cleared(duration: Seconds): WarpMarkers {
    const b0 = this.beatOf(0), bpm = this.globalBpm;
    return WarpMarkers.of([{ t: 0, b: b0 }, { t: duration, b: b0 + (duration * bpm) / 60 }], bpm);
  }

  /** La mappa per il sample rovesciato: il secondo `t` diventa `duration − t` e il battito `b`
   *  diventa `axis − b`, così il battito `axis − b` suona l'audio che prima suonava in `b`. */
  mirrored(duration: Seconds, axis: Beats): WarpMarkers {
    const ms = this.markers.length >= 2 ? this.markers : [{ t: 0, b: this.beatOf(0) }, { t: duration, b: this.beatOf(duration) }];
    return WarpMarkers.of(ms.map(m => ({ t: duration - m.t, b: axis - m.b })), this.baseBpm);
  }

  equals(o: WarpMarkers): boolean {
    return o.baseBpm === this.baseBpm && o.markers.length === this.markers.length
      && o.markers.every((m, i) => m.t === this.markers[i].t && m.b === this.markers[i].b);
  }

  private replace(i: number, m: WarpMarker): WarpMarkers {
    return new WarpMarkers(this.markers.map((x, k) => (k === i ? m : x)), this.baseBpm);
  }

  /** Segmento [i, i+1] che contiene v (il primo o l'ultimo se v è fuori). */
  private static segment(n: number, key: (i: number) => number, v: number): number {
    if (v >= key(n - 1)) return n - 2;
    if (v <= key(0)) return 0;
    let lo = 0, hi = n - 2;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (key(m) <= v) lo = m; else hi = m - 1;
    }
    return lo;
  }
}
