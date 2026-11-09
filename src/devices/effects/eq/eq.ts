/* "EQ": 8-band parametric equalizer, like Live's EQ Eight. Each band has a type
 * (cut, shelf, bell, notch), frequency, gain, Q and, for the cuts, the slope. Here
 * is the description; the filter maths is in eq-math.ts (used both by the sound and by the
 * drawn curve, so the curve is exactly what you hear), the sound in eq-core.ts. */
import type { DeviceType, Preset } from '../../device-type';
import type { ChoiceParam, NumberParam, ParamSection } from '../../params';

/** The band types, in the order of the parameter values. `gain`: uses the gain; `cut`: has the slope. */
export const BAND_TYPES = [
  { label: 'Low cut', gain: false, cut: true },
  { label: 'Low shelf', gain: true, cut: false },
  { label: 'Bell', gain: true, cut: false },
  { label: 'Notch', gain: false, cut: false },
  { label: 'High shelf', gain: true, cut: false },
  { label: 'High cut', gain: false, cut: true },
] as const;

/** Values of the "type" parameter. */
export const BAND = { lowCut: 0, lowShelf: 1, bell: 2, notch: 3, highShelf: 4, highCut: 5 } as const;

/** Slopes of the cuts: how many 12 dB/octave sections. */
export const SLOPES = [{ label: '12 dB', stages: 1 }, { label: '24 dB', stages: 2 }, { label: '48 dB', stages: 4 }] as const;

export const EQ_BANDS = 8;
export const MIN_FREQ = 20, MAX_FREQ = 20000;
export const MAX_GAIN = 18;

/** A band, with the values already validated. */
export interface EqBand {
  readonly on: boolean;
  readonly type: number;
  readonly freq: number;
  readonly gain: number;
  readonly q: number;
  readonly slope: number;
}

export type BandKey = keyof EqBand;

/** The id of parameter `key` of band `index` (from 0): "b1freq", "b3gain"… */
export const bandParam = (index: number, key: BandKey): string => `b${index + 1}${key}`;

/** The bands from the parameter values (complete, as resolveParams gives them). */
export const bandsOf = (values: Readonly<Record<string, number>>): EqBand[] =>
  Array.from({ length: EQ_BANDS }, (_, i) => ({
    on: values[bandParam(i, 'on')] === 1,
    type: values[bandParam(i, 'type')],
    freq: values[bandParam(i, 'freq')],
    gain: values[bandParam(i, 'gain')],
    q: values[bandParam(i, 'q')],
    slope: values[bandParam(i, 'slope')],
  }));

/** How the bands look when the EQ has just been opened: the cuts off at the extremes, in the middle
 *  flat shelves and bells (on, but at 0 dB they change nothing). */
const DEFAULT_BANDS: readonly { type: number; freq: number; on: boolean }[] = [
  { type: BAND.lowCut, freq: 30, on: false },
  { type: BAND.lowShelf, freq: 80, on: true },
  { type: BAND.bell, freq: 200, on: true },
  { type: BAND.bell, freq: 500, on: true },
  { type: BAND.bell, freq: 1500, on: true },
  { type: BAND.bell, freq: 4000, on: true },
  { type: BAND.highShelf, freq: 10000, on: true },
  { type: BAND.highCut, freq: 18000, on: false },
];

const gainTypes = BAND_TYPES.flatMap((t, i) => (t.gain ? [i] : []));
const cutTypes = BAND_TYPES.flatMap((t, i) => (t.cut ? [i] : []));

function bandSection(i: number): ParamSection {
  const d = DEFAULT_BANDS[i];
  const id = (key: BandKey) => bandParam(i, key);
  const choice = (key: BandKey, label: string, options: readonly string[], def: number, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
    ({ kind: 'choice', id: id(key), label, options, default: def, ...extra });
  const num = (key: BandKey, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
    ({ kind: 'number', id: id(key), label, min, max, default: def, unit, ...extra });
  return {
    label: `Band ${i + 1}`,
    params: [
      choice('on', 'On', ['Off', 'On'], d.on ? 1 : 0),
      choice('type', 'Type', BAND_TYPES.map(t => t.label), d.type),
      num('freq', 'Frequency', MIN_FREQ, MAX_FREQ, d.freq, 'Hz', { scale: 'log' }),
      num('gain', 'Gain', -MAX_GAIN, MAX_GAIN, 0, 'dB', { when: { param: id('type'), is: gainTypes } }),
      num('q', 'Q', 0.1, 18, 0.71, '', { scale: 'log' }),
      choice('slope', 'Slope', SLOPES.map(s => s.label), 1, { when: { param: id('type'), is: cutTypes } }),
    ],
  };
}

/** A preset written by bands: { 2: { gain: 3 } } becomes { b2gain: 3 }. */
const preset = (name: string, bands: Readonly<Record<number, Partial<Record<BandKey, number>>>>, extra: Record<string, number> = {}): Preset => ({
  name,
  params: {
    ...Object.fromEntries(Object.entries(bands).flatMap(([n, b]) =>
      Object.entries(b).map(([k, v]) => [bandParam(Number(n) - 1, k as BandKey), v]))),
    ...extra,
  },
});

export const EQ: DeviceType = {
  type: 'eq',
  label: 'EQ',
  sections: [
    ...Array.from({ length: EQ_BANDS }, (_, i) => bandSection(i)),
    { label: 'Output', params: [{ kind: 'number', id: 'output', label: 'Output', min: -MAX_GAIN, max: MAX_GAIN, default: 0, unit: 'dB' }] },
  ],
  presets: [
    preset('Init', {}),
    preset('Low clean-up', { 1: { on: 1, freq: 90 } }),
    preset('Voice', { 1: { on: 1, freq: 90 }, 3: { freq: 300, gain: -3, q: 1.2 }, 6: { freq: 3500, gain: 3, q: 0.9 }, 7: { freq: 11000, gain: 2 } }),
    preset('Present bass', { 1: { on: 1, freq: 35 }, 2: { freq: 70, gain: 3 }, 4: { freq: 400, gain: -3, q: 1.4 }, 6: { freq: 2500, gain: 2.5, q: 1.5 } }),
    preset('Telephone', { 1: { on: 1, freq: 400, slope: 2 }, 5: { freq: 1500, gain: 5, q: 1 }, 8: { on: 1, freq: 3200, slope: 2 } }),
    preset('Air', { 7: { freq: 12000, gain: 4, q: 0.7 } }),
  ],
};
