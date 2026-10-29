/* "Wavetable": synth a tabelle d'onda, come Wavetable di Live. Due oscillatori leggono
 * ognuno una tabella (una fila di forme d'onda: Base, PWM, Armoniche, Sync, Fold, FM, Vocale,
 * Organo, Digitale) e la Posizione sceglie dove leggerla, sfumando fra una forma e l'altra:
 * muovendola con l'inviluppo di modulazione o con gli LFO il timbro cambia mentre la nota suona.
 * Poi un sub, l'unison (con le copie che leggono anche posizioni diverse), il filtro, gli
 * inviluppi e due LFO, ognuno verso una destinazione a scelta. Polifonico (16 voci) o a una
 * voce, con il glide. Qui c'è solo la descrizione (parametri e preset); le tabelle sono in
 * tables.ts, il suono in wavetable-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam, ParamSpec } from '../../params';
import { TEMPO_RATE, TEMPO_RATES } from '../../rates';
import { FILTER_TYPES, LFO_SYNC, MAX_UNISON, VOICE_MODE, VOICE_MODES } from '../analog/analog';
import { TABLE_NAMES } from './tables';

/** Le tabelle, per nome (l'indice dell'opzione). */
export const TABLE = Object.fromEntries(TABLE_NAMES.map((n, i) => [n, i])) as Readonly<Record<string, number>>;

/** Dove va una modulazione: quanto sposta al massimo (con quantità 100 e modulatore a 1). */
export interface ModDestination {
  readonly label: string;
  readonly key: ModKey | null;
  readonly range: number;
}

export type ModKey = 'posA' | 'posB' | 'pos' | 'cutoff' | 'resonance' | 'pitch' | 'levelB' | 'volume';

/** Le destinazioni nell'ordine delle opzioni. Le posizioni e il livello di B si spostano in
 *  frazione della loro manopola, il cutoff in ottave, il pitch in semitoni, il volume in
 *  frazione del suo valore. */
export const MOD_DESTINATIONS: readonly ModDestination[] = [
  { label: 'Nessuna', key: null, range: 0 },
  { label: 'Posizione A', key: 'posA', range: 1 },
  { label: 'Posizione B', key: 'posB', range: 1 },
  { label: 'Posizioni A+B', key: 'pos', range: 1 },
  { label: 'Cutoff', key: 'cutoff', range: 5 },
  { label: 'Risonanza', key: 'resonance', range: 1 },
  { label: 'Pitch', key: 'pitch', range: 24 },
  { label: 'Livello B', key: 'levelB', range: 1 },
  { label: 'Volume', key: 'volume', range: 1 },
];
export const MOD_DEST = Object.fromEntries(MOD_DESTINATIONS.map((d, i) => [d.key ?? 'none', i])) as Readonly<Record<ModKey | 'none', number>>;

export const LFO_SHAPES = ['Sine', 'Triangle', 'Saw ↓', 'Saw ↑', 'Square', 'S&H'] as const;
export const LFO_SHAPE = { sine: 0, triangle: 1, sawDown: 2, sawUp: 3, square: 4, sampleHold: 5 } as const;
/** Nota: l'LFO riparte a ogni nota. Libero: tutte le voci seguono lo stesso giro. */
export const LFO_RETRIG = ['Nota', 'Libero'] as const;
export { LFO_SYNC, VOICE_MODE };

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const time = (id: string, label: string, def: number) => num(id, label, 0.001, 10, def, 's', { scale: 'log' });
const percent = (id: string, label: string, def: number, min = 0) => num(id, label, min, 100, def, '%', { step: 1 });
const destinations = MOD_DESTINATIONS.map(d => d.label);
const unisonOn = { param: 'unison', is: [2, 3, 4, 5, 6, 7] };

