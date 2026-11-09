/* "Neuro": the synth for reese and neuro basses. A single voice (Mono or Legato, with glide):
 * two oscillators with unison for the "reese" (detuned saws beating slowly), phase
 * modulation (FM) for the growl, the wavefolder, a filter with its saturation, the
 * formant filter that makes the bass "talk" (the vowels A E I O U), the final distortion and,
 * separately, the sub: a clean, centred sine holding the lows below the cut, while all the
 * rest sits above (the bass stays defined even with a distorted, wide body). The movement
 * comes from two synced LFOs and a modulation envelope, each towards two targets of
 * choice (cutoff, vowel, fold, FM, pitch…), and from the clip modulations (also on
 * Transpose, for pitch rises and dives).
 * Here there's only the description (parameters and presets); the sound is in neuro-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam, ParamSpec } from '../../params';
import { TEMPO_RATE as LFO_RATE, TEMPO_RATES as LFO_RATES } from '../../rates';
import { SEQ_RATE, SEQ_SCALE, SEQUENCER_SECTION } from '../../sequencer';
import { MAX_UNISON, WAVES } from '../analog/analog';

export const NEURO_VOICE_MODES = ['Mono', 'Legato'] as const;
export const NEURO_MODE = { mono: 0, legato: 1 } as const;
export const NEURO_FILTERS = ['LP 24', 'LP 12', 'Band', 'High', 'Notch'] as const;
export const FM_RATIOS = [0.5, 1, 1.5, 2, 3, 4] as const;
export const SUB_OCTAVES = [0, -1, -2] as const;

/** Where a modulation goes: how far it moves at most (with amount 100 and modulator at 1). */
export interface ModDestination {
  readonly label: string;
  /** The base parameter the modulation moves (null: None). */
  readonly key: ModKey | null;
  readonly range: number;
}

/** The quantities that can be modulated (see neuro-core.ts). */
export type ModKey = 'cutoff' | 'resonance' | 'vowel' | 'formant' | 'fold' | 'fm' | 'drive' | 'dist' | 'pitch' | 'detune' | 'volume';

/** The targets in the order of the options. The cutoff moves in octaves, the pitch in
 *  semitones, the detune in cents, the volume in fraction; the rest in percentage points
 *  of its knob. */
export const MOD_DESTINATIONS: readonly ModDestination[] = [
  { label: 'None', key: null, range: 0 },
  { label: 'Cutoff', key: 'cutoff', range: 5 },
  { label: 'Resonance', key: 'resonance', range: 100 },
  { label: 'Vocal', key: 'vowel', range: 100 },
  { label: 'Formant', key: 'formant', range: 100 },
  { label: 'Fold', key: 'fold', range: 100 },
  { label: 'FM', key: 'fm', range: 100 },
  { label: 'Drive', key: 'drive', range: 100 },
  { label: 'Distortion', key: 'dist', range: 100 },
  { label: 'Pitch', key: 'pitch', range: 24 },
  { label: 'Detuning', key: 'detune', range: 100 },
  { label: 'Volume', key: 'volume', range: 1 },
];
export const MOD_DEST = Object.fromEntries(MOD_DESTINATIONS.map((d, i) => [d.key ?? 'none', i])) as Readonly<Record<ModKey | 'none', number>>;

export const LFO_SHAPES = ['Sine', 'Triangle', 'Saw ↓', 'Saw ↑', 'Square', 'S&H', 'Smooth S&H'] as const;
export const LFO_SHAPE = { sine: 0, triangle: 1, sawDown: 2, sawUp: 3, square: 4, sampleHold: 5, smoothRandom: 6 } as const;

/** The LFO rates, in beats per cycle. */
export { TEMPO_RATES as LFO_RATES, TEMPO_RATE as LFO_RATE } from '../../rates';
export const LFO_RETRIG = ['Note', 'Free'] as const;

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def });
const time = (id: string, label: string, def: number) => num(id, label, 0.001, 10, def, 's', { scale: 'log' });
const percent = (id: string, label: string, def: number, min = 0) => num(id, label, min, 100, def, '%', { step: 1 });
const destinations = MOD_DESTINATIONS.map(d => d.label);

