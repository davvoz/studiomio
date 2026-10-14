/* "Neuro": il synth dei bassi reese e neuro. Una voce sola (Mono o Legato, con il glide):
 * due oscillatori con l'unison per il "reese" (dente di sega scordati che battono lenti), la
 * modulazione di fase (FM) per il ringhio, il wavefolder, un filtro con la sua saturazione, il
 * filtro formante che fa "parlare" il basso (le vocali A E I O U), la distorsione finale e,
 * a parte, il sub: un seno pulito e centrato che tiene i bassi sotto il taglio, mentre tutto il
 * resto sta sopra (il basso resta definito anche con il corpo distorto e largo). Il movimento
 * viene da due LFO a tempo e da un inviluppo di modulazione, ognuno verso due destinazioni a
 * scelta (cutoff, vocale, fold, FM, pitch…), e dalle modulazioni delle clip (anche sul
 * Trasporto, per le salite e le picchiate di pitch).
 * Qui c'è solo la descrizione (parametri e preset); il suono è in neuro-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam, ParamSpec } from '../../params';
import { TEMPO_RATE as LFO_RATE, TEMPO_RATES as LFO_RATES } from '../../rates';
import { MAX_UNISON, WAVES } from '../analog/analog';

export const NEURO_VOICE_MODES = ['Mono', 'Legato'] as const;
export const NEURO_MODE = { mono: 0, legato: 1 } as const;
export const NEURO_FILTERS = ['LP 24', 'LP 12', 'Band', 'High', 'Notch'] as const;
export const FM_RATIOS = [0.5, 1, 1.5, 2, 3, 4] as const;
export const SUB_OCTAVES = [0, -1, -2] as const;

/** Dove va una modulazione: quanto sposta al massimo (con quantità 100 e modulatore a 1). */
export interface ModDestination {
  readonly label: string;
  /** Il parametro di base che la modulazione sposta (null: Nessuna). */
  readonly key: ModKey | null;
  readonly range: number;
}

/** Le grandezze che si possono modulare (vedi neuro-core.ts). */
export type ModKey = 'cutoff' | 'resonance' | 'vowel' | 'formant' | 'fold' | 'fm' | 'drive' | 'dist' | 'pitch' | 'detune' | 'volume';

/** Le destinazioni nell'ordine delle opzioni. Il cutoff si sposta in ottave, il pitch in
 *  semitoni, la scordatura in centesimi, il volume in frazione; il resto in punti percentuali
 *  della sua manopola. */
export const MOD_DESTINATIONS: readonly ModDestination[] = [
  { label: 'Nessuna', key: null, range: 0 },
  { label: 'Cutoff', key: 'cutoff', range: 5 },
  { label: 'Risonanza', key: 'resonance', range: 100 },
  { label: 'Vocale', key: 'vowel', range: 100 },
  { label: 'Formante', key: 'formant', range: 100 },
  { label: 'Fold', key: 'fold', range: 100 },
  { label: 'FM', key: 'fm', range: 100 },
  { label: 'Drive', key: 'drive', range: 100 },
  { label: 'Distorsione', key: 'dist', range: 100 },
  { label: 'Pitch', key: 'pitch', range: 24 },
  { label: 'Scordatura', key: 'detune', range: 100 },
  { label: 'Volume', key: 'volume', range: 1 },
];
export const MOD_DEST = Object.fromEntries(MOD_DESTINATIONS.map((d, i) => [d.key ?? 'none', i])) as Readonly<Record<ModKey | 'none', number>>;

export const LFO_SHAPES = ['Sine', 'Triangle', 'Saw ↓', 'Saw ↑', 'Square', 'S&H', 'S&H morbido'] as const;
export const LFO_SHAPE = { sine: 0, triangle: 1, sawDown: 2, sawUp: 3, square: 4, sampleHold: 5, smoothRandom: 6 } as const;

/** Le velocità degli LFO, in battiti per giro. */
export { TEMPO_RATES as LFO_RATES, TEMPO_RATE as LFO_RATE } from '../../rates';
export const LFO_RETRIG = ['Nota', 'Libero'] as const;

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def });
const time = (id: string, label: string, def: number) => num(id, label, 0.001, 10, def, 's', { scale: 'log' });
const percent = (id: string, label: string, def: number, min = 0) => num(id, label, min, 100, def, '%', { step: 1 });
const destinations = MOD_DESTINATIONS.map(d => d.label);

/** I controlli di un LFO (`lfo1…`, `lfo2…`). */
const lfoParams = (n: number, rate: number): ParamSpec[] => [
  choice(`lfo${n}Shape`, 'Onda', LFO_SHAPES),
  choice(`lfo${n}Rate`, 'Velocità', LFO_RATES.map(([l]) => l), rate),
  choice(`lfo${n}Retrig`, 'Ripartenza', LFO_RETRIG),
  percent(`lfo${n}Phase`, 'Fase', 0),
  choice(`lfo${n}Dest`, '→ Dove', destinations),
  percent(`lfo${n}Amount`, 'Quanto', 0, -100),
  choice(`lfo${n}Dest2`, '→ Dove 2', destinations),
  percent(`lfo${n}Amount2`, 'Quanto 2', 0, -100),
];

