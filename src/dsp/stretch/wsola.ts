import { hann, mixMono, normalizeOverlap } from '../signal';
import type { Samples } from '../types';
import type { StretchInput, TimeStretcher, SettingsOf } from './stretcher';

interface GrainOptions {
  readonly grainMs: number;
  /** Cerca l'attacco del grano più coerente con il precedente (WSOLA). */
  readonly search: boolean;
  /** 0..1: spostamento casuale del grano quando non si cerca. */
  readonly flux: number;
}

/** Generatore pseudo-casuale deterministico (stesso risultato a ogni render). */
function lcg(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

/** Cerca, attorno a `target`, l'inizio di frame più simile alla continuazione naturale `nat`. */
function bestMatch(x: Samples, nat: number, target: number, tol: number, N: number, stride: number): number {
  const len = x.length;
  const score = (s: number, st: number): number => {
    let dot = 0, en = 1e-9;
    for (let i = 0; i < N; i += st) {
      const j = s + i, k = nat + i;
      const c = j >= 0 && j < len ? x[j] : 0;
      const r = k >= 0 && k < len ? x[k] : 0;
      dot += c * r; en += c * c;
    }
    return dot / Math.sqrt(en);
  };
  const step = Math.max(1, stride >> 1);
  let best = target, bestScore = score(target, stride);
  for (let d = -tol; d <= tol; d += step) {
    const s = score(target + d, stride);
    if (s > bestScore) { bestScore = s; best = target + d; }
  }
  const fine = Math.max(1, stride >> 2);
  let refined = best, refScore = score(best, fine);
  for (let d = -step + 1; d < step; d++) {
    if (d === 0) continue;
    const s = score(best + d, fine);
    if (s > refScore) { refScore = s; refined = best + d; }
  }
  return refined;
}

/** Overlap-add di grani: con ricerca è WSOLA (Tones), senza è granulare (Texture). */
export function grainStretch({ channels, sampleRate, map, outLength }: StretchInput, opts: GrainOptions): Float32Array[] {
  let N = Math.round((opts.grainMs / 1000) * sampleRate);
  N = Math.max(256, Math.min(16384, N));
  N -= N % 2;
  const H = N >> 1, win = hann(N);
  const mono = mixMono(channels), len = mono.length;
  const tol = opts.search ? Math.round(N / 4) : 0;
  const jitter = Math.round(opts.flux * N * 0.5);
  const stride = Math.max(1, Math.round(N / 256));
  const outs = channels.map(() => new Float32Array(outLength));
  const wsum = new Float32Array(outLength);
  const rnd = lcg(12345);
  let prev: number | null = null;
  for (let k = 0; ; k++) {
    const oc = k * H, os = oc - H;
    if (os >= outLength) break;
    const target = Math.round(map.inputAt(oc)) - H;
    let start = target;
    if (opts.search && prev !== null) start = bestMatch(mono, prev + H, target, tol, N, stride);
    else if (jitter) start = target + Math.round((rnd() * 2 - 1) * jitter);
    const i0 = Math.max(0, -os), i1 = Math.min(N, outLength - os);
    channels.forEach((x, c) => {
      const y = outs[c];
      for (let i = i0; i < i1; i++) {
        const j = start + i;
        if (j >= 0 && j < len) y[os + i] += x[j] * win[i];
      }
    });
    for (let i = i0; i < i1; i++) wsum[os + i] += win[i];
    prev = start;
  }
  normalizeOverlap(outs, wsum);
  return outs;
}

export class TonesStretcher implements TimeStretcher<SettingsOf<'tones'>> {
  readonly shiftsPitch = false;
  stretch(input: StretchInput, s: SettingsOf<'tones'>): Float32Array[] {
    return grainStretch(input, { grainMs: s.grainMs, search: true, flux: 0 });
  }
}

export class TextureStretcher implements TimeStretcher<SettingsOf<'texture'>> {
  readonly shiftsPitch = false;
  stretch(input: StretchInput, s: SettingsOf<'texture'>): Float32Array[] {
    return grainStretch(input, { grainMs: s.grainMs, search: false, flux: s.flux });
  }
}
