import type { Channels, Samples } from './types';

const windows = new Map<number, Float64Array>();

/** Finestra di Hann periodica (memorizzata: per ogni dimensione è sempre la stessa). */
export function hann(n: number): Float64Array {
  let w = windows.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    windows.set(n, w);
  }
  return w;
}

export function mixMono(channels: Channels): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length, m = new Float32Array(n), g = 1 / channels.length;
  for (const c of channels) for (let i = 0; i < n; i++) m[i] += c[i] * g;
  return m;
}

/** Copia in `dst` il frame che parte da `start`, moltiplicato per la finestra (zeri fuori). */
export function readFrame(x: Samples, start: number, win: Float64Array, dst: Float64Array): void {
  const n = win.length, len = x.length;
  if (start >= 0 && start + n <= len) {
    for (let i = 0; i < n; i++) dst[i] = x[start + i] * win[i];
  } else {
    for (let i = 0; i < n; i++) {
      const j = start + i;
      dst[i] = j >= 0 && j < len ? x[j] * win[i] : 0;
    }
  }
}

/** Fase riportata in [-π, π]. */
export const princarg = (p: number): number => p - 2 * Math.PI * Math.round(p / (2 * Math.PI));

export const sampleAt = (x: Samples, i: number): number => (i >= 0 && i < x.length ? x[i] : 0);

/** Interpolazione cubica di Hermite. */
export function readCubic(x: Samples, pos: number): number {
  const i = Math.floor(pos), f = pos - i;
  const xm1 = sampleAt(x, i - 1), x0 = sampleAt(x, i), x1 = sampleAt(x, i + 1), x2 = sampleAt(x, i + 2);
  const c1 = 0.5 * (x1 - xm1);
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
}

/** Passa-basso FIR (sinc finestrata Blackman); cutoff in frazione di Nyquist. */
export function lowpass(x: Samples, cutoff: number): Float32Array {
  const half = 16, taps = 2 * half + 1, h = new Float64Array(taps);
  let sum = 0;
  for (let k = 0; k < taps; k++) {
    const m = k - half;
    const s = m === 0 ? cutoff : Math.sin(Math.PI * cutoff * m) / (Math.PI * m);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * k) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * k) / (taps - 1));
    h[k] = s * w;
    sum += h[k];
  }
  for (let k = 0; k < taps; k++) h[k] /= sum;
  const n = x.length, y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    if (i >= half && i < n - half) {
      for (let k = 0; k < taps; k++) acc += h[k] * x[i + k - half];
    } else {
      for (let k = 0; k < taps; k++) acc += h[k] * sampleAt(x, i + k - half);
    }
    y[i] = acc;
  }
  return y;
}

/** Ricampiona leggendo l'ingresso a velocità `factor` (>1 = più acuto e più corto). */
export function resample(channels: Channels, factor: number, outLength: number): Float32Array[] {
  return channels.map(x => {
    const src = factor > 1.001 ? lowpass(x, 0.95 / factor) : x;
    const y = new Float32Array(outLength);
    for (let n = 0; n < outLength; n++) y[n] = readCubic(src, n * factor);
    return y;
  });
}

/** Overlap-add normalizzato: divide ogni canale per la somma delle finestre. */
export function normalizeOverlap(outs: readonly Float32Array[], wsum: Float32Array): void {
  for (const y of outs) for (let i = 0; i < y.length; i++) if (wsum[i] > 1e-3) y[i] /= wsum[i];
}