export const NEURO: DeviceType = {
  type: 'neuro',
  label: 'Neuro',
  sections: [
    {
      label: 'Oscillatori',
      params: [
        choice('oscA', 'Onda A', WAVES),
        choice('oscB', 'Onda B', WAVES),
        num('oscBSemi', 'B semitoni', -24, 24, 0, 'st', { step: 1 }),
        num('oscBFine', 'B fine', -50, 50, -12, 'ct', { step: 1 }),
        percent('mix', 'Mix A/B', 50),
      ],
    },
    {
      label: 'Unison',
      params: [
        num('unison', 'Copie', 1, MAX_UNISON, 3, '', { step: 1 }),
        num('detune', 'Scordatura', 0, 100, 18, 'ct', { step: 1 }),
        percent('spread', 'Apertura', 70),
      ],
    },
    {
      label: 'Forma',
      params: [
        percent('fm', 'FM', 0),
        choice('fmRatio', 'Rapporto FM', FM_RATIOS.map(r => `${r}×`), 1),
        percent('fold', 'Fold', 0),
      ],
    },
    {
      label: 'Filtro',
      params: [
        choice('filterType', 'Tipo', NEURO_FILTERS),
        num('cutoff', 'Cutoff', 20, 20000, 1200, 'Hz', { scale: 'log' }),
        percent('resonance', 'Risonanza', 25),
        percent('drive', 'Drive', 20),
        percent('keyTrack', 'Key track', 30),
      ],
    },
    {
      label: 'Formante',
      params: [
        percent('formant', 'Quanto', 0),
        percent('vowel', 'Vocale', 0),
        num('formantShift', 'Sposta', -12, 12, 0, 'st', { step: 0.1 }),
      ],
    },
    {
      label: 'Distorsione',
      params: [percent('dist', 'Quanto', 0)],
    },
    {
      label: 'Sub',
      params: [
        percent('sub', 'Livello', 70),
        choice('subOctave', 'Ottava', SUB_OCTAVES.map(o => (o ? `${o}` : '0')), 0),
        num('crossover', 'Taglio', 40, 400, 110, 'Hz', { scale: 'log', step: 1 }),
      ],
    },
    {
      label: 'Voce',
      params: [
        choice('voiceMode', 'Modo', NEURO_VOICE_MODES, NEURO_MODE.legato),
        num('glide', 'Glide', 0, 500, 40, 'ms', { step: 1 }),
        // continuo: modulato da una clip fa salite e picchiate di pitch
        num('transpose', 'Trasporto', -24, 24, 0, 'st', { step: 0.01 }),
        percent('velocity', 'Velocity', 30),
      ],
    },
    {
      label: 'Inviluppo volume',
      params: [time('attack', 'Attack', 0.002), time('decay', 'Decay', 0.4), percent('sustain', 'Sustain', 100), time('release', 'Release', 0.06)],
    },
    {
      label: 'Inviluppo mod',
      params: [
        time('mAttack', 'Attack', 0.001), time('mDecay', 'Decay', 0.25), percent('mSustain', 'Sustain', 0), time('mRelease', 'Release', 0.1),
        choice('envDest', '→ Dove', destinations),
        percent('envAmount', 'Quanto', 0, -100),
        choice('envDest2', '→ Dove 2', destinations),
        percent('envAmount2', 'Quanto 2', 0, -100),
      ],
    },
    { label: 'LFO 1', params: lfoParams(1, LFO_RATE['1/4']) },
    { label: 'LFO 2', params: lfoParams(2, LFO_RATE['1/16']) },
    { label: 'Uscita', params: [num('volume', 'Volume', -36, 6, -8, 'dB', { step: 0.5 })] },
  ],
  presets: [
    { name: 'Init', params: {} },
    {
      name: 'Reese',
      params: { unison: 3, detune: 22, oscBFine: -14, cutoff: 900, resonance: 15, drive: 30, dist: 25, sub: 70,
        lfo1Dest: MOD_DEST.cutoff, lfo1Rate: LFO_RATE['1 battuta'], lfo1Amount: 25, lfo1Retrig: 1, volume: -9 },
    },
    {
      name: 'Reese parlante',
      params: { unison: 3, detune: 20, cutoff: 1600, resonance: 20, drive: 40, formant: 80, vowel: 0, dist: 35,
        lfo1Shape: LFO_SHAPE.triangle, lfo1Rate: LFO_RATE['1/2'], lfo1Dest: MOD_DEST.vowel, lfo1Amount: 60,
        lfo2Rate: LFO_RATE['1/8T'], lfo2Dest: MOD_DEST.cutoff, lfo2Amount: 12, volume: -10 },
    },
    {
      name: 'Neuro ringhio',
      params: { unison: 2, detune: 12, oscBSemi: -12, oscBFine: 0, fm: 35, fmRatio: 3, fold: 20, cutoff: 2200, resonance: 30,
        drive: 55, formant: 55, vowel: 60, dist: 50, lfo1Shape: LFO_SHAPE.sawDown, lfo1Rate: LFO_RATE['1/8'], lfo1Dest: MOD_DEST.fm,
        lfo1Amount: 40, lfo1Dest2: MOD_DEST.vowel, lfo1Amount2: -30, volume: -11 },
    },
    {
      name: 'Colpo neuro',
      params: { unison: 3, detune: 25, fold: 30, cutoff: 500, resonance: 35, drive: 60, formant: 50, vowel: 75, dist: 45,
        decay: 0.3, sustain: 40, mDecay: 0.18, envDest: MOD_DEST.cutoff, envAmount: 70, envDest2: MOD_DEST.vowel, envAmount2: -50, volume: -10 },
    },
    {
      name: 'Sub pulito',
      params: { unison: 1, mix: 0, cutoff: 200, drive: 0, sub: 100, crossover: 400, volume: -6 },
    },
  ],
};
