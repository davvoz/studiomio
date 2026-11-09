import type { Beats, Seconds } from '../core/music-time';

/** A point of the warp map: second `t` of the sample falls on beat `b` of the clip. */
export interface WarpMarker {
  readonly t: Seconds;
  readonly b: Beats;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Minimum distance between markers: in time (moving the audio) and in beats (dragging). */
const MIN_GAP_T = 0.001;
const MIN_GAP_B = 0.01;

/** An audio clip's warp map (as in WarpMio and in Live): piecewise linear between the markers,
 *  extrapolated at the base tempo outside them. Immutable: every change returns a
 *  new map. */
export class WarpMarkers {
  readonly markers: readonly WarpMarker[];
  /** The sample's tempo used outside the markers and when there are fewer than two. */
  readonly baseBpm: number;

  private constructor(markers: readonly WarpMarker[], baseBpm: number) {
    this.markers = markers;
    this.baseBpm = baseBpm;
  }

  /** Sorted markers, without duplicates and with increasing beats. */
  static of(markers: readonly WarpMarker[], baseBpm: number): WarpMarkers {
    if (!(baseBpm > 0)) throw new RangeError(`invalid base tempo: ${baseBpm}`);
    const sorted = [...markers].sort((p, q) => p.t - q.t);
    const out: WarpMarker[] = [];
    for (const m of sorted) {
      const l = out[out.length - 1];
      if (l && (m.t - l.t < 1e-5 || m.b - l.b < 1e-5)) continue;
      out.push({ t: m.t, b: m.b });
    }
    return new WarpMarkers(out, baseBpm);
  }

  /** Constant tempo: second `firstBeatAt` is beat 0 (1.1.1), with a marker also
   *  at the start of the sample if the first beat isn't there, and one at the end. */
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

  /** Clip beat at which second `t` of the sample plays. */
  beatOf(t: Seconds): Beats {
    const ms = this.markers, n = ms.length, k = this.baseBpm / 60;
    if (n === 0) return t * k;
    if (n === 1) return ms[0].b + (t - ms[0].t) * k;
    const i = WarpMarkers.segment(n, j => ms[j].t, t);
    const a = ms[i], c = ms[i + 1];
    return a.b + ((t - a.t) * (c.b - a.b)) / (c.t - a.t);
  }

  /** Second of the sample playing at beat `b` of the clip. */
  timeOf(b: Beats): Seconds {
    const ms = this.markers, n = ms.length, k = this.baseBpm / 60;
    if (n === 0) return b / k;
    if (n === 1) return ms[0].t + (b - ms[0].b) / k;
    const i = WarpMarkers.segment(n, j => ms[j].b, b);
    const a = ms[i], c = ms[i + 1];
    return a.t + ((b - a.b) * (c.t - a.t)) / (c.b - a.b);
  }

  /** Average tempo between the first and the last marker. */
  get globalBpm(): number {
    const m = this.markers;
    if (m.length < 2) return this.baseBpm;
    return (60 * (m[m.length - 1].b - m[0].b)) / (m[m.length - 1].t - m[0].t);
  }

  /** Tempo of the segment starting at marker `i` (the last marker uses the segment before). */
  segmentBpm(i: number): number {
    const m = this.markers;
    if (i < 0 || m.length < 2) return this.globalBpm;
    const j = i < m.length - 1 ? i : i - 1;
    return (60 * (m[j + 1].b - m[j].b)) / (m[j + 1].t - m[j].t);
  }

  /** Index of the marker within `tolerance` seconds of `t`, or -1. */
  indexNear(t: Seconds, tolerance = 0.002): number {
    return this.markers.findIndex(m => Math.abs(m.t - t) < tolerance);
  }

  /** Adds a marker at `t` without changing the map (it falls where it already plays).
   *  If there's already one nearby it returns the unchanged map and its index. */
  withMarkerAt(t: Seconds): { readonly markers: WarpMarkers; readonly index: number } {
    const near = this.indexNear(t);
    if (near >= 0) return { markers: this, index: near };
    const added = WarpMarkers.of([...this.markers, { t, b: this.beatOf(t) }], this.baseBpm);
    return { markers: added, index: added.indexNear(t) };
  }

  /** At least two markers are always needed. */
  canRemove(i: number): boolean {
    return i >= 0 && i < this.markers.length && this.markers.length > 2;
  }

  without(i: number): WarpMarkers {
    if (!this.canRemove(i)) throw new RangeError('at least two warp markers are needed');
    return new WarpMarkers(this.markers.filter((_, j) => j !== i), this.baseBpm);
  }

