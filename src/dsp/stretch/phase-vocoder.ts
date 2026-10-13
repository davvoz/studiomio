import { Fft, joinPair, splitPair } from '../fft';
import { hann, mixMono, normalizeOverlap, princarg, readFrame } from '../signal';
import type { Samples } from '../types';
import type { StretchInput, TimeStretcher, SettingsOf } from './stretcher';

/** Sopra i 60 kHz la FFT raddoppia, così la risoluzione in Hz resta la stessa. */
export const pvFftSize = (sampleRate: number, base: number): number => (sampleRate > 60000 ? base * 2 : base);

/** Stato di un render del phase vocoder: buffer riusati da un frame all'altro. */
class PhaseVocoder {
  private readonly N: number;
  private readonly H: number;
  private readonly nb: number;
  private readonly fft: Fft;
  private readonly win: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  // spettro del mid nel frame corrente (m) e in quello di H campioni prima (p)
  private readonly mr: Float64Array; private readonly mi: Float64Array;
  private readonly pr: Float64Array; private readonly pi: Float64Array;
  private readonly mag: Float64Array;
  private readonly ph: Float64Array;
  /** Fase di sintesi accumulata. */
  private readonly syn: Float64Array;
  private readonly peaks: Int32Array;
  private readonly ar: Float64Array; private readonly ai: Float64Array;
  private readonly br: Float64Array; private readonly bi: Float64Array;
  private readonly omegaH: Float64Array;
  /** Rotazione da applicare a ogni bin, e^{i(syn - ph)}: calcolata una volta per frame. */
  private readonly rotRe: Float64Array;
  private readonly rotIm: Float64Array;

  constructor(N: number) {
    this.N = N;
    this.H = N >> 2;
    this.nb = (N >> 1) + 1;
    this.fft = Fft.of(N);
    this.win = hann(N);
    const f64 = (n: number) => new Float64Array(n);
    this.re = f64(N); this.im = f64(N);
    const nb = this.nb;
    this.mr = f64(nb); this.mi = f64(nb); this.pr = f64(nb); this.pi = f64(nb);
    this.mag = f64(nb); this.ph = f64(nb); this.syn = f64(nb);
    this.peaks = new Int32Array(nb);
    this.ar = f64(nb); this.ai = f64(nb); this.br = f64(nb); this.bi = f64(nb);
    this.omegaH = f64(nb);
    this.rotRe = f64(nb); this.rotIm = f64(nb);
    for (let k = 0; k < nb; k++) this.omegaH[k] = (2 * Math.PI * k * this.H) / N;
  }

  run({ channels, map, outLength }: StretchInput, transients: readonly number[] | null): Float32Array[] {
    const { N, H, win } = this;
    const h = N >> 1;
    const mono = mixMono(channels);
    const outs = channels.map(() => new Float32Array(outLength));
    const wsum = new Float32Array(outLength);
    const trans = transients && transients.length ? transients : null;
    let ti = 0, first = true;

    for (let f = 0; ; f++) {
      const oc = f * H, os = oc - h;
      if (os >= outLength) break;
      const ic = map.inputAt(oc), a = Math.round(ic) - h;
      const maxMag = this.analyzeMid(mono, a);

      let reset = first;
      if (trans) {
        while (ti < trans.length && trans[ti] <= ic) { if (!first) reset = true; ti++; }
      }
      if (reset) this.syn.set(this.ph);
      else this.advancePhase(maxMag);
      this.updateRotation();

      for (let c = 0; c < channels.length; c += 2) {
        this.synthesizePair(channels, c, a, outs, os, outLength);
      }
      const i0 = Math.max(0, -os), i1 = Math.min(N, outLength - os);
      for (let i = i0; i < i1; i++) wsum[os + i] += win[i] * win[i];
      first = false;
    }
    normalizeOverlap(outs, wsum);
    return outs;
  }

  /** Spettro del mid nel frame corrente e in quello precedente, con una sola FFT. */
  private analyzeMid(mono: Samples, a: number): number {
    const { re, im, mr, mi, mag, ph, nb } = this;
    readFrame(mono, a, this.win, re);
    readFrame(mono, a - this.H, this.win, im);
    this.fft.forward(re, im);
    splitPair(re, im, mr, mi, this.pr, this.pi);
    let maxMag = 0;
    for (let k = 0; k < nb; k++) {
      mag[k] = Math.sqrt(mr[k] * mr[k] + mi[k] * mi[k]);
      ph[k] = Math.atan2(mi[k], mr[k]);
      if (mag[k] > maxMag) maxMag = mag[k];
    }
    return maxMag;
  }

