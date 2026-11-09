/* "Wavetable": wavetable synth, like Live's Wavetable. Two oscillators each read
 * a table (a row of waveforms: Base, PWM, Harmonics, Sync, Fold, FM, Vowel,
 * Organ, Digital) and the Position chooses where to read it, crossfading between one shape and the other:
 * moving it with the modulation envelope or the LFOs the timbre changes while the note plays.
 * Then a sub, the unison (with the copies also reading different positions), the filter, the
 * envelopes and two LFOs, each towards a target of choice. Polyphonic (16 voices) or
 * monophonic, with glide. Here there's only the description (parameters and presets); the tables are in
 * tables.ts, the sound in wavetable-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam, ParamSpec } from '../../params';
import { TEMPO_RATE, TEMPO_RATES } from '../../rates';
import { FILTER_TYPES, LFO_SYNC, MAX_UNISON, VOICE_MODE, VOICE_MODES } from '../analog/analog';
import { TABLE_NAMES } from './tables';

/** The tables, by name (the option's index). */
export const TABLE = Object.fromEntries(TABLE_NAMES.map((n, i) => [n, i])) as Readonly<Record<string, number>>;

/** Where a modulation goes: how far it moves at most (with amount 100 and modulator at 1). */
export interface ModDestination {
  readonly label: string;
  readonly key: ModKey | null;
  readonly range: number;
}

export type ModKey = 'posA' | 'posB' | 'pos' | 'cutoff' | 'resonance' | 'pitch' | 'levelB' | 'volume';

/** The targets in the order of the options. The positions and B's level move as a
 *  fraction of their knob, the cutoff in octaves, the pitch in semitones, the volume as a
 *  fraction of its value. */
export const MOD_DESTINATIONS: readonly ModDestination[] = [
  { label: 'None', key: null, range: 0 },
  { label: 'Position A', key: 'posA', range: 1 },
  { label: 'Position B', key: 'posB', range: 1 },
  { label: 'Positions A+B', key: 'pos', range: 1 },
  { label: 'Cutoff', key: 'cutoff', range: 5 },
  { label: 'Resonance', key: 'resonance', range: 1 },
  { label: 'Pitch', key: 'pitch', range: 24 },
  { label: 'Level B', key: 'levelB', range: 1 },
  { label: 'Volume', key: 'volume', range: 1 },
];
export const MOD_DEST = Object.fromEntries(MOD_DESTINATIONS.map((d, i) => [d.key ?? 'none', i])) as Readonly<Record<ModKey | 'none', number>>;

export const LFO_SHAPES = ['Sine', 'Triangle', 'Saw ↓', 'Saw ↑', 'Square', 'S&H'] as const;
export const LFO_SHAPE = { sine: 0, triangle: 1, sawDown: 2, sawUp: 3, square: 4, sampleHold: 5 } as const;
/** Note: the LFO restarts at every note. Free: all the voices follow the same cycle. */
export const LFO_RETRIG = ['Note', 'Free'] as const;
export { LFO_SYNC, VOICE_MODE };

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const time = (id: string, label: string, def: number) => num(id, label, 0.001, 10, def, 's', { scale: 'log' });
const percent = (id: string, label: string, def: number, min = 0) => num(id, label, min, 100, def, '%', { step: 1 });
const destinations = MOD_DESTINATIONS.map(d => d.label);
const unisonOn = { param: 'unison', is: [2, 3, 4, 5, 6, 7] };

/** An oscillator's controls (`…A`, `…B`). */
const oscParams = (o: 'A' | 'B', table: number, level: number): ParamSpec[] => [
  choice(`table${o}`, 'Table', TABLE_NAMES, table),
  percent(`pos${o}`, 'Position', 0),
  num(`semi${o}`, 'Semitones', -24, 24, 0, 'st', { step: 1 }),
  num(`fine${o}`, 'Fine', -50, 50, 0, 'ct', { step: 1 }),
  percent(`level${o}`, 'Level', level),
];

/** An LFO's controls (`lfo1…`, `lfo2…`). */
const lfoParams = (n: number, division: number): ParamSpec[] => [
  choice(`lfo${n}Shape`, 'Wave', LFO_SHAPES),
  choice(`lfo${n}Sync`, 'Sync', ['Tempo', 'Hz'], LFO_SYNC.tempo),
  choice(`lfo${n}Division`, 'Division', TEMPO_RATES.map(([l]) => l), division, { when: { param: `lfo${n}Sync`, is: LFO_SYNC.tempo } }),
  num(`lfo${n}Rate`, 'Rate', 0.05, 20, 2, 'Hz', { scale: 'log', when: { param: `lfo${n}Sync`, is: LFO_SYNC.hz } }),
  choice(`lfo${n}Retrig`, 'Restart', LFO_RETRIG),
  choice(`lfo${n}Dest`, '→ Where', destinations),
  percent(`lfo${n}Amount`, 'Amount', 0, -100),
];

