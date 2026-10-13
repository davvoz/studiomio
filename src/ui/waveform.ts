import type { SampleId } from '../core/id';
import type { Seconds } from '../core/music-time';
import type { AudioData } from '../dsp/types';

/** Un livello di riduzione: minimo e massimo per gruppi di `bucket` campioni. */
interface Level {
  readonly bucket: number;
  readonly min: Float32Array;
  readonly max: Float32Array;
}

const BASE_BUCKET = 64;
const FACTOR = 8;

/** Picchi della forma d'onda (mono) a più risoluzioni, per disegnarla velocemente a
 *  qualunque zoom senza rileggere tutti i campioni. */
export class Peaks {
  private constructor(private readonly levels: readonly Level[], readonly sampleRate: number, readonly length: number) {}

  static from({ channels, sampleRate }: AudioData): Peaks {
    const n = channels[0].length;
    const count = Math.ceil(n / BASE_BUCKET);
    const min = new Float32Array(count), max = new Float32Array(count);
    for (let b = 0; b < count; b++) {
      let lo = Infinity, hi = -Infinity;
      const end = Math.min(n, (b + 1) * BASE_BUCKET);
      for (const c of channels) {
        for (let i = b * BASE_BUCKET; i < end; i++) {
          const v = c[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      min[b] = lo; max[b] = hi;
    }
    const levels: Level[] = [{ bucket: BASE_BUCKET, min, max }];
    while (levels[levels.length - 1].min.length > FACTOR) {
      const prev = levels[levels.length - 1];
      const m = Math.ceil(prev.min.length / FACTOR);
      const lmin = new Float32Array(m), lmax = new Float32Array(m);
      for (let b = 0; b < m; b++) {
        let lo = Infinity, hi = -Infinity;
        for (let i = b * FACTOR, e = Math.min(prev.min.length, i + FACTOR); i < e; i++) {
          if (prev.min[i] < lo) lo = prev.min[i];
          if (prev.max[i] > hi) hi = prev.max[i];
        }
        lmin[b] = lo; lmax[b] = hi;
      }
      levels.push({ bucket: prev.bucket * FACTOR, min: lmin, max: lmax });
    }
    return new Peaks(levels, sampleRate, n);
  }

  /** Minimo e massimo tra i secondi `t0` e `t1` (0 fuori dal sample). */
  range(t0: Seconds, t1: Seconds): [number, number] {
    const a = Math.max(0, Math.floor(Math.min(t0, t1) * this.sampleRate));
    const b = Math.min(this.length, Math.ceil(Math.max(t0, t1) * this.sampleRate));
    if (b <= a) return [0, 0];
    // il livello più fine che richiede di leggere al massimo ~16 gruppi
    const level = this.levels.find(l => (b - a) / l.bucket <= 16) ?? this.levels[this.levels.length - 1];
    const i0 = Math.floor(a / level.bucket), i1 = Math.min(level.min.length, Math.ceil(b / level.bucket));
    let lo = Infinity, hi = -Infinity;
    for (let i = i0; i < i1; i++) {
      if (level.min[i] < lo) lo = level.min[i];
      if (level.max[i] > hi) hi = level.max[i];
    }
    return lo === Infinity ? [0, 0] : [lo, hi];
  }
}

/** Picchi per sample, calcolati alla prima richiesta. */
export class PeakStore {
  private readonly peaks = new Map<SampleId, Peaks>();

  constructor(private readonly audio: (id: SampleId) => AudioData | undefined) {}

  get(id: SampleId): Peaks | null {
    let p = this.peaks.get(id);
    if (!p) {
      const data = this.audio(id);
      if (!data) return null;
      p = Peaks.from(data);
      this.peaks.set(id, p);
    }
    return p;
  }
}