/** I controlli di un oscillatore (`…A`, `…B`). */
const oscParams = (o: 'A' | 'B', table: number, level: number): ParamSpec[] => [
  choice(`table${o}`, 'Tabella', TABLE_NAMES, table),
  percent(`pos${o}`, 'Posizione', 0),
  num(`semi${o}`, 'Semitoni', -24, 24, 0, 'st', { step: 1 }),
  num(`fine${o}`, 'Fine', -50, 50, 0, 'ct', { step: 1 }),
  percent(`level${o}`, 'Livello', level),
];

/** I controlli di un LFO (`lfo1…`, `lfo2…`). */
const lfoParams = (n: number, division: number): ParamSpec[] => [
  choice(`lfo${n}Shape`, 'Onda', LFO_SHAPES),
  choice(`lfo${n}Sync`, 'Sincro', ['Tempo', 'Hz'], LFO_SYNC.tempo),
  choice(`lfo${n}Division`, 'Divisione', TEMPO_RATES.map(([l]) => l), division, { when: { param: `lfo${n}Sync`, is: LFO_SYNC.tempo } }),
  num(`lfo${n}Rate`, 'Velocità', 0.05, 20, 2, 'Hz', { scale: 'log', when: { param: `lfo${n}Sync`, is: LFO_SYNC.hz } }),
  choice(`lfo${n}Retrig`, 'Ripartenza', LFO_RETRIG),
  choice(`lfo${n}Dest`, '→ Dove', destinations),
  percent(`lfo${n}Amount`, 'Quanto', 0, -100),
];

