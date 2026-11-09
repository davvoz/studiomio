/* The EQ's maths, shared by sound and drawing. Each band is one or more sections of a
 * state-variable filter (TPT, in Andrew Simper's form): the output is
 * m0·input + m1·band-pass + m2·low-pass, with g and k setting frequency and
 * damping. These filters are equivalent to the bilinear transform of the analogue prototypes,
 * so the frequency response is computed exactly: the drawn curve is the one you hear. */
import { BAND, BAND_TYPES, SLOPES, type EqBand } from './eq';

/** A filter section: g = tan(π·f/fs) (corrected for the shelves), k = 1/Q, and the output mix. */
export interface Section {
  readonly g: number;
  readonly k: number;
  readonly m0: number;
  readonly m1: number;
  readonly m2: number;
}

/** Quality factors of a Butterworth of order `2·stages`: cuts flat up to the frequency. */
export function butterworthQs(stages: number): number[] {
  const order = 2 * stages;
  return Array.from({ length: stages }, (_, i) => 1 / (2 * Math.cos(((2 * i + 1) * Math.PI) / (2 * order))));
}

const SQRT1_2 = Math.SQRT1_2;
const prewarp = (freq: number, sampleRate: number) => Math.tan((Math.PI * Math.min(freq, sampleRate * 0.49)) / sampleRate);

/** Sections of a cut with `stages` sections: Butterworth, with the chosen Q on the most resonant section. */
function cut(band: EqBand, sampleRate: number, mix: (k: number) => readonly [number, number, number]): Section[] {
  const qs = butterworthQs(SLOPES[band.slope]?.stages ?? 1);
  const g = prewarp(band.freq, sampleRate);
  return qs.map((q, i) => {
    const k = 1 / (i === qs.length - 1 ? q * (band.q / SQRT1_2) : q);
    const [m0, m1, m2] = mix(k);
    return { g, k, m0, m1, m2 };
  });
}

/** The sections of each band type, in the order of BAND_TYPES. */
const SHAPES: readonly ((band: EqBand, sampleRate: number) => Section[])[] = [
  /* low cut   */ (b, fs) => cut(b, fs, k => [1, -k, -1]),
  /* low shelf */ (b, fs) => {
    const A = Math.pow(10, b.gain / 40), k = 1 / b.q;
    return [{ g: prewarp(b.freq, fs) / Math.sqrt(A), k, m0: 1, m1: k * (A - 1), m2: A * A - 1 }];
  },
  /* bell      */ (b, fs) => {
    const A = Math.pow(10, b.gain / 40), k = 1 / (b.q * A);
    return [{ g: prewarp(b.freq, fs), k, m0: 1, m1: k * (A * A - 1), m2: 0 }];
  },
  /* notch     */ (b, fs) => {
    const k = 1 / b.q;
    return [{ g: prewarp(b.freq, fs), k, m0: 1, m1: -k, m2: 0 }];
  },
  /* high shelf */ (b, fs) => {
    const A = Math.pow(10, b.gain / 40), k = 1 / b.q;
    return [{ g: prewarp(b.freq, fs) * Math.sqrt(A), k, m0: A * A, m1: k * (1 - A) * A, m2: 1 - A * A }];
  },
  /* high cut  */ (b, fs) => cut(b, fs, () => [0, 0, 1]),
];

export const sectionsOf = (band: EqBand, sampleRate: number): Section[] => (SHAPES[band.type] ?? SHAPES[BAND.bell])(band, sampleRate);

/** True if the band, as it is, doesn't change the sound (shelves and bells at 0 dB). */
export const isFlat = (band: EqBand): boolean => !band.on || (!!BAND_TYPES[band.type]?.gain && band.gain === 0);

/** |H| of a section at frequency `freq`: H(s) = m0 + (m1·s + m2) / (s² + k·s + 1), s = j·tan(π·f/fs)/g. */
export function sectionMagnitude(s: Section, freq: number, sampleRate: number): number {
  const w = prewarp(freq, sampleRate) / s.g;
  const dRe = 1 - w * w, dIm = s.k * w;
  const nRe = s.m0 * dRe + s.m2, nIm = s.m0 * dIm + s.m1 * w;
  return Math.sqrt((nRe * nRe + nIm * nIm) / (dRe * dRe + dIm * dIm));
}

const toDb = (m: number) => 20 * Math.log10(Math.max(m, 1e-12));

/** Response of one band, in dB (0 if off). */
export function bandResponseDb(band: EqBand, freq: number, sampleRate: number): number {
  if (!band.on) return 0;
  return sectionsOf(band, sampleRate).reduce((db, s) => db + toDb(sectionMagnitude(s, freq, sampleRate)), 0);
}

/** Response of the whole EQ, in dB. */
export const responseDb = (bands: readonly EqBand[], outputDb: number, freq: number, sampleRate: number): number =>
  bands.reduce((db, b) => db + bandResponseDb(b, freq, sampleRate), outputDb);