  /** Drags marker `i` onto beat `b` (the audio stretches or shrinks around it). */
  withMarkerBeat(i: number, b: Beats): WarpMarkers {
    const ms = this.markers;
    const lo = i > 0 ? ms[i - 1].b + MIN_GAP_B : -Infinity;
    const hi = i < ms.length - 1 ? ms[i + 1].b - MIN_GAP_B : Infinity;
    return this.replace(i, { t: ms[i].t, b: clamp(b, lo, hi) });
  }

  /** Moves the audio under marker `i`: changes the sample's second, the beat stays. */
  withMarkerTime(i: number, t: Seconds, duration: Seconds): WarpMarkers {
    const ms = this.markers;
    const lo = i > 0 ? ms[i - 1].t + MIN_GAP_T : 0;
    const hi = i < ms.length - 1 ? ms[i + 1].t - MIN_GAP_T : duration;
    return this.replace(i, { t: clamp(t, lo, hi), b: ms[i].b });
  }

  /** Sets the tempo of the segment starting at marker `i`: the following markers shift. */
  withSegmentBpm(i: number, bpm: number): WarpMarkers {
    const m = this.markers;
    if (m.length < 2) return this.withGlobalBpm(bpm);
    const j = i < m.length - 1 ? i : i - 1;
    const d = m[j].b + ((m[j + 1].t - m[j].t) * bpm) / 60 - m[j + 1].b;
    return new WarpMarkers(m.map((x, k) => (k > j ? { t: x.t, b: x.b + d } : x)), this.baseBpm);
  }

  /** Scales the whole map to the new tempo, keeping the first marker still. */
  withGlobalBpm(bpm: number): WarpMarkers {
    const m = this.markers, old = this.globalBpm, b0 = m.length ? m[0].b : 0;
    return new WarpMarkers(m.map(x => ({ t: x.t, b: b0 + ((x.b - b0) * bpm) / old })), bpm);
  }

  /** Second `t` becomes beat 0 (1.1.1). */
  withOrigin(t: Seconds): WarpMarkers {
    const d = this.beatOf(t);
    return new WarpMarkers(this.markers.map(m => ({ t: m.t, b: m.b - d })), this.baseBpm);
  }

  /** Brings the markers' beats onto grid `step`, discarding those that collide. */
  quantized(step: Beats): WarpMarkers {
    const out: WarpMarker[] = [];
    for (const m of this.markers) {
      const b = Math.round(m.b / step) * step;
      if (!out.length || b > out[out.length - 1].b + 1e-6) out.push({ t: m.t, b });
    }
    return new WarpMarkers(out, this.baseBpm);
  }

  /** Restarts from a constant tempo (the current average tempo), keeping the start position. */
  cleared(duration: Seconds): WarpMarkers {
    const b0 = this.beatOf(0), bpm = this.globalBpm;
    return WarpMarkers.of([{ t: 0, b: b0 }, { t: duration, b: b0 + (duration * bpm) / 60 }], bpm);
  }

  /** The map for the reversed sample: second `t` becomes `duration − t` and beat `b`
   *  becomes `axis − b`, so beat `axis − b` plays the audio that used to play at `b`. */
  mirrored(duration: Seconds, axis: Beats): WarpMarkers {
    const ms = this.markers.length >= 2 ? this.markers : [{ t: 0, b: this.beatOf(0) }, { t: duration, b: this.beatOf(duration) }];
    return WarpMarkers.of(ms.map(m => ({ t: duration - m.t, b: axis - m.b })), this.baseBpm);
  }

  /** Only the stretch [from, to] of the sample, turned into a file of its own (the crop): the seconds
   *  restart from 0, the beats stay as before and there's a marker on each edge. */
  cropped(from: Seconds, to: Seconds): WarpMarkers {
    const inside = this.markers.filter(m => m.t > from && m.t < to);
    const ms = [{ t: from, b: this.beatOf(from) }, ...inside, { t: to, b: this.beatOf(to) }];
    return WarpMarkers.of(ms.map(m => ({ t: m.t - from, b: m.b })), this.baseBpm);
  }

  equals(o: WarpMarkers): boolean {
    return o.baseBpm === this.baseBpm && o.markers.length === this.markers.length
      && o.markers.every((m, i) => m.t === this.markers[i].t && m.b === this.markers[i].b);
  }

  private replace(i: number, m: WarpMarker): WarpMarkers {
    return new WarpMarkers(this.markers.map((x, k) => (k === i ? m : x)), this.baseBpm);
  }

  /** Segment [i, i+1] containing v (the first or the last if v is outside). */
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