export const WAVETABLE: DeviceType = {
  type: 'wavetable',
  label: 'Wavetable',
  sections: [
    { label: 'Oscillatore A', params: oscParams('A', TABLE.Base, 100) },
    { label: 'Oscillatore B', params: oscParams('B', TABLE.Armoniche, 0) },
    { label: 'Sub', params: [percent('sub', 'Livello', 0), choice('subOctave', 'Ottava', ['-1', '-2'])] },
    {
      label: 'Unison',
      params: [
        num('unison', 'Copie', 1, MAX_UNISON, 1, '', { step: 1 }),
        num('detune', 'Scordatura', 0, 100, 20, 'ct', { step: 1, when: unisonOn }),
        { ...percent('spread', 'Apertura', 70), when: unisonOn },
        { ...percent('posSpread', 'Posizioni', 0), when: unisonOn },
      ],
    },
    {
      label: 'Filtro',
      params: [
        choice('filterType', 'Tipo', FILTER_TYPES),
        num('cutoff', 'Cutoff', 20, 20000, 20000, 'Hz', { scale: 'log' }),
        percent('resonance', 'Risonanza', 0),
        percent('keyTrack', 'Key track', 0),
      ],
    },
    {
      label: 'Voce',
      params: [
        choice('voiceMode', 'Modo', VOICE_MODES),
        num('glide', 'Glide', 0, 500, 0, 'ms', { step: 1, when: { param: 'voiceMode', is: [VOICE_MODE.mono, VOICE_MODE.legato] } }),
        percent('velocity', 'Velocity', 50),
      ],
    },
    {
      label: 'Inviluppo volume',
      params: [time('attack', 'Attack', 0.003), time('decay', 'Decay', 0.5), percent('sustain', 'Sustain', 80), time('release', 'Release', 0.25)],
    },
    {
      label: 'Inviluppo mod',
      params: [
        time('mAttack', 'Attack', 0.003), time('mDecay', 'Decay', 0.6), percent('mSustain', 'Sustain', 0), time('mRelease', 'Release', 0.3),
        choice('envDest', '→ Dove', destinations, MOD_DEST.posA),
        percent('envAmount', 'Quanto', 0, -100),
        choice('envDest2', '→ Dove 2', destinations, MOD_DEST.cutoff),
        percent('envAmount2', 'Quanto 2', 0, -100),
      ],
    },
    { label: 'LFO 1', params: lfoParams(1, TEMPO_RATE['1 battuta']) },
    { label: 'LFO 2', params: lfoParams(2, TEMPO_RATE['1/8']) },
    { label: 'Uscita', params: [num('volume', 'Volume', -36, 6, -10, 'dB', { step: 0.5 })] },
  ],
  presets: [
    { name: 'Init', params: {} },
    {
      name: 'Pad che respira',
      params: { tableA: TABLE.Vocale, posA: 10, tableB: TABLE.Armoniche, posB: 40, levelB: 45, fineB: 7, unison: 4, detune: 18, spread: 90, posSpread: 25,
        cutoff: 6000, attack: 0.9, decay: 1.5, sustain: 85, release: 2, lfo1Sync: LFO_SYNC.tempo, lfo1Division: TEMPO_RATE['4 battute'],
        lfo1Retrig: 1, lfo1Dest: MOD_DEST.posA, lfo1Amount: 70, lfo2Shape: LFO_SHAPE.triangle, lfo2Division: TEMPO_RATE['2 battute'],
        lfo2Retrig: 1, lfo2Dest: MOD_DEST.posB, lfo2Amount: 50, velocity: 30, volume: -12 },
    },
    {
      name: 'Pluck digitale',
      params: { tableA: TABLE.Digitale, posA: 0, tableB: TABLE.FM, posB: 20, levelB: 50, semiB: 12, cutoff: 9000, decay: 0.35, sustain: 0, release: 0.3,
        mDecay: 0.25, envDest: MOD_DEST.pos, envAmount: 80, envDest2: MOD_DEST.cutoff, envAmount2: 30, volume: -11 },
    },
    {
      name: 'Basso sync',
      params: { tableA: TABLE.Sync, posA: 15, sub: 60, voiceMode: VOICE_MODE.mono, glide: 30, filterType: 0, cutoff: 1800, resonance: 25, keyTrack: 30,
        decay: 0.3, sustain: 70, release: 0.08, mDecay: 0.2, envDest: MOD_DEST.posA, envAmount: 60, envDest2: MOD_DEST.cutoff, envAmount2: 35, volume: -5 },
    },
    {
      name: 'Lead FM',
      params: { tableA: TABLE.FM, posA: 30, tableB: TABLE.Base, posB: 66, levelB: 35, fineB: -8, unison: 3, detune: 14, spread: 60,
        voiceMode: VOICE_MODE.legato, glide: 60, cutoff: 7000, resonance: 15, attack: 0.01, sustain: 90, release: 0.2,
        lfo1Sync: LFO_SYNC.hz, lfo1Rate: 5.5, lfo1Dest: MOD_DEST.pitch, lfo1Amount: 1, lfo2Division: TEMPO_RATE['1/8'], lfo2Dest: MOD_DEST.posA,
        lfo2Amount: 25, volume: -13 },
    },
    {
      name: 'Organo',
      params: { tableA: TABLE.Organo, posA: 60, attack: 0.005, decay: 0.1, sustain: 100, release: 0.08, lfo1Sync: LFO_SYNC.hz, lfo1Rate: 6.5,
        lfo1Retrig: 1, lfo1Dest: MOD_DEST.volume, lfo1Amount: 12, volume: -10 },
    },
    {
      name: 'Supersaw',
      params: { tableA: TABLE.Base, posA: 67, unison: 7, detune: 28, spread: 100, cutoff: 9000, resonance: 10, attack: 0.005, sustain: 90,
        release: 0.3, volume: -14 },
    },
    {
      name: 'Wobble',
      params: { tableA: TABLE.Fold, posA: 0, tableB: TABLE.PWM, posB: 30, levelB: 40, semiB: -12, sub: 70, voiceMode: VOICE_MODE.mono,
        cutoff: 1200, resonance: 30, sustain: 100, release: 0.1, lfo1Shape: LFO_SHAPE.sine, lfo1Division: TEMPO_RATE['1/8'],
        lfo1Dest: MOD_DEST.pos, lfo1Amount: 75, lfo2Shape: LFO_SHAPE.sine, lfo2Division: TEMPO_RATE['1/8'], lfo2Dest: MOD_DEST.cutoff,
        lfo2Amount: 40, volume: -10 },
    },
    // ---- bassi
    {
      name: 'Basso reese',
      params: { tableA: TABLE.Base, posA: 67, tableB: TABLE.Base, posB: 67, levelB: 100, fineB: -12, unison: 2, detune: 20, spread: 50, sub: 60,
        voiceMode: VOICE_MODE.mono, glide: 25, cutoff: 900, resonance: 20, keyTrack: 20, sustain: 100, release: 0.08,
        lfo1Shape: LFO_SHAPE.triangle, lfo1Division: TEMPO_RATE['2 battute'], lfo1Retrig: 1, lfo1Dest: MOD_DEST.cutoff, lfo1Amount: 15, volume: -12 },
    },
    {
      name: 'Basso FM growl',
      params: { tableA: TABLE.FM, posA: 20, tableB: TABLE.Vocale, posB: 30, levelB: 40, sub: 50, voiceMode: VOICE_MODE.mono, glide: 20,
        cutoff: 2500, resonance: 25, sustain: 100, release: 0.08, lfo1Shape: LFO_SHAPE.sawDown, lfo1Division: TEMPO_RATE['1/16'],
        lfo1Dest: MOD_DEST.posA, lfo1Amount: 50, lfo2Shape: LFO_SHAPE.triangle, lfo2Division: TEMPO_RATE['1/4'], lfo2Dest: MOD_DEST.posB,
        lfo2Amount: 60, volume: -10 },
    },
    {
      name: 'Basso 808',
      params: { tableA: TABLE.Base, posA: 0, voiceMode: VOICE_MODE.mono, glide: 50, attack: 0.001, decay: 1.2, sustain: 0, release: 0.3,
        mAttack: 0.001, mDecay: 0.05, envDest: MOD_DEST.pitch, envAmount: 50, envDest2: MOD_DEST.posA, envAmount2: 30, velocity: 30, volume: -6 },
    },
    {
      name: 'Basso acido',
      params: { tableA: TABLE.Base, posA: 67, voiceMode: VOICE_MODE.legato, glide: 60, cutoff: 300, resonance: 80, keyTrack: 20,
        sustain: 100, release: 0.05, mDecay: 0.2, envDest: MOD_DEST.cutoff, envAmount: 70, envDest2: MOD_DEST.posA, envAmount2: 40,
        velocity: 40, volume: -10 },
    },
    {
      name: 'Basso wobble lento',
      params: { tableA: TABLE.Vocale, posA: 0, tableB: TABLE.FM, posB: 10, levelB: 50, semiB: -12, sub: 70, voiceMode: VOICE_MODE.mono,
        cutoff: 900, resonance: 35, sustain: 100, release: 0.1, lfo1Shape: LFO_SHAPE.triangle, lfo1Division: TEMPO_RATE['1/4'],
        lfo1Dest: MOD_DEST.pos, lfo1Amount: 80, lfo2Shape: LFO_SHAPE.triangle, lfo2Division: TEMPO_RATE['1/4'], lfo2Dest: MOD_DEST.cutoff,
        lfo2Amount: 50, volume: -10 },
    },
    // ---- lead
    {
      name: 'Lead sync urlante',
      params: { tableA: TABLE.Sync, posA: 30, unison: 2, detune: 10, spread: 40, voiceMode: VOICE_MODE.legato, glide: 40, cutoff: 8000,
        attack: 0.005, sustain: 90, release: 0.15, mDecay: 0.4, mSustain: 20, envDest: MOD_DEST.posA, envAmount: 60,
        lfo1Sync: LFO_SYNC.hz, lfo1Rate: 5.5, lfo1Dest: MOD_DEST.pitch, lfo1Amount: 1, volume: -7 },
    },
    {
      name: 'Lead quadra',
      params: { tableA: TABLE.PWM, posA: 0, voiceMode: VOICE_MODE.legato, glide: 50, cutoff: 5000, resonance: 20, keyTrack: 30,
        attack: 0.005, sustain: 90, release: 0.15, lfo1Shape: LFO_SHAPE.triangle, lfo1Division: TEMPO_RATE['2 battute'], lfo1Dest: MOD_DEST.posA,
        lfo1Amount: 60, volume: -10 },
    },
    // ---- pad e atmosfere
    {
      name: 'Coro vocale',
      params: { tableA: TABLE.Vocale, posA: 20, unison: 5, detune: 15, spread: 80, posSpread: 30, cutoff: 5000, attack: 0.4, decay: 1,
        sustain: 90, release: 1.5, lfo1Shape: LFO_SHAPE.triangle, lfo1Division: TEMPO_RATE['4 battute'], lfo1Retrig: 1, lfo1Dest: MOD_DEST.posA,
        lfo1Amount: 60, velocity: 30, volume: -10 },
    },
    {
      name: 'Pad ripiegato',
      params: { tableA: TABLE.Fold, posA: 10, unison: 6, detune: 22, spread: 100, posSpread: 40, cutoff: 3500, attack: 1, decay: 1.5,
        sustain: 85, release: 2, lfo1Division: TEMPO_RATE['4 battute'], lfo1Retrig: 1, lfo1Dest: MOD_DEST.posA, lfo1Amount: 50,
        lfo2Shape: LFO_SHAPE.triangle, lfo2Division: TEMPO_RATE['2 battute'], lfo2Retrig: 1, lfo2Dest: MOD_DEST.cutoff, lfo2Amount: 15,
        velocity: 30, volume: -14 },
    },
    {
      name: 'Atmosfera digitale',
      params: { tableA: TABLE.Digitale, posA: 60, tableB: TABLE.Vocale, posB: 50, levelB: 60, semiB: 7, unison: 3, detune: 12, spread: 90,
        cutoff: 4000, attack: 1.5, decay: 2, sustain: 80, release: 2, lfo1Division: TEMPO_RATE['8 battute'], lfo1Retrig: 1, lfo1Dest: MOD_DEST.pos,
        lfo1Amount: 100, velocity: 20, volume: -20 },
    },
    {
      name: 'Archi',
      params: { tableA: TABLE.Base, posA: 67, unison: 5, detune: 12, spread: 90, cutoff: 3000, keyTrack: 40, attack: 0.35, decay: 1,
        sustain: 90, release: 0.8, lfo1Sync: LFO_SYNC.hz, lfo1Rate: 5, lfo1Dest: MOD_DEST.pitch, lfo1Amount: 1, velocity: 40, volume: -14 },
    },
    // ---- tastiere, campane, pluck
    {
      name: 'Campane FM',
      params: { tableA: TABLE.FM, posA: 55, tableB: TABLE.Base, posB: 0, levelB: 30, semiB: 24, attack: 0.001, decay: 1.8, sustain: 0,
        release: 1.5, mDecay: 1, envDest: MOD_DEST.posA, envAmount: 40, velocity: 60, volume: -14 },
    },
    {
      name: 'Arpa di vetro',
      params: { tableA: TABLE.Organo, posA: 100, tableB: TABLE.FM, posB: 40, levelB: 30, semiB: 12, attack: 0.001, decay: 1.2, sustain: 0,
        release: 1, mDecay: 0.3, envDest: MOD_DEST.posB, envAmount: 60, velocity: 60, volume: -11 },
    },
    {
      name: 'Keys digitali',
      params: { tableA: TABLE.Digitale, posA: 30, tableB: TABLE.Base, posB: 0, levelB: 50, cutoff: 4000, keyTrack: 30, attack: 0.002,
        decay: 0.8, sustain: 30, release: 0.4, mDecay: 0.3, envDest: MOD_DEST.none, envDest2: MOD_DEST.cutoff, envAmount2: 40, velocity: 70,
        volume: -14 },
    },
    {
      name: 'Pluck armonico',
      params: { tableA: TABLE.Armoniche, posA: 0, attack: 0.001, decay: 0.4, sustain: 0, release: 0.3, mDecay: 0.2,
        envDest: MOD_DEST.posA, envAmount: 90, velocity: 60, volume: -8 },
    },
    {
      name: 'Gocce S&H',
      params: { tableA: TABLE.Armoniche, posA: 50, tableB: TABLE.Fold, posB: 30, levelB: 30, semiB: 12, attack: 0.001, decay: 0.3,
        sustain: 0, release: 0.3, lfo1Shape: LFO_SHAPE.sampleHold, lfo1Division: TEMPO_RATE['1/16'], lfo1Dest: MOD_DEST.posA, lfo1Amount: 60,
        lfo2Shape: LFO_SHAPE.sampleHold, lfo2Division: TEMPO_RATE['1/16T'], lfo2Dest: MOD_DEST.posB, lfo2Amount: 70, volume: -9 },
    },
    // ---- ottoni e organi
    {
      name: 'Ottoni',
      params: { tableA: TABLE.Base, posA: 67, tableB: TABLE.Base, posB: 100, levelB: 40, unison: 2, detune: 8, spread: 50, cutoff: 800,
        resonance: 10, keyTrack: 30, attack: 0.03, decay: 0.5, sustain: 85, release: 0.2, mAttack: 0.05, mDecay: 0.4, mSustain: 40,
        envDest: MOD_DEST.cutoff, envAmount: 60, envDest2: MOD_DEST.none, volume: -14.5 },
    },
    {
      name: 'Organo rock',
      params: { tableA: TABLE.Organo, posA: 85, tableB: TABLE.Organo, posB: 40, levelB: 40, semiB: 12, attack: 0.003, decay: 0.1, sustain: 100,
        release: 0.08, lfo1Sync: LFO_SYNC.hz, lfo1Rate: 6, lfo1Retrig: 1, lfo1Dest: MOD_DEST.volume, lfo1Amount: 15,
        lfo2Sync: LFO_SYNC.hz, lfo2Rate: 6, lfo2Retrig: 1, lfo2Dest: MOD_DEST.posA, lfo2Amount: 8, volume: -12 },
    },
    // ---- ritmici ed effetti
    {
      name: 'Gate trance',
      params: { tableA: TABLE.Base, posA: 67, unison: 7, detune: 25, spread: 100, cutoff: 7000, attack: 0.002, sustain: 100, release: 0.2,
        lfo1Shape: LFO_SHAPE.square, lfo1Division: TEMPO_RATE['1/16'], lfo1Dest: MOD_DEST.volume, lfo1Amount: 90, volume: -20 },
    },
    {
      name: 'Salita',
      params: { tableA: TABLE.Sync, posA: 0, unison: 7, detune: 30, spread: 100, cutoff: 6000, attack: 0.01, sustain: 100, release: 1,
        mAttack: 4, mDecay: 1, mSustain: 100, mRelease: 1, envDest: MOD_DEST.posA, envAmount: 100, envDest2: MOD_DEST.pitch, envAmount2: 50,
        volume: -12 },
    },
    // ---- altri suoni
    {
      // la sirena del rave: il pitch che sale e scende piano
      name: 'Sirena rave',
      params: { tableA: TABLE.Base, posA: 67, unison: 2, detune: 15, voiceMode: VOICE_MODE.mono, cutoff: 5000, resonance: 20, sustain: 100,
        release: 0.3, lfo1Shape: LFO_SHAPE.triangle, lfo1Sync: LFO_SYNC.hz, lfo1Rate: 0.5, lfo1Retrig: 0, lfo1Dest: MOD_DEST.pitch,
        lfo1Amount: 30, volume: -7 },
    },
    {
      name: 'Stab digitale',
      params: { tableA: TABLE.Digitale, posA: 40, unison: 5, detune: 25, spread: 90, cutoff: 1500, resonance: 25, decay: 0.3, sustain: 0,
        release: 0.25, mDecay: 0.2, envDest: MOD_DEST.cutoff, envAmount: 60, envDest2: MOD_DEST.posA, envAmount2: 40, volume: -7 },
    },
    {
      name: 'Pad pulsar',
      params: { tableA: TABLE.Pulsar, posA: 20, tableB: TABLE['Seno caldo'], levelB: 50, semiB: -12, unison: 3, detune: 12, posSpread: 30,
        cutoff: 6000, attack: 1, decay: 1, sustain: 85, release: 2, lfo1Shape: LFO_SHAPE.triangle, lfo1Division: TEMPO_RATE['2 battute'],
        lfo1Retrig: 1, lfo1Dest: MOD_DEST.posA, lfo1Amount: 60, volume: -14 },
    },
    {
      name: 'Basso metallico',
      params: { tableA: TABLE.Metallo, posA: 25, sub: 70, voiceMode: VOICE_MODE.mono, glide: 20, cutoff: 1500, resonance: 25, sustain: 90,
        release: 0.08, mDecay: 0.25, envDest: MOD_DEST.posA, envAmount: 50, envDest2: MOD_DEST.cutoff, envAmount2: 40, volume: -5 },
    },
    {
      name: 'Lead additivo',
      params: { tableA: TABLE.Additiva, posA: 50, tableB: TABLE.Additiva, posB: 70, levelB: 50, fineB: 8, voiceMode: VOICE_MODE.legato,
        glide: 70, sustain: 100, release: 0.2, lfo1Shape: LFO_SHAPE.sine, lfo1Sync: LFO_SYNC.hz, lfo1Rate: 5.5, lfo1Retrig: 0,
        lfo1Dest: MOD_DEST.pitch, lfo1Amount: 1, lfo2Shape: LFO_SHAPE.triangle, lfo2Division: TEMPO_RATE['1 battuta'], lfo2Dest: MOD_DEST.posA,
        lfo2Amount: 40, volume: -8 },
    },
    {
      name: 'Arpeggio a ottave',
      params: { tableA: TABLE.Ottave, posA: 30, unison: 2, detune: 10, cutoff: 4000, resonance: 15, decay: 0.3, sustain: 0, release: 0.3,
        mDecay: 0.15, envDest: MOD_DEST.posA, envAmount: 50, volume: -10 },
    },
    {
      // un vento di armoniche che cambia da solo, lento
      name: 'Vento spettrale',
      params: { tableA: TABLE.Spettrale, posA: 40, tableB: TABLE.Formanti, posB: 50, levelB: 60, unison: 4, detune: 18, posSpread: 50,
        spread: 100, cutoff: 3500, attack: 2, decay: 1, sustain: 90, release: 3, lfo1Shape: LFO_SHAPE.sampleHold, lfo1Division: TEMPO_RATE['1 battuta'],
        lfo1Dest: MOD_DEST.pos, lfo1Amount: 50, lfo2Shape: LFO_SHAPE.sine, lfo2Division: TEMPO_RATE['4 battute'], lfo2Dest: MOD_DEST.cutoff,
        lfo2Amount: 25, volume: -9 },
    },
    {
      name: 'Basso growl a 1/16',
      params: { tableA: TABLE.Growl, posA: 20, sub: 60, voiceMode: VOICE_MODE.mono, cutoff: 2000, resonance: 30, sustain: 100, release: 0.08,
        lfo1Shape: LFO_SHAPE.square, lfo1Division: TEMPO_RATE['1/16'], lfo1Dest: MOD_DEST.posA, lfo1Amount: 60, lfo2Shape: LFO_SHAPE.sine,
        lfo2Division: TEMPO_RATE['2 battute'], lfo2Dest: MOD_DEST.cutoff, lfo2Amount: 30, volume: -11 },
    },
  ],
};
