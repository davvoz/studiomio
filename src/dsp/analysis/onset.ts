import { Fft, splitPair } from '../fft';
import { hann, readFrame } from '../signal';
import type { Samples } from '../types';

/** Curva di "novità" del segnale, base per transienti, tempo e beat tracking. */
export interface OnsetEnvelope {
  readonly flux: Float32Array;
  /** Campioni tra un frame e il successivo. */
  readonly hop: number;
  /** Frame al secondo. */
  readonly frameRate: number;
}

/** Spectral flux su magnitudo log-compressa, sommato per bande logaritmiche così che una
 *  cassa (pochi bin bassi) pesi quanto un piatto (centinaia di bin alti). */
export function onsetEnvelope(mono: Samples, sampleRate: number): OnsetEnvelope {
  const N = sampleRate > 60000 ? 2048 : 1024, hop = N >> 2, nb = (N >> 1) + 1;
  const fft = Fft.of(N), win = hann(N);
  const frames = Math.floor(mono.length / hop) + 1;
  const flux = new Float32Array(frames);
  const re = new Float64Array(N), im = new Float64Array(N);
  const ar = new Float64Array(nb), ai = new Float64Array(nb), br = new Float64Array(nb), bi = new Float64Array(nb);
  let prev = new Float64Array(nb), cur = new Float64Array(nb);
  const maxBin = Math.min(nb, Math.round((16000 / sampleRate) * N));
  const norm = 4 / N;
  const nBands = 12, band = new Int32Array(maxBin), bandW = new Float64Array(nBands);
  for (let k = 1; k < maxBin; k++) {
    band[k] = Math.min(nBands - 1, Math.floor((nBands * Math.log(k)) / Math.log(maxBin)));
    bandW[band[k]]++;
  }
  const acc = new Float64Array(nBands);
  const step = (xr: Float64Array, xi: Float64Array, f: number): void => {
    acc.fill(0);
    for (let k = 1; k < maxBin; k++) {
      const v = Math.log1p(100 * norm * Math.hypot(xr[k], xi[k]));
      cur[k] = v;
      const d = v - prev[k];
      if (d > 0) acc[band[k]] += d;
    }
    let s = 0;
    for (let b = 0; b < nBands; b++) if (bandW[b]) s += acc[b] / Math.sqrt(bandW[b]);
    flux[f] = f === 0 ? 0 : s;
    [prev, cur] = [cur, prev];
  };
  // Due frame per FFT: uno nella parte reale, il successivo in quella immaginaria.
  for (let f = 0; f < frames; f += 2) {
    readFrame(mono, f * hop - (N >> 1), win, re);
    readFrame(mono, (f + 1) * hop - (N >> 1), win, im);
    fft.forward(re, im);
    splitPair(re, im, ar, ai, br, bi);
    step(ar, ai, f);
    if (f + 1 < frames) step(br, bi, f + 1);
  }
  return { flux, hop, frameRate: sampleRate / hop };
}