export const WAVETABLE: DeviceType = {
  type: 'wavetable',
  label: 'Wavetable',
  sections: [
    { label: 'Oscillator A', params: oscParams('A', TABLE.Basic, 100) },
    { label: 'Oscillator B', params: oscParams('B', TABLE.Harmonics, 0) },
    { label: 'Sub', params: [percent('sub', 'Level', 0), choice('subOctave', 'Octave', ['-1', '-2'])] },
    {
      label: 'Unison',
      params: [
        num('unison', 'Copies', 1, MAX_UNISON, 1, '', { step: 1 }),
        num('detune', 'Detuning', 0, 100, 20, 'ct', { step: 1, when: unisonOn }),
        { ...percent('spread', 'Opening', 70), when: unisonOn },
        { ...percent('posSpread', 'Positions', 0), when: unisonOn },
      ],
    },
    {
      label: 'Filter',
      params: [
        choice('filterType', 'Type', FILTER_TYPES),
        num('cutoff', 'Cutoff', 20, 20000, 20000, 'Hz', { scale: 'log' }),
        percent('resonance', 'Resonance', 0),
        percent('keyTrack', 'Key track', 0),
      ],
    },
    {
      label: 'Voice',
      params: [
        choice('voiceMode', 'Mode', VOICE_MODES),
        num('glide', 'Glide', 0, 500, 0, 'ms', { step: 1, when: { param: 'voiceMode', is: [VOICE_MODE.mono, VOICE_MODE.legato] } }),
        percent('velocity', 'Velocity', 50),
      ],
    },
    {
      label: 'Volume envelope',
      params: [time('attack', 'Attack', 0.003), time('decay', 'Decay', 0.5), percent('sustain', 'Sustain', 80), time('release', 'Release', 0.25)],
    },
    {
      label: 'Mod envelope',
      params: [
        time('mAttack', 'Attack', 0.003), time('mDecay', 'Decay', 0.6), percent('mSustain', 'Sustain', 0), time('mRelease', 'Release', 0.3),
        choice('envDest', '→ Where', destinations, MOD_DEST.posA),
        percent('envAmount', 'Amount', 0, -100),
        choice('envDest2', '→ Where 2', destinations, MOD_DEST.cutoff),
        percent('envAmount2', 'Amount 2', 0, -100),
      ],
    },
    { label: 'LFO 1', params: lfoParams(1, TEMPO_RATE['1 bar']) },
    { label: 'LFO 2', params: lfoParams(2, TEMPO_RATE['1/8']) },
    { label: 'Output', params: [num('volume', 'Volume', -36, 6, -10, 'dB', { step: 0.5 })] },
  ],
  presets: [
    { name: 'Init', params: {} },
    {
      name: 'Breathing pad',
      params: { tableA: TABLE.Vocal, posA: 10, tableB: TABLE.Harmonics, posB: 40, levelB: 45, fineB: 7, unison: 4, detune: 18, spread: 90, posSpread: 25,
        cutoff: 6000, attack: 0.9, decay: 1.5, sustain: 85, release: 2, lfo1Sync: LFO_SYNC.tempo, lfo1Division: TEMPO_RATE['4 bars'],
        lfo1Retrig: 1, lfo1Dest: MOD_DEST.posA, lfo1Amount: 70, lfo2Shape: LFO_SHAPE.triangle, lfo2Division: TEMPO_RATE['2 bars'],
        lfo2Retrig: 1, lfo2Dest: MOD_DEST.posB, lfo2Amount: 50, velocity: 30, volume: -12 },
    },
    {
      name: 'Digital pluck',
      params: { tableA: TABLE.Digital, posA: 0, tableB: TABLE.FM, posB: 20, levelB: 50, semiB: 12, cutoff: 9000, decay: 0.35, sustain: 0, release: 0.3,
        mDecay: 0.25, envDest: MOD_DEST.pos, envAmount: 80, envDest2: MOD_DEST.cutoff, envAmount2: 30, volume: -11 },
    },
    {
      name: 'Sync bass',
      params: { tableA: TABLE.Sync, posA: 15, sub: 60, voiceMode: VOICE_MODE.mono, glide: 30, filterType: 0, cutoff: 1800, resonance: 25, keyTrack: 30,
        decay: 0.3, sustain: 70, release: 0.08, mDecay: 0.2, envDest: MOD_DEST.posA, envAmount: 60, envDest2: MOD_DEST.cutoff, envAmount2: 35, volume: -5 },
    },
    {
      name: 'FM lead',
      params: { tableA: TABLE.FM, posA: 30, tableB: TABLE.Basic, posB: 66, levelB: 35, fineB: -8, unison: 3, detune: 14, spread: 60,
        voiceMode: VOICE_MODE.legato, glide: 60, cutoff: 7000, resonance: 15, attack: 0.01, sustain: 90, release: 0.2,
        lfo1Sync: LFO_SYNC.hz, lfo1Rate: 5.5, lfo1Dest: MOD_DEST.pitch, lfo1Amount: 1, lfo2Division: TEMPO_RATE['1/8'], lfo2Dest: MOD_DEST.posA,
        lfo2Amount: 25, volume: -13 },
    },
    {
      name: 'Organ',
      params: { tableA: TABLE.Organ, posA: 60, attack: 0.005, decay: 0.1, sustain: 100, release: 0.08, lfo1Sync: LFO_SYNC.hz, lfo1Rate: 6.5,
        lfo1Retrig: 1, lfo1Dest: MOD_DEST.volume, lfo1Amount: 12, volume: -10 },
    },
    {
      name: 'Supersaw',
      params: { tableA: TABLE.Basic, posA: 67, unison: 7, detune: 28, spread: 100, cutoff: 9000, resonance: 10, attack: 0.005, sustain: 90,
        release: 0.3, volume: -14 },
    },
    {
      name: 'Wobble',
      params: { tableA: TABLE.Fold, posA: 0, tableB: TABLE.PWM, posB: 30, levelB: 40, semiB: -12, sub: 70, voiceMode: VOICE_MODE.mono,
        cutoff: 1200, resonance: 30, sustain: 100, release: 0.1, lfo1Shape: LFO_SHAPE.sine, lfo1Division: TEMPO_RATE['1/8'],
        lfo1Dest: MOD_DEST.pos, lfo1Amount: 75, lfo2Shape: LFO_SHAPE.sine, lfo2Division: TEMPO_RATE['1/8'], lfo2Dest: MOD_DEST.cutoff,
        lfo2Amount: 40, volume: -10 },
    },
    // ---- basses
    {
      name: 'Reese bass',
      params: { tableA: TABLE.Basic, posA: 67, tableB: TABLE.Basic, posB: 67, levelB: 100, fineB: -12, unison: 2, detune: 20, spread: 50, sub: 60,
        voiceMode: VOICE_MODE.mono, glide: 25, cutoff: 900, resonance: 20, keyTrack: 20, sustain: 100, release: 0.08,
        lfo1Shape: LFO_SHAPE.triangle, lfo1Division: TEMPO_RATE['2 bars'], lfo1Retrig: 1, lfo1Dest: MOD_DEST.cutoff, lfo1Amount: 15, volume: -12 },
    },
    {
      name: 'FM growl bass',
      params: { tableA: TABLE.FM, posA: 20, tableB: TABLE.Vocal, posB: 30, levelB: 40, sub: 50, voiceMode: VOICE_MODE.mono, glide: 20,
        cutoff: 2500, resonance: 25, sustain: 100, release: 0.08, lfo1Shape: LFO_SHAPE.sawDown, lfo1Division: TEMPO_RATE['1/16'],
        lfo1Dest: MOD_DEST.posA, lfo1Amount: 50, lfo2Shape: LFO_SHAPE.triangle, lfo2Division: TEMPO_RATE['1/4'], lfo2Dest: MOD_DEST.posB,
        lfo2Amount: 60, volume: -10 },
    },
    {
      name: '808 bass',
      params: { tableA: TABLE.Basic, posA: 0, voiceMode: VOICE_MODE.mono, glide: 50, attack: 0.001, decay: 1.2, sustain: 0, release: 0.3,
        mAttack: 0.001, mDecay: 0.05, envDest: MOD_DEST.pitch, envAmount: 50, envDest2: MOD_DEST.posA, envAmount2: 30, velocity: 30, volume: -6 },
    },
    {
      name: 'Acid bass',
      params: { tableA: TABLE.Basic, posA: 67, voiceMode: VOICE_MODE.legato, glide: 60, cutoff: 300, resonance: 80, keyTrack: 20,
        sustain: 100, release: 0.05, mDecay: 0.2, envDest: MOD_DEST.cutoff, envAmount: 70, envDest2: MOD_DEST.posA, envAmount2: 40,
        velocity: 40, volume: -10 },
    },
    {
      name: 'Slow wobble bass',
      params: { tableA: TABLE.Vocal, posA: 0, tableB: TABLE.FM, posB: 10, levelB: 50, semiB: -12, sub: 70, voiceMode: VOICE_MODE.mono,
        cutoff: 900, resonance: 35, sustain: 100, release: 0.1, lfo1Shape: LFO_SHAPE.triangle, lfo1Division: TEMPO_RATE['1/4'],
        lfo1Dest: MOD_DEST.pos, lfo1Amount: 80, lfo2Shape: LFO_SHAPE.triangle, lfo2Division: TEMPO_RATE['1/4'], lfo2Dest: MOD_DEST.cutoff,
        lfo2Amount: 50, volume: -10 },
    },
    // ---- lead
    {
      name: 'Screaming sync lead',
      params: { tableA: TABLE.Sync, posA: 30, unison: 2, detune: 10, spread: 40, voiceMode: VOICE_MODE.legato, glide: 40, cutoff: 8000,
        attack: 0.005, sustain: 90, release: 0.15, mDecay: 0.4, mSustain: 20, envDest: MOD_DEST.posA, envAmount: 60,
        lfo1Sync: LFO_SYNC.hz, lfo1Rate: 5.5, lfo1Dest: MOD_DEST.pitch, lfo1Amount: 1, volume: -7 },
    },
    {
      name: 'Square lead',
      params: { tableA: TABLE.PWM, posA: 0, voiceMode: VOICE_MODE.legato, glide: 50, cutoff: 5000, resonance: 20, keyTrack: 30,
        attack: 0.005, sustain: 90, release: 0.15, lfo1Shape: LFO_SHAPE.triangle, lfo1Division: TEMPO_RATE['2 bars'], lfo1Dest: MOD_DEST.posA,
        lfo1Amount: 60, volume: -10 },
    },
    // ---- pad e atmosfere
    {
      name: 'Vocal choir',
      params: { tableA: TABLE.Vocal, posA: 20, unison: 5, detune: 15, spread: 80, posSpread: 30, cutoff: 5000, attack: 0.4, decay: 1,
        sustain: 90, release: 1.5, lfo1Shape: LFO_SHAPE.triangle, lfo1Division: TEMPO_RATE['4 bars'], lfo1Retrig: 1, lfo1Dest: MOD_DEST.posA,
        lfo1Amount: 60, velocity: 30, volume: -10 },
    },
    {
      name: 'Folded pad',
      params: { tableA: TABLE.Fold, posA: 10, unison: 6, detune: 22, spread: 100, posSpread: 40, cutoff: 3500, attack: 1, decay: 1.5,
        sustain: 85, release: 2, lfo1Division: TEMPO_RATE['4 bars'], lfo1Retrig: 1, lfo1Dest: MOD_DEST.posA, lfo1Amount: 50,
        lfo2Shape: LFO_SHAPE.triangle, lfo2Division: TEMPO_RATE['2 bars'], lfo2Retrig: 1, lfo2Dest: MOD_DEST.cutoff, lfo2Amount: 15,
        velocity: 30, volume: -14 },
    },
    {
      name: 'Digital atmosphere',
      params: { tableA: TABLE.Digital, posA: 60, tableB: TABLE.Vocal, posB: 50, levelB: 60, semiB: 7, unison: 3, detune: 12, spread: 90,
        cutoff: 4000, attack: 1.5, decay: 2, sustain: 80, release: 2, lfo1Division: TEMPO_RATE['8 bars'], lfo1Retrig: 1, lfo1Dest: MOD_DEST.pos,
        lfo1Amount: 100, velocity: 20, volume: -20 },
    },
    {
      name: 'Strings',
      params: { tableA: TABLE.Basic, posA: 67, unison: 5, detune: 12, spread: 90, cutoff: 3000, keyTrack: 40, attack: 0.35, decay: 1,
        sustain: 90, release: 0.8, lfo1Sync: LFO_SYNC.hz, lfo1Rate: 5, lfo1Dest: MOD_DEST.pitch, lfo1Amount: 1, velocity: 40, volume: -14 },
    },
    // ---- keys, bells, plucks
    {
      name: 'FM bells',
      params: { tableA: TABLE.FM, posA: 55, tableB: TABLE.Basic, posB: 0, levelB: 30, semiB: 24, attack: 0.001, decay: 1.8, sustain: 0,
        release: 1.5, mDecay: 1, envDest: MOD_DEST.posA, envAmount: 40, velocity: 60, volume: -14 },
    },
    {
      name: 'Glass harp',
      params: { tableA: TABLE.Organ, posA: 100, tableB: TABLE.FM, posB: 40, levelB: 30, semiB: 12, attack: 0.001, decay: 1.2, sustain: 0,
        release: 1, mDecay: 0.3, envDest: MOD_DEST.posB, envAmount: 60, velocity: 60, volume: -11 },
    },
    {
      name: 'Digital keys',
      params: { tableA: TABLE.Digital, posA: 30, tableB: TABLE.Basic, posB: 0, levelB: 50, cutoff: 4000, keyTrack: 30, attack: 0.002,
        decay: 0.8, sustain: 30, release: 0.4, mDecay: 0.3, envDest: MOD_DEST.none, envDest2: MOD_DEST.cutoff, envAmount2: 40, velocity: 70,
        volume: -14 },
    },
    {
      name: 'Harmonic pluck',
      params: { tableA: TABLE.Harmonics, posA: 0, attack: 0.001, decay: 0.4, sustain: 0, release: 0.3, mDecay: 0.2,
        envDest: MOD_DEST.posA, envAmount: 90, velocity: 60, volume: -8 },
    },
    {
      name: 'S&H drops',
      params: { tableA: TABLE.Harmonics, posA: 50, tableB: TABLE.Fold, posB: 30, levelB: 30, semiB: 12, attack: 0.001, decay: 0.3,
        sustain: 0, release: 0.3, lfo1Shape: LFO_SHAPE.sampleHold, lfo1Division: TEMPO_RATE['1/16'], lfo1Dest: MOD_DEST.posA, lfo1Amount: 60,
        lfo2Shape: LFO_SHAPE.sampleHold, lfo2Division: TEMPO_RATE['1/16T'], lfo2Dest: MOD_DEST.posB, lfo2Amount: 70, volume: -9 },
    },
    // ---- brass and organs
    {
      name: 'Brass',
      params: { tableA: TABLE.Basic, posA: 67, tableB: TABLE.Basic, posB: 100, levelB: 40, unison: 2, detune: 8, spread: 50, cutoff: 800,
        resonance: 10, keyTrack: 30, attack: 0.03, decay: 0.5, sustain: 85, release: 0.2, mAttack: 0.05, mDecay: 0.4, mSustain: 40,
        envDest: MOD_DEST.cutoff, envAmount: 60, envDest2: MOD_DEST.none, volume: -14.5 },
    },
    {
      name: 'Rock organ',
      params: { tableA: TABLE.Organ, posA: 85, tableB: TABLE.Organ, posB: 40, levelB: 40, semiB: 12, attack: 0.003, decay: 0.1, sustain: 100,
        release: 0.08, lfo1Sync: LFO_SYNC.hz, lfo1Rate: 6, lfo1Retrig: 1, lfo1Dest: MOD_DEST.volume, lfo1Amount: 15,
        lfo2Sync: LFO_SYNC.hz, lfo2Rate: 6, lfo2Retrig: 1, lfo2Dest: MOD_DEST.posA, lfo2Amount: 8, volume: -12 },
    },
    // ---- rhythmic and effects
    {
      name: 'Trance gate',
      params: { tableA: TABLE.Basic, posA: 67, unison: 7, detune: 25, spread: 100, cutoff: 7000, attack: 0.002, sustain: 100, release: 0.2,
        lfo1Shape: LFO_SHAPE.square, lfo1Division: TEMPO_RATE['1/16'], lfo1Dest: MOD_DEST.volume, lfo1Amount: 90, volume: -20 },
    },
    {
      name: 'Rise',
      params: { tableA: TABLE.Sync, posA: 0, unison: 7, detune: 30, spread: 100, cutoff: 6000, attack: 0.01, sustain: 100, release: 1,
        mAttack: 4, mDecay: 1, mSustain: 100, mRelease: 1, envDest: MOD_DEST.posA, envAmount: 100, envDest2: MOD_DEST.pitch, envAmount2: 50,
        volume: -12 },
    },
    // ---- other sounds
    {
      // the rave siren: the pitch rising and falling slowly
      name: 'Rave siren',
      params: { tableA: TABLE.Basic, posA: 67, unison: 2, detune: 15, voiceMode: VOICE_MODE.mono, cutoff: 5000, resonance: 20, sustain: 100,
        release: 0.3, lfo1Shape: LFO_SHAPE.triangle, lfo1Sync: LFO_SYNC.hz, lfo1Rate: 0.5, lfo1Retrig: 0, lfo1Dest: MOD_DEST.pitch,
        lfo1Amount: 30, volume: -7 },
    },
    {
      name: 'Digital stab',
      params: { tableA: TABLE.Digital, posA: 40, unison: 5, detune: 25, spread: 90, cutoff: 1500, resonance: 25, decay: 0.3, sustain: 0,
        release: 0.25, mDecay: 0.2, envDest: MOD_DEST.cutoff, envAmount: 60, envDest2: MOD_DEST.posA, envAmount2: 40, volume: -7 },
    },
    {
      name: 'Pulsar pad',
      params: { tableA: TABLE.Pulsar, posA: 20, tableB: TABLE['Warm sine'], levelB: 50, semiB: -12, unison: 3, detune: 12, posSpread: 30,
        cutoff: 6000, attack: 1, decay: 1, sustain: 85, release: 2, lfo1Shape: LFO_SHAPE.triangle, lfo1Division: TEMPO_RATE['2 bars'],
        lfo1Retrig: 1, lfo1Dest: MOD_DEST.posA, lfo1Amount: 60, volume: -14 },
    },
    {
      name: 'Metallic bass',
      params: { tableA: TABLE.Metal, posA: 25, sub: 70, voiceMode: VOICE_MODE.mono, glide: 20, cutoff: 1500, resonance: 25, sustain: 90,
        release: 0.08, mDecay: 0.25, envDest: MOD_DEST.posA, envAmount: 50, envDest2: MOD_DEST.cutoff, envAmount2: 40, volume: -5 },
    },
    {
      name: 'Additive lead',
      params: { tableA: TABLE.Additive, posA: 50, tableB: TABLE.Additive, posB: 70, levelB: 50, fineB: 8, voiceMode: VOICE_MODE.legato,
        glide: 70, sustain: 100, release: 0.2, lfo1Shape: LFO_SHAPE.sine, lfo1Sync: LFO_SYNC.hz, lfo1Rate: 5.5, lfo1Retrig: 0,
        lfo1Dest: MOD_DEST.pitch, lfo1Amount: 1, lfo2Shape: LFO_SHAPE.triangle, lfo2Division: TEMPO_RATE['1 bar'], lfo2Dest: MOD_DEST.posA,
        lfo2Amount: 40, volume: -8 },
    },
    {
      name: 'Octave arpeggio',
      params: { tableA: TABLE.Octaves, posA: 30, unison: 2, detune: 10, cutoff: 4000, resonance: 15, decay: 0.3, sustain: 0, release: 0.3,
        mDecay: 0.15, envDest: MOD_DEST.posA, envAmount: 50, volume: -10 },
    },
    {
      // a wind of harmonics changing by itself, slowly
      name: 'Spectral wind',
      params: { tableA: TABLE.Spectral, posA: 40, tableB: TABLE.Formants, posB: 50, levelB: 60, unison: 4, detune: 18, posSpread: 50,
        spread: 100, cutoff: 3500, attack: 2, decay: 1, sustain: 90, release: 3, lfo1Shape: LFO_SHAPE.sampleHold, lfo1Division: TEMPO_RATE['1 bar'],
        lfo1Dest: MOD_DEST.pos, lfo1Amount: 50, lfo2Shape: LFO_SHAPE.sine, lfo2Division: TEMPO_RATE['4 bars'], lfo2Dest: MOD_DEST.cutoff,
        lfo2Amount: 25, volume: -9 },
    },
    {
      name: '1/16 growl bass',
      params: { tableA: TABLE.Growl, posA: 20, sub: 60, voiceMode: VOICE_MODE.mono, cutoff: 2000, resonance: 30, sustain: 100, release: 0.08,
        lfo1Shape: LFO_SHAPE.square, lfo1Division: TEMPO_RATE['1/16'], lfo1Dest: MOD_DEST.posA, lfo1Amount: 60, lfo2Shape: LFO_SHAPE.sine,
        lfo2Division: TEMPO_RATE['2 bars'], lfo2Dest: MOD_DEST.cutoff, lfo2Amount: 30, volume: -11 },
    },
  ],
};
