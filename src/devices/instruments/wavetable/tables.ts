/* Wavetable's wavetables, generated here (no files): each is a row of FRAMES
 * one-period waveforms, and the position moves from one to the other. Each shape is stored in
 * LEVELS versions, one per octave, with fewer and fewer harmonics (like a texture's mipmaps):
 * a note plays the version that has nothing above Nyquist, so even high notes don't
 * fold back into aliasing. The versions are born from the shape's spectrum (FFT), removing the
 * excess harmonics. Pure data: the engine in the AudioWorklet and the panel's drawing use them. */
import { Fft } from '../../../dsp/fft';

/** Samples per period. */
export const TABLE_SIZE = 2048;
/** Shapes per table: the position goes from the first (0 %) to the last (100 %). */
export const FRAMES = 16;
/** Versions per octave: version `l` has up to `maxHarmonic(l)` harmonics (1023, 512 … 1). */
export const LEVELS = 11;
/** A shape of a version takes TABLE_SIZE + 1 samples: the last repeats the first, so
 *  the interpolation doesn't have to go back to the start. */
export const STRIDE = TABLE_SIZE + 1;

export const maxHarmonic = (level: number): number => Math.min(TABLE_SIZE / 2 - 1, (TABLE_SIZE / 2) >> level);

/** The version to play with a phase step `dt` (frequency / sample rate):
 *  the richest whose highest harmonic stays below Nyquist. */
export function levelFor(dt: number): number {
  const h = 0.5 / Math.max(dt, 1e-9);
  let level = 0;
  while (level < LEVELS - 1 && maxHarmonic(level) > h) level++;
  return level;
}

/** A table: the shapes as a function of time (t in [0, 1), one period) or as amplitudes
 *  of the sine harmonics (k from 1), for the position p in [0, 1]. */
type Shape =
  | { readonly time: (t: number, p: number) => number }
  | { readonly harmonics: (k: number, p: number) => number };

const TAU = 2 * Math.PI;
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;
/** The classic shapes, all in phase with sin(2πt) so they blend into each other without holes. */
const sine = (t: number) => Math.sin(TAU * t);
const triangle = (t: number) => (t < 0.25 ? 4 * t : t < 0.75 ? 2 - 4 * t : 4 * t - 4);
const saw = (t: number) => (t === 0 ? 0 : 1 - 2 * t);
const square = (t: number) => (t === 0 || t === 0.5 ? 0 : t < 0.5 ? 1 : -1);

/** The vowels A E I O U: three formants (Hz, dB), as in Neuro. */
const VOWELS: readonly (readonly (readonly [hz: number, db: number])[])[] = [
  [[780, 0], [1150, -4], [2800, -14]],
  [[420, 0], [1650, -9], [2650, -13]],
  [[290, 0], [2050, -12], [2950, -17]],
  [[460, 0], [820, -5], [2800, -20]],
  [[330, 0], [700, -10], [2500, -24]],
];
const FORMANT_WIDTH = [90, 110, 170];
/** The vowels are designed for this fundamental: playing higher they rise with the note. */
const VOWEL_F0 = 110;
/** The organ drawbars: harmonics 1, 2, 3, 4, 6, 8, 5, 10, 12 in the order they open. */
const DRAWBARS = [1, 2, 3, 4, 6, 8, 5, 10, 12];

const vowelLevel = (k: number, p: number) => {
  const x = p * (VOWELS.length - 1), i = Math.min(VOWELS.length - 2, Math.floor(x)), f = x - i, hz = k * VOWEL_F0;
  let a = 0;
  for (let j = 0; j < 3; j++) {
    const center = lerp(VOWELS[i][j][0], VOWELS[i + 1][j][0], f), db = lerp(VOWELS[i][j][1], VOWELS[i + 1][j][1], f);
    a += Math.pow(10, db / 20) / (1 + ((hz - center) / FORMANT_WIDTH[j]) ** 2);
  }
  // a thread of fundamental and body, so the note stays recognizable
  return a + 0.25 / k;
};