  /** Avanza la fase di sintesi con il phase locking di Laroche-Dolson: i picchi seguono
   *  la propria frequenza istantanea, i bin vicini restano agganciati al loro picco. */
  private advancePhase(maxMag: number): void {
    const { mag, ph, syn, peaks, omegaH, pr, pi, nb } = this;
    const dev = (k: number) => princarg(ph[k] - Math.atan2(pi[k], pr[k]) - omegaH[k]);
    let np = 0;
    const thr = maxMag * 1e-6;
    for (let k = 2; k < nb - 2; k++) {
      const m = mag[k];
      if (m > thr && m > mag[k - 1] && m >= mag[k + 1] && m > mag[k - 2] && m >= mag[k + 2]) peaks[np++] = k;
    }
    if (np === 0) {
      for (let k = 0; k < nb; k++) syn[k] += omegaH[k] + dev(k);
      return;
    }
    for (let j = 0; j < np; j++) {
      const p = peaks[j];
      syn[p] = princarg(syn[p] + omegaH[p] + dev(p));
    }
    let start = 0;
    for (let j = 0; j < np; j++) {
      const p = peaks[j];
      let end = nb;
      if (j < np - 1) {
        const q = peaks[j + 1];
        end = p + 1;
        for (let k = p + 1; k < q; k++) if (mag[k] < mag[end]) end = k;
      }
      for (let k = start; k < end; k++) if (k !== p) syn[k] = syn[p] + ph[k] - ph[p];
      start = end;
    }
  }

  private updateRotation(): void {
    const { syn, ph, rotRe, rotIm, nb } = this;
    for (let k = 0; k < nb; k++) {
      const d = syn[k] - ph[k];
      rotRe[k] = Math.cos(d);
      rotIm[k] = Math.sin(d);
    }
  }

  /** Un canale deve suonare col suo modulo e fase syn + (fase del canale − fase del mid):
   *  basta ruotare ogni bin di e^{i(syn − ph)}, senza atan2/hypot/sin/cos per canale.
   *  In mono il canale è il mid, quindi la fase risulta proprio syn. */
  private rotate(xr: Float64Array, xi: Float64Array): void {
    const { rotRe, rotIm, nb } = this;
    for (let k = 0; k < nb; k++) {
      const a = xr[k], b = xi[k];
      xr[k] = a * rotRe[k] - b * rotIm[k];
      xi[k] = a * rotIm[k] + b * rotRe[k];
    }
  }

  /** Sintesi dei canali c e c+1 con una sola FFT diretta e una inversa. La fase stereo
   *  resta coerente: ogni canale conserva la sua differenza di fase rispetto al mid. */
  private synthesizePair(
    channels: readonly Float32Array[], c: number, a: number,
    outs: Float32Array[], os: number, outLength: number,
  ): void {
    const { re, im, ar, ai, br, bi, win, N } = this;
    const two = c + 1 < channels.length;
    readFrame(channels[c], a, win, re);
    if (two) readFrame(channels[c + 1], a, win, im); else im.fill(0);
    this.fft.forward(re, im);
    splitPair(re, im, ar, ai, br, bi);
    this.rotate(ar, ai);
    if (two) this.rotate(br, bi);
    joinPair(ar, ai, two ? br : null, two ? bi : null, re, im);
    this.fft.inverse(re, im);
    const y0 = outs[c], y1 = two ? outs[c + 1] : null;
    const i0 = Math.max(0, -os), i1 = Math.min(N, outLength - os);
    for (let i = i0; i < i1; i++) {
      y0[os + i] += re[i] * win[i];
      if (y1) y1[os + i] += im[i] * win[i];
    }
  }
}

/** Complex: phase vocoder con phase locking, fase stereo coerente e reset sui transienti. */
export class ComplexStretcher implements TimeStretcher<SettingsOf<'complex'>> {
  readonly shiftsPitch = false;

  stretch(input: StretchInput, s: SettingsOf<'complex'>): Float32Array[] {
    return new PhaseVocoder(pvFftSize(input.sampleRate, s.fftSize)).run(input, s.transients);
  }
}
