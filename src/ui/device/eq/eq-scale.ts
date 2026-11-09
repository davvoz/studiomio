/* Geometry of the EQ's graph: frequency horizontally (logarithmic, 20 Hz – 20 kHz), dB
 * vertically. The spectrum has its own dB scale, tilted as in DAW
 * analysers: +4.5 dB per octave around 1 kHz, so a "normal" mix looks almost flat. */
import { MAX_FREQ, MAX_GAIN, MIN_FREQ } from '../../../devices/effects/eq/eq';

/** Margin above and below the gain scale, in pixels. */
const PAD_Y = 10;
/** Spectrum scale (after the tilt), in dB. */
export const SPECTRUM_TOP = -12, SPECTRUM_BOTTOM = -96;
const TILT_DB_PER_OCTAVE = 4.5;

const LOG_SPAN = Math.log(MAX_FREQ / MIN_FREQ);

export class EqScale {
  constructor(readonly width: number, readonly height: number, readonly range: number = MAX_GAIN) {}

  freqToX(freq: number): number {
    return (this.width * Math.log(freq / MIN_FREQ)) / LOG_SPAN;
  }

  xToFreq(x: number): number {
    return MIN_FREQ * Math.exp((Math.max(0, Math.min(this.width, x)) / this.width) * LOG_SPAN);
  }

  dbToY(db: number): number {
    return this.height / 2 - (db / this.range) * (this.height / 2 - PAD_Y);
  }

  yToDb(y: number): number {
    return ((this.height / 2 - y) / (this.height / 2 - PAD_Y)) * this.range;
  }

  /** y of a spectrum value at frequency `freq` (with the tilt). */
  spectrumToY(db: number, freq: number): number {
    const tilted = db + TILT_DB_PER_OCTAVE * Math.log2(freq / 1000);
    return this.height * (1 - (tilted - SPECTRUM_BOTTOM) / (SPECTRUM_TOP - SPECTRUM_BOTTOM));
  }
}

/** Frequencies of the grid's vertical lines, with the label for the main ones. */
export const FREQ_GRID: readonly (readonly [freq: number, label: string])[] = [
  [30, ''], [40, ''], [50, '50'], [60, ''], [70, ''], [80, ''], [90, ''], [100, '100'],
  [200, '200'], [300, ''], [400, ''], [500, '500'], [600, ''], [700, ''], [800, ''], [900, ''], [1000, '1k'],
  [2000, '2k'], [3000, ''], [4000, ''], [5000, '5k'], [6000, ''], [7000, ''], [8000, ''], [9000, ''], [10000, '10k'],
  [20000, ''],
];

/** The spectrum's value for each pixel column: where a column covers several FFT bands
 *  (high frequencies) it takes the strongest, where it covers less than one (low) it interpolates.
 *  `bins` in dB, as the AnalyserNode gives them; `out` has one entry per column. */
export function spectrumColumns(bins: Float32Array, sampleRate: number, scale: EqScale, out: Float32Array): void {
  const binHz = sampleRate / (2 * bins.length);
  const columns = out.length, step = scale.width / columns;
  for (let c = 0; c < columns; c++) {
    const b0 = scale.xToFreq(c * step) / binHz, b1 = scale.xToFreq((c + 1) * step) / binHz;
    if (b1 - b0 >= 1) {
      let m = -Infinity;
      for (let b = Math.floor(b0), end = Math.min(bins.length - 1, Math.ceil(b1)); b <= end; b++) if (bins[b] > m) m = bins[b];
      out[c] = m;
    } else {
      const mid = Math.min(bins.length - 1.001, (b0 + b1) / 2);
      const i = Math.floor(mid), f = mid - i;
      out[c] = bins[i] + (bins[i + 1] - bins[i]) * f;
    }
  }
}