/** The tables, in the order of the options. */
export const TABLES: readonly { readonly name: string; readonly shape: Shape }[] = [
  {
    // sine → triangle → sawtooth → square
    name: 'Basic',
    shape: {
      time: (t, p) => {
        const x = p * 3, i = Math.min(2, Math.floor(x)), f = x - i, shapes = [sine, triangle, saw, square];
        return lerp(shapes[i](t), shapes[i + 1](t), f);
      },
    },
  },
  // pulse from 50 % (square) to 4 %, without DC
  { name: 'PWM', shape: { time: (t, p) => { const w = lerp(0.5, 0.04, p); return (t < w ? 1 : -1) - (2 * w - 1); } } },
  // a saw with the filter opening: from 1 to 512 harmonics
  { name: 'Harmonics', shape: { harmonics: (k, p) => (1 / k) / (1 + (k / Math.pow(2, p * 9)) ** 4) } },
  // the "sync": a saw restarting at every period, from 1 to 8 times faster
  { name: 'Sync', shape: { time: (t, p) => { const r = 1 + 7 * p; return 1 - 2 * ((t * r) % 1); } } },
  // a sine folded over itself more and more (wavefolder)
  { name: 'Fold', shape: { time: (t, p) => Math.sin((Math.PI / 2) * sine(t) * (1 + 7 * p)) } },
  // two-operator FM, ratio 1: index from 0 to 6
  { name: 'FM', shape: { time: (t, p) => Math.sin(TAU * t + 6 * p * sine(t)) } },
  // the vowels A E I O U
  { name: 'Vocal', shape: { harmonics: vowelLevel } },
  // the drawbars opening one after the other
  {
    name: 'Organ',
    shape: {
      harmonics: (k, p) => {
        const i = DRAWBARS.indexOf(k);
        return i < 0 ? 0 : Math.max(0, Math.min(1, p * DRAWBARS.length - i + 1)) * (i ? 0.7 : 1);
      },
    },
  },
  // a stepped sine, with bigger and bigger steps (resolution and bit reduction)
  {
    name: 'Digital',
    shape: {
      time: (t, p) => {
        const steps = Math.round(Math.pow(2, lerp(7, 2, p))), levels = Math.pow(2, lerp(6, 1, p));
        return Math.round(sine((Math.floor(t * steps) + 0.5) / steps) * levels) / levels;
      },
    },
  },
  // a resonance peak rising along the harmonics, from the first to the sixty-fourth
  {
    name: 'Formants',
    shape: {
      harmonics: (k, p) => {
        const center = Math.pow(2, p * 6), width = 0.6 + center * 0.18;
        return 0.15 / k + 1 / Math.pow(k, 0.3) / (1 + ((k - center) / width) ** 2);
      },
    },
  },
  // square (odd only) → saw → almost only even, an octave up
  {
    name: 'Spectral',
    shape: {
      harmonics: (k, p) => {
        if (k === 1) return 1;
        const odd = p < 0.5 ? 1 : 1 - (p - 0.5) * 1.9, even = p < 0.5 ? 2 * p : 1;
        return (k % 2 ? odd : even) / k;
      },
    },
  },
  // all harmonics equal, more and more of them (from 1 to 64): a hum opening up
  { name: 'Additive', shape: { harmonics: (k, p) => (k <= Math.round(Math.pow(2, p * 6)) ? 1 / Math.sqrt(k) : 0) } },
  // a flash of sine shorter and faster and faster, then silence
  {
    name: 'Pulsar',
    shape: {
      time: (t, p) => {
        const duty = lerp(1, 0.15, p);
        if (t >= duty) return 0;
        const x = t / duty;
        return Math.sin(TAU * x * (1 + 4 * p)) * Math.sin(Math.PI * x);
      },
    },
  },
  // FM at ratio 2 folded: the basses' growl
  {
    name: 'Growl',
    shape: { time: (t, p) => Math.sin((Math.PI / 2) * Math.sin(TAU * t + 5 * p * Math.sin(2 * TAU * t)) * (1 + 2.5 * p)) },
  },
  // notches moving through the spectrum, like a comb: metallic sound
  { name: 'Metal', shape: { harmonics: (k, p) => Math.abs(Math.sin(k * (0.3 + 2.7 * p))) ** 3 / Math.sqrt(k) } },
  // a sine saturated more and more, up to the square
  { name: 'Warm sine', shape: { time: (t, p) => { const d = 1 + 15 * p * p; return Math.tanh(sine(t) * d) / Math.tanh(d); } } },
  // the saw with its octaves above coming in
  { name: 'Octaves', shape: { time: (t, p) => saw(t) + 0.7 * p * saw((2 * t) % 1) + 0.5 * p * p * saw((4 * t) % 1) } },
];

export const TABLE_NAMES = TABLES.map(t => t.name);

/** All the versions of all the shapes: shape `f` at version `l` starts at
 *  `(f * LEVELS + l) * STRIDE`. */
export type Wavetable = Float32Array;

const cache = new Map<number, Wavetable>();

/** The tables are computed the first time they're needed (a few milliseconds) and stay. */
export function wavetable(index: number): Wavetable {
  const i = Math.max(0, Math.min(TABLES.length - 1, Math.round(index)));
  let w = cache.get(i);
  if (!w) cache.set(i, (w = build(TABLES[i].shape)));
  return w;
}