/** An LFO's controls (`lfo1…`, `lfo2…`). */
const lfoParams = (n: number, rate: number): ParamSpec[] => [
  choice(`lfo${n}Shape`, 'Wave', LFO_SHAPES),
  choice(`lfo${n}Rate`, 'Rate', LFO_RATES.map(([l]) => l), rate),
  choice(`lfo${n}Retrig`, 'Restart', LFO_RETRIG),
  percent(`lfo${n}Phase`, 'Phase', 0),
  choice(`lfo${n}Dest`, '→ Where', destinations),
  percent(`lfo${n}Amount`, 'Amount', 0, -100),
  choice(`lfo${n}Dest2`, '→ Where 2', destinations),
  percent(`lfo${n}Amount2`, 'Amount 2', 0, -100),
];

export const NEURO: DeviceType = {
  type: 'neuro',
  label: 'Neuro',
  sections: [
    {
      label: 'Oscillators',
      params: [
        choice('oscA', 'Wave A', WAVES),
        choice('oscB', 'Wave B', WAVES),
        num('oscBSemi', 'B semitones', -24, 24, 0, 'st', { step: 1 }),
        num('oscBFine', 'B fine', -50, 50, -12, 'ct', { step: 1 }),
        percent('mix', 'Mix A/B', 50),
      ],
    },
    {
      label: 'Unison',
      params: [
        num('unison', 'Copies', 1, MAX_UNISON, 3, '', { step: 1 }),
        num('detune', 'Detuning', 0, 100, 18, 'ct', { step: 1 }),
        percent('spread', 'Opening', 70),
      ],
    },
    {
      label: 'Shape',
      params: [
        percent('fm', 'FM', 0),
        choice('fmRatio', 'FM ratio', FM_RATIOS.map(r => `${r}×`), 1),
        percent('fold', 'Fold', 0),
      ],
    },
    {
      label: 'Filter',
      params: [
        choice('filterType', 'Type', NEURO_FILTERS),
        num('cutoff', 'Cutoff', 20, 20000, 1200, 'Hz', { scale: 'log' }),
        percent('resonance', 'Resonance', 25),
        percent('drive', 'Drive', 20),
        percent('keyTrack', 'Key track', 30),
      ],
    },
    {
      label: 'Formant',
      params: [
        percent('formant', 'Amount', 0),
        percent('vowel', 'Vocal', 0),
        num('formantShift', 'Move', -12, 12, 0, 'st', { step: 0.1 }),
      ],
    },
    {
      label: 'Distortion',
      params: [percent('dist', 'Amount', 0)],
    },
    {
      label: 'Sub',
      params: [
        percent('sub', 'Level', 70),
        choice('subOctave', 'Octave', SUB_OCTAVES.map(o => (o ? `${o}` : '0')), 0),
        num('crossover', 'Cut', 40, 400, 110, 'Hz', { scale: 'log', step: 1 }),
      ],
    },
    {
      label: 'Voice',
      params: [
        choice('voiceMode', 'Mode', NEURO_VOICE_MODES, NEURO_MODE.legato),
        num('glide', 'Glide', 0, 500, 40, 'ms', { step: 1 }),
        // continuous: modulated by a clip it makes pitch rises and dives
        num('transpose', 'Transport', -24, 24, 0, 'st', { step: 0.01 }),
        percent('velocity', 'Velocity', 30),
      ],
    },
    {
      label: 'Volume envelope',
      params: [time('attack', 'Attack', 0.002), time('decay', 'Decay', 0.4), percent('sustain', 'Sustain', 100), time('release', 'Release', 0.06)],
    },
    {
      label: 'Mod envelope',
      params: [
        time('mAttack', 'Attack', 0.001), time('mDecay', 'Decay', 0.25), percent('mSustain', 'Sustain', 0), time('mRelease', 'Release', 0.1),
        choice('envDest', '→ Where', destinations),
        percent('envAmount', 'Amount', 0, -100),
        choice('envDest2', '→ Where 2', destinations),
        percent('envAmount2', 'Amount 2', 0, -100),
      ],
    },
    { label: 'LFO 1', params: lfoParams(1, LFO_RATE['1/4']) },
    { label: 'LFO 2', params: lfoParams(2, LFO_RATE['1/16']) },
    SEQUENCER_SECTION,
    { label: 'Output', params: [num('volume', 'Volume', -36, 6, -8, 'dB', { step: 0.5 })] },
  ],
  presets: [
    { name: 'Init', params: {} },
    {
      name: 'Reese',
      params: { unison: 3, detune: 22, oscBFine: -14, cutoff: 900, resonance: 15, drive: 30, dist: 25, sub: 70,
        lfo1Dest: MOD_DEST.cutoff, lfo1Rate: LFO_RATE['1 bar'], lfo1Amount: 25, lfo1Retrig: 1, volume: -9 },
    },
    {
      name: 'Talking reese',
      params: { unison: 3, detune: 20, cutoff: 1600, resonance: 20, drive: 40, formant: 80, vowel: 0, dist: 35,
        lfo1Shape: LFO_SHAPE.triangle, lfo1Rate: LFO_RATE['1/2'], lfo1Dest: MOD_DEST.vowel, lfo1Amount: 60,
        lfo2Rate: LFO_RATE['1/8T'], lfo2Dest: MOD_DEST.cutoff, lfo2Amount: 12, volume: -10 },
    },
    {
      name: 'Neuro growl',
      params: { unison: 2, detune: 12, oscBSemi: -12, oscBFine: 0, fm: 35, fmRatio: 3, fold: 20, cutoff: 2200, resonance: 30,
        drive: 55, formant: 55, vowel: 60, dist: 50, lfo1Shape: LFO_SHAPE.sawDown, lfo1Rate: LFO_RATE['1/8'], lfo1Dest: MOD_DEST.fm,
        lfo1Amount: 40, lfo1Dest2: MOD_DEST.vowel, lfo1Amount2: -30, volume: -11 },
    },
    {
      name: 'Neuro hit',
      params: { unison: 3, detune: 25, fold: 30, cutoff: 500, resonance: 35, drive: 60, formant: 50, vowel: 75, dist: 45,
        decay: 0.3, sustain: 40, mDecay: 0.18, envDest: MOD_DEST.cutoff, envAmount: 70, envDest2: MOD_DEST.vowel, envAmount2: -50, volume: -10 },
    },
    {
      name: 'Clean sub',
      params: { unison: 1, mix: 0, cutoff: 200, drive: 0, sub: 100, crossover: 400, volume: -6 },
    },
    {
      // the reese ducking on the downbeat and coming back up: the pump without sidechain
      name: 'Pumping reese',
      params: { unison: 3, detune: 22, oscBFine: -14, cutoff: 1000, resonance: 15, drive: 35, dist: 25, sub: 70,
        lfo2Shape: LFO_SHAPE.sawUp, lfo2Rate: LFO_RATE['1/4'], lfo2Retrig: 1, lfo2Dest: MOD_DEST.volume, lfo2Amount: 70, volume: -9 },
    },
    {
      name: 'Neuro wobble',
      params: { unison: 2, detune: 15, oscBSemi: -12, oscBFine: 0, cutoff: 600, resonance: 40, drive: 50, formant: 40, dist: 40, fold: 15,
        lfo1Shape: LFO_SHAPE.sine, lfo1Rate: LFO_RATE['1/8'], lfo1Dest: MOD_DEST.cutoff, lfo1Amount: 70, lfo1Dest2: MOD_DEST.vowel, lfo1Amount2: 40,
        volume: -11 },
    },
    {
      // the vowels opening and closing in time, like a talkbox
      name: 'Talkbox',
      params: { unison: 1, oscA: 0, oscB: 1, mix: 40, cutoff: 2500, resonance: 20, drive: 30, formant: 90, vowel: 20, dist: 15, glide: 60,
        lfo1Shape: LFO_SHAPE.triangle, lfo1Rate: LFO_RATE['1/4'], lfo1Dest: MOD_DEST.vowel, lfo1Amount: 80, volume: -10 },
    },
    {
      // the rave's phrygian bass writing itself, leaving the downbeat to the kick
      name: 'Phrygian bass',
      params: { oscA: 0, oscB: 1, oscBFine: -7, mix: 35, unison: 1, cutoff: 800, resonance: 30, drive: 35, keyTrack: 40, dist: 20, sub: 75,
        crossover: 120, voiceMode: 0, glide: 0, decay: 0.16, sustain: 35, release: 0.06, mDecay: 0.1, envDest: MOD_DEST.cutoff, envAmount: 50,
        volume: -7, seqOn: 1, seqKick: 1, seqScale: SEQ_SCALE.Phrygian, seqRate: SEQ_RATE['1/16'], seqDensity: 70, seqRange: 25, seqAccent: 30,
        seqSlide: 10, seqGate: 55 },
    },
    {
      name: 'Slow growl',
      params: { unison: 2, detune: 14, oscBSemi: -12, oscBFine: 0, fm: 25, fmRatio: 2, fold: 20, cutoff: 1800, resonance: 25, drive: 50,
        formant: 45, dist: 40, lfo1Shape: LFO_SHAPE.triangle, lfo1Rate: LFO_RATE['2 bars'], lfo1Retrig: 1, lfo1Dest: MOD_DEST.fm,
        lfo1Amount: 50, lfo1Dest2: MOD_DEST.vowel, lfo1Amount2: 60, volume: -12 },
    },
    {
      name: 'Industrial',
      params: { unison: 3, detune: 30, fm: 30, fmRatio: 4, fold: 55, cutoff: 3000, resonance: 30, drive: 80, dist: 80, sub: 50,
        lfo1Shape: LFO_SHAPE.sampleHold, lfo1Rate: LFO_RATE['1/16'], lfo1Dest: MOD_DEST.fold, lfo1Amount: 30, volume: -12 },
    },
    {
      name: 'Sub with bite',
      params: { unison: 1, mix: 30, cutoff: 600, resonance: 30, drive: 40, dist: 15, sub: 90, crossover: 160, mDecay: 0.08,
        envDest: MOD_DEST.cutoff, envAmount: 60, decay: 0.5, sustain: 70, volume: -7 },
    },
    {
      name: 'Dark reese',
      params: { unison: 5, detune: 30, oscBFine: -20, cutoff: 450, resonance: 20, drive: 40, dist: 30, sub: 80, crossover: 90,
        lfo1Shape: LFO_SHAPE.triangle, lfo1Rate: LFO_RATE['4 bars'], lfo1Retrig: 1, lfo1Dest: MOD_DEST.cutoff, lfo1Amount: 30,
        lfo2Shape: LFO_SHAPE.smoothRandom, lfo2Rate: LFO_RATE['1 bar'], lfo2Retrig: 1, lfo2Dest: MOD_DEST.detune, lfo2Amount: 30, volume: -11 },
    },
    {
      name: 'Neuro stab',
      params: { unison: 3, detune: 20, fold: 25, cutoff: 900, resonance: 35, drive: 55, formant: 60, vowel: 30, dist: 40, decay: 0.22,
        sustain: 0, release: 0.12, mDecay: 0.15, envDest: MOD_DEST.vowel, envAmount: 70, envDest2: MOD_DEST.cutoff, envAmount2: 50, volume: -10 },
    },
    {
      // at every sixteenth another vowel and another filter, at random
      name: 'Glitch S&H',
      params: { unison: 2, detune: 12, cutoff: 1500, resonance: 40, drive: 45, formant: 70, dist: 35, lfo1Shape: LFO_SHAPE.sampleHold,
        lfo1Rate: LFO_RATE['1/16'], lfo1Dest: MOD_DEST.vowel, lfo1Amount: 80, lfo1Dest2: MOD_DEST.cutoff, lfo1Amount2: 40, volume: -11 },
    },
    {
      // the note falling at the attack: the bass's hit
      name: 'Fall',
      params: { unison: 2, detune: 15, cutoff: 1400, resonance: 25, drive: 45, dist: 30, sub: 70, mDecay: 0.18, envDest: MOD_DEST.pitch,
        envAmount: 40, envDest2: MOD_DEST.cutoff, envAmount2: 40, decay: 0.6, sustain: 60, volume: -9 },
    },
  ],
};
