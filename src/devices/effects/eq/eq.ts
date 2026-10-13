/* "EQ": equalizzatore parametrico a 8 bande, come EQ Eight di Live. Ogni banda ha un tipo
 * (taglio, shelf, campana, notch), frequenza, guadagno, Q e, per i tagli, la pendenza. Qui
 * c'è la descrizione; la matematica dei filtri è in eq-math.ts (la usano sia il suono sia la
 * curva disegnata, così la curva è esattamente ciò che si sente), il suono in eq-core.ts. */
import type { DeviceType, Preset } from '../../device-type';
import type { ChoiceParam, NumberParam, ParamSection } from '../../params';

/** I tipi di banda, nell'ordine dei valori del parametro. `gain`: usa il guadagno; `cut`: ha la pendenza. */
export const BAND_TYPES = [
  { label: 'Low cut', gain: false, cut: true },
  { label: 'Low shelf', gain: true, cut: false },
  { label: 'Bell', gain: true, cut: false },
  { label: 'Notch', gain: false, cut: false },
  { label: 'High shelf', gain: true, cut: false },
  { label: 'High cut', gain: false, cut: true },
] as const;

/** Valori del parametro "tipo". */
export const BAND = { lowCut: 0, lowShelf: 1, bell: 2, notch: 3, highShelf: 4, highCut: 5 } as const;

/** Pendenze dei tagli: quante sezioni da 12 dB/ottava. */
export const SLOPES = [{ label: '12 dB', stages: 1 }, { label: '24 dB', stages: 2 }, { label: '48 dB', stages: 4 }] as const;

export const EQ_BANDS = 8;
export const MIN_FREQ = 20, MAX_FREQ = 20000;
export const MAX_GAIN = 18;

/** Una banda, con i valori già validati. */
export interface EqBand {
  readonly on: boolean;
  readonly type: number;
  readonly freq: number;
  readonly gain: number;
  readonly q: number;
  readonly slope: number;
}

export type BandKey = keyof EqBand;

/** L'id del parametro `key` della banda `index` (da 0): "b1freq", "b3gain"… */
export const bandParam = (index: number, key: BandKey): string => `b${index + 1}${key}`;

/** Le bande dai valori dei parametri (completi, come li dà resolveParams). */
export const bandsOf = (values: Readonly<Record<string, number>>): EqBand[] =>
  Array.from({ length: EQ_BANDS }, (_, i) => ({
    on: values[bandParam(i, 'on')] === 1,
    type: values[bandParam(i, 'type')],
    freq: values[bandParam(i, 'freq')],
    gain: values[bandParam(i, 'gain')],
    q: values[bandParam(i, 'q')],
    slope: values[bandParam(i, 'slope')],
  }));

/** Come si presentano le bande appena aperto l'EQ: i tagli spenti agli estremi, in mezzo
 *  shelf e campane piatte (accese, ma a 0 dB non cambiano nulla). */
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
    label: `Banda ${i + 1}`,
    params: [
      choice('on', 'Accesa', ['Off', 'On'], d.on ? 1 : 0),
      choice('type', 'Tipo', BAND_TYPES.map(t => t.label), d.type),
      num('freq', 'Frequenza', MIN_FREQ, MAX_FREQ, d.freq, 'Hz', { scale: 'log' }),
      num('gain', 'Guadagno', -MAX_GAIN, MAX_GAIN, 0, 'dB', { when: { param: id('type'), is: gainTypes } }),
      num('q', 'Q', 0.1, 18, 0.71, '', { scale: 'log' }),
      choice('slope', 'Pendenza', SLOPES.map(s => s.label), 1, { when: { param: id('type'), is: cutTypes } }),
    ],
  };
}

/** Un preset scritto per bande: { 2: { gain: 3 } } diventa { b2gain: 3 }. */
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
    { label: 'Uscita', params: [{ kind: 'number', id: 'output', label: 'Uscita', min: -MAX_GAIN, max: MAX_GAIN, default: 0, unit: 'dB' }] },
  ],
  presets: [
    preset('Init', {}),
    preset('Pulizia bassi', { 1: { on: 1, freq: 90 } }),
    preset('Voce', { 1: { on: 1, freq: 90 }, 3: { freq: 300, gain: -3, q: 1.2 }, 6: { freq: 3500, gain: 3, q: 0.9 }, 7: { freq: 11000, gain: 2 } }),
    preset('Basso presente', { 1: { on: 1, freq: 35 }, 2: { freq: 70, gain: 3 }, 4: { freq: 400, gain: -3, q: 1.4 }, 6: { freq: 2500, gain: 2.5, q: 1.5 } }),
    preset('Telefono', { 1: { on: 1, freq: 400, slope: 2 }, 5: { freq: 1500, gain: 5, q: 1 }, 8: { on: 1, freq: 3200, slope: 2 } }),
    preset('Aria', { 7: { freq: 12000, gain: 4, q: 0.7 } }),
  ],
};