function build(shape: Shape): Wavetable {
  const n = TABLE_SIZE;
  return buildFrames(FRAMES, (f, re, im, fft) => {
    const p = f / (FRAMES - 1);
    if ('time' in shape) {
      for (let i = 0; i < n; i++) re[i] = shape.time(i / n, p);
      fft.forward(re, im);
    } else {
      // sine of amplitude a: −i·a·n/2 on the harmonic, the conjugate on its mirror
      for (let k = 1; k < n / 2; k++) {
        const a = shape.harmonics(k, p);
        im[k] = (-a * n) / 2;
        im[n - k] = (a * n) / 2;
      }
    }
  });
}

/** At most this many shapes in an imported table (the others are skipped, taken at intervals). */
export const MAX_IMPORTED_FRAMES = 64;

/** A table from ready-made shapes (e.g. a WAV file with one period every TABLE_SIZE samples):
 *  each shape is a period of TABLE_SIZE samples, and becomes its versions per octave like the
 *  generated tables. */
export function tableFromCycles(cycles: readonly ArrayLike<number>[]): Wavetable {
  return buildFrames(cycles.length, (f, re) => {
    const c = cycles[f];
    for (let i = 0; i < TABLE_SIZE; i++) re[i] = c[i] ?? 0;
  }, true);
}

/** The periods of a sound imported as a table: if it's a multiple of TABLE_SIZE long (the
 *  wavetable file format) one per piece; if it's shorter than a period, itself
 *  resampled; otherwise pieces taken at equal distances along the sound. At most
 *  MAX_IMPORTED_FRAMES, the channels summed. */
export function cyclesOf(channels: readonly Float32Array[]): Float32Array[] {
  const length = channels[0]?.length ?? 0;
  if (!length) return [];
  const mono = new Float32Array(length);
  for (const ch of channels) for (let i = 0; i < length; i++) mono[i] += ch[i] / channels.length;
  if (length <= TABLE_SIZE) {
    // a single period, stretched (linear interpolation, closed on the first sample)
    const out = new Float32Array(TABLE_SIZE);
    for (let i = 0; i < TABLE_SIZE; i++) {
      const x = (i * length) / TABLE_SIZE, j = Math.floor(x), t = x - j;
      out[i] = mono[j] + ((mono[(j + 1) % length] ?? 0) - mono[j]) * t;
    }
    return [out];
  }
  const whole = Math.floor(length / TABLE_SIZE);
  const exact = length % TABLE_SIZE === 0;
  const count = Math.min(MAX_IMPORTED_FRAMES, exact ? whole : Math.min(whole, 32));
  const out: Float32Array[] = [];
  for (let f = 0; f < count; f++) {
    // in whole pieces (wavetable format) or at equal distances along the whole sound
    const index = exact ? Math.round((f * (whole - 1)) / Math.max(1, count - 1)) * TABLE_SIZE
      : Math.round((f * (length - TABLE_SIZE)) / Math.max(1, count - 1));
    out.push(mono.slice(index, index + TABLE_SIZE));
  }
  return out;
}

/** The per-octave versions of `count` shapes: `fill` puts each shape in time (in `re`, then
 *  transforms it with `fft`) or directly as a spectrum; with `fromTime` the transform is done here. */
function buildFrames(count: number, fill: (frame: number, re: Float64Array, im: Float64Array, fft: Fft) => void, fromTime = false): Wavetable {
  const n = TABLE_SIZE, fft = Fft.of(n);
  const out = new Float32Array(Math.max(1, count) * LEVELS * STRIDE);
  const specRe = new Float64Array(n), specIm = new Float64Array(n);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let f = 0; f < count; f++) {
    specRe.fill(0);
    specIm.fill(0);
    fill(f, specRe, specIm, fft);
    if (fromTime) fft.forward(specRe, specIm);
    specRe[0] = specIm[0] = specRe[n / 2] = specIm[n / 2] = 0; // no DC or Nyquist
    let gain = 1;
    for (let l = 0; l < LEVELS; l++) {
      const h = maxHarmonic(l);
      re.fill(0);
      im.fill(0);
      for (let k = 1; k <= h; k++) {
        re[k] = specRe[k]; im[k] = specIm[k];
        re[n - k] = specRe[n - k]; im[n - k] = specIm[n - k];
      }
      fft.inverse(re, im);
      // all the versions with the richest's gain: the shape reaches ±1, and the volume
      // doesn't change going up with the notes
      if (l === 0) {
        let peak = 0;
        for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(re[i]));
        gain = peak > 1e-9 ? 1 / peak : 0;
      }
      const at = (f * LEVELS + l) * STRIDE;
      for (let i = 0; i < n; i++) out[at + i] = re[i] * gain;
      out[at + n] = out[at];
    }
  }
  return out;
}
