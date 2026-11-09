/* "Analog": studiomio's first synth. Classic subtractive: two oscillators, resonant
 * filter with its envelope, volume envelope and an LFO. It's played polyphonic or
 * monophonic: in "Legato" overlapping notes slide into each other without restarting
 * (the 303's slide), and the accent makes notes with high velocity louder and more open.
 * Here there's only the description (parameters and presets); the sound is in analog-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';
import { TEMPO_RATE, TEMPO_RATES } from '../../rates';
import { SEQ_RATE, SEQ_SCALE, SEQUENCER_SECTION } from '../../sequencer';

export const WAVES = ['Saw', 'Square', 'Triangle', 'Sine'] as const;
export const FILTER_TYPES = ['Low-pass', 'Band-pass', 'High-pass'] as const;
export const LFO_WAVES = ['Sine', 'Triangle', 'Square'] as const;
/** The LFO's rate: synced (a division) or free in Hz. */
export const LFO_SYNC = { tempo: 0, hz: 1 } as const;
/** Poly: each note its own voice. Mono: one voice, each note restarts (with glide if any). Legato:
 *  one voice, overlapping notes slide without restarting the envelopes. */
export const VOICE_MODES = ['Poly', 'Mono', 'Legato'] as const;
export const VOICE_MODE = { poly: 0, mono: 1, legato: 2 } as const;
/** How many detuned copies of each voice at most (unison, the "supersaw"). */
export const MAX_UNISON = 7;
/** Above this velocity a note is accented (like a 303 sequencer's accents). */
export const ACCENT_VELOCITY = 100;

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const time = (id: string, label: string, def: number) => num(id, label, 0.001, 10, def, 's', { scale: 'log' });
const percent = (id: string, label: string, def: number, min = 0) => num(id, label, min, 100, def, '%', { step: 1 });

export const ANALOG: DeviceType = {
  type: 'analog',
  label: 'Analog',
  sections: [
    {
      label: 'Oscillators',
      params: [
        choice('oscA', 'Wave A', WAVES),
        choice('oscB', 'Wave B', WAVES, 1),
        num('oscBSemi', 'B semitones', -24, 24, 0, 'st', { step: 1 }),
        num('oscBFine', 'B fine', -50, 50, 7, 'ct', { step: 1 }),
        percent('mix', 'Mix A/B', 50),
      ],
    },
    {
      label: 'Unison',
      params: [
        num('unison', 'Copies', 1, MAX_UNISON, 1, '', { step: 1 }),
        num('detune', 'Detuning', 0, 100, 25, 'ct', { step: 1, when: { param: 'unison', is: [2, 3, 4, 5, 6, 7] } }),
        { ...percent('spread', 'Opening', 80), when: { param: 'unison', is: [2, 3, 4, 5, 6, 7] } },
      ],
    },
    {
      label: 'Voice',
      params: [
        choice('voiceMode', 'Mode', VOICE_MODES),
        num('glide', 'Glide', 0, 500, 0, 'ms', { step: 1, when: { param: 'voiceMode', is: [VOICE_MODE.mono, VOICE_MODE.legato] } }),
        percent('accent', 'Accent', 0),
      ],
    },
    {
      label: 'Filter',
      params: [
        choice('filterType', 'Type', FILTER_TYPES),
        num('cutoff', 'Cutoff', 20, 20000, 2400, 'Hz', { scale: 'log' }),
        percent('resonance', 'Resonance', 20),
        percent('filterEnv', 'Envelope', 35, -100),
        percent('keyTrack', 'Key track', 50),
      ],
    },
    {
      label: 'Filter envelope',
      params: [time('fAttack', 'Attack', 0.003), time('fDecay', 'Decay', 0.35), percent('fSustain', 'Sustain', 25), time('fRelease', 'Release', 0.25)],
    },
    {
      label: 'Volume envelope',
      params: [time('attack', 'Attack', 0.003), time('decay', 'Decay', 0.4), percent('sustain', 'Sustain', 80), time('release', 'Release', 0.2)],
    },
    {
      label: 'LFO',
      params: [
        choice('lfoWave', 'Wave', LFO_WAVES),
        choice('lfoSync', 'Sync', ['Tempo', 'Hz'], LFO_SYNC.hz),
        choice('lfoDivision', 'Division', TEMPO_RATES.map(([l]) => l), TEMPO_RATE['1/4'], { when: { param: 'lfoSync', is: LFO_SYNC.tempo } }),
        num('lfoRate', 'Rate', 0.05, 20, 5, 'Hz', { scale: 'log', when: { param: 'lfoSync', is: LFO_SYNC.hz } }),
        num('lfoPitch', '→ Pitch', 0, 100, 0, 'ct', { step: 1 }),
        percent('lfoCutoff', '→ Cutoff', 0),
      ],
    },
    SEQUENCER_SECTION,
    {
      label: 'Output',
      params: [percent('velocity', 'Velocity', 60), num('volume', 'Volume', -36, 6, -8, 'dB', { step: 0.5 })],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    {
      name: 'Bass',
      params: { oscA: 0, oscB: 1, oscBSemi: -12, oscBFine: 0, mix: 40, cutoff: 420, resonance: 30, filterEnv: 55, keyTrack: 30,
        fDecay: 0.22, fSustain: 10, fRelease: 0.1, decay: 0.3, sustain: 70, release: 0.08, volume: -6 },
    },
    {
      name: 'Acid',
      params: { oscA: 0, mix: 0, voiceMode: 2, glide: 60, accent: 70, cutoff: 300, resonance: 82, filterEnv: 70, keyTrack: 20,
        fDecay: 0.18, fSustain: 0, fRelease: 0.08, sustain: 100, release: 0.05, velocity: 35, volume: -9 },
    },
    {
      name: 'Square acid',
      params: { oscA: 1, mix: 0, voiceMode: 2, glide: 70, accent: 85, cutoff: 220, resonance: 88, filterEnv: 80, keyTrack: 25,
        fDecay: 0.24, fSustain: 0, fRelease: 0.08, sustain: 100, release: 0.04, velocity: 35, volume: -10 },
    },
    {
      name: 'Pad',
      params: { oscA: 0, oscB: 0, oscBFine: 12, mix: 50, cutoff: 1400, resonance: 12, filterEnv: 20, fAttack: 0.8, fDecay: 1.5,
        fSustain: 60, fRelease: 1.2, attack: 0.6, decay: 1, sustain: 85, release: 1.4, lfoRate: 0.3, lfoCutoff: 15, velocity: 30, volume: -14 },
    },
    {
      name: 'Pluck',
      params: { oscA: 1, oscB: 0, oscBSemi: 12, oscBFine: 4, mix: 35, cutoff: 600, resonance: 25, filterEnv: 65, fDecay: 0.25,
        fSustain: 0, fRelease: 0.25, decay: 0.45, sustain: 0, release: 0.3, volume: -10 },
    },
    {
      name: 'Lead',
      params: { oscA: 0, oscB: 1, oscBSemi: 0, oscBFine: 9, mix: 50, cutoff: 3200, resonance: 35, filterEnv: 25, fDecay: 0.5,
        fSustain: 50, attack: 0.01, sustain: 90, release: 0.15, lfoRate: 5.5, lfoPitch: 18, volume: -12 },
    },
    // ---- basses
    {
      // a single clean sine: the sub under the kick
      name: 'Sub',
      params: { oscA: 3, mix: 0, cutoff: 900, resonance: 0, filterEnv: 0, keyTrack: 100, voiceMode: VOICE_MODE.mono, glide: 25,
        decay: 0.4, sustain: 100, release: 0.08, velocity: 20, volume: -11 },
    },
    {
      name: 'Pulsing bass',
      params: { oscA: 0, oscB: 1, oscBSemi: -12, oscBFine: 0, mix: 45, cutoff: 260, resonance: 40, filterEnv: 75, keyTrack: 30, fDecay: 0.12,
        fSustain: 0, fRelease: 0.06, decay: 0.2, sustain: 50, release: 0.05, voiceMode: VOICE_MODE.mono, velocity: 40, volume: -7 },
    },
    {
      // the bass that writes itself on the offbeat: with the transport running, hold the root
      name: 'Offbeat bass',
      params: { oscA: 0, oscB: 0, oscBFine: -8, mix: 40, cutoff: 500, resonance: 30, filterEnv: 55, keyTrack: 30, fDecay: 0.1,
        fSustain: 5, decay: 0.18, sustain: 30, release: 0.05, voiceMode: VOICE_MODE.mono, volume: -7,
        seqOn: 1, seqKick: 1, seqScale: SEQ_SCALE.Phrygian, seqRate: SEQ_RATE['1/16'], seqDensity: 75, seqRange: 15, seqGate: 45, seqAccent: 20, seqSlide: 0 },
    },
    {
      name: 'Frantic acid',
      params: { oscA: 0, mix: 0, voiceMode: VOICE_MODE.legato, glide: 55, accent: 90, cutoff: 350, resonance: 88, filterEnv: 80, keyTrack: 20,
        fDecay: 0.14, fSustain: 0, fRelease: 0.06, sustain: 100, release: 0.04, velocity: 35, volume: -10,
        seqOn: 1, seqScale: SEQ_SCALE['Phrygian and tritone'], seqRate: SEQ_RATE['1/16'], seqDensity: 92, seqRange: 70, seqSlide: 45, seqAccent: 55, seqGate: 60 },
    },
    {
      name: 'Funk bass',
      params: { oscA: 1, oscB: 0, oscBSemi: 0, oscBFine: 5, mix: 30, cutoff: 380, resonance: 55, filterEnv: 85, keyTrack: 40, fDecay: 0.09,
        fSustain: 15, decay: 0.25, sustain: 60, release: 0.06, voiceMode: VOICE_MODE.mono, glide: 15, velocity: 70, volume: -8 },
    },
    {
      // two wide dark saws, with the filter breathing over two bars
      name: 'Analog reese',
      params: { oscA: 0, oscB: 0, oscBFine: -16, mix: 50, unison: 3, detune: 30, spread: 40, cutoff: 700, resonance: 15, filterEnv: 10,
        keyTrack: 30, sustain: 100, release: 0.1, voiceMode: VOICE_MODE.mono, glide: 30, lfoWave: 1, lfoSync: LFO_SYNC.tempo,
        lfoDivision: TEMPO_RATE['2 bars'], lfoCutoff: 20, volume: -9 },
    },
    // ---- accordi e stab
    {
      // the rave stab: seven wide saws, the filter closing right away
      name: 'Rave stab',
      params: { oscA: 0, oscB: 0, oscBFine: 10, mix: 50, unison: 5, detune: 30, spread: 90, cutoff: 1800, resonance: 25, filterEnv: 50,
        fDecay: 0.25, fSustain: 10, decay: 0.35, sustain: 0, release: 0.2, velocity: 50, volume: -3 },
    },
    {
      // the short dub techno chord, to send into the delay
      name: 'Dub chord',
      params: { oscA: 0, oscB: 1, oscBFine: 6, mix: 40, cutoff: 650, resonance: 35, filterEnv: 30, keyTrack: 60, fDecay: 0.3, fSustain: 0,
        decay: 0.28, sustain: 0, release: 0.3, lfoSync: LFO_SYNC.tempo, lfoDivision: TEMPO_RATE['4 bars'], lfoCutoff: 15, volume: -1 },
    },
    {
      name: 'Analog strings',
      params: { oscA: 0, oscB: 0, oscBFine: 14, mix: 50, unison: 4, detune: 22, spread: 100, cutoff: 2600, resonance: 5, filterEnv: 0,
        attack: 0.5, decay: 1, sustain: 90, release: 1.2, lfoRate: 4.5, lfoPitch: 6, velocity: 30, volume: -16 },
    },
    {
      name: 'Analog brass',
      params: { oscA: 0, oscB: 0, oscBFine: 8, mix: 50, unison: 2, detune: 15, cutoff: 700, resonance: 15, filterEnv: 60, keyTrack: 40,
        fAttack: 0.05, fDecay: 0.4, fSustain: 50, fRelease: 0.2, attack: 0.02, sustain: 90, release: 0.2, velocity: 50, volume: -12 },
    },
    {
      name: 'Dark pad',
      params: { oscA: 0, oscB: 2, oscBSemi: -12, mix: 45, unison: 3, detune: 18, cutoff: 500, resonance: 20, filterEnv: 10, fAttack: 1.5,
        fDecay: 2, fSustain: 70, attack: 1.5, decay: 1, sustain: 90, release: 2.5, lfoWave: 1, lfoSync: LFO_SYNC.tempo,
        lfoDivision: TEMPO_RATE['2 bars'], lfoCutoff: 25, velocity: 20, volume: -8 },
    },
    // ---- leads and sounds
    {
      name: 'Fifth lead',
      params: { oscA: 0, oscB: 0, oscBSemi: 7, oscBFine: 3, mix: 45, cutoff: 2500, resonance: 30, filterEnv: 30, fDecay: 0.3, fSustain: 60,
        voiceMode: VOICE_MODE.legato, glide: 50, sustain: 95, release: 0.2, lfoRate: 5, lfoPitch: 8, volume: -13 },
    },
    {
      name: 'Portamento lead',
      params: { oscA: 1, oscB: 0, oscBSemi: 12, oscBFine: 5, mix: 40, cutoff: 3500, resonance: 25, filterEnv: 20, voiceMode: VOICE_MODE.legato,
        glide: 150, sustain: 100, release: 0.15, lfoRate: 5.2, lfoPitch: 14, volume: -12 },
    },
    {
      name: 'Analog organ',
      params: { oscA: 1, oscB: 2, oscBSemi: 12, mix: 50, cutoff: 6000, resonance: 0, filterEnv: 0, keyTrack: 100, attack: 0.005, decay: 0.1,
        sustain: 100, release: 0.05, lfoRate: 6, lfoPitch: 4, velocity: 0, volume: -13 },
    },
    {
      name: 'Little bell',
      params: { oscA: 2, oscB: 3, oscBSemi: 24, mix: 40, cutoff: 5000, resonance: 0, filterEnv: 0, keyTrack: 100, decay: 1.2, sustain: 0,
        release: 1, velocity: 60, volume: -9 },
    },
    {
      // a nasal square in the band-pass, vibrating in sixteenths
      name: 'Mosquito',
      params: { oscA: 1, oscB: 1, oscBFine: 12, mix: 50, filterType: 1, cutoff: 1800, resonance: 70, filterEnv: 40, fDecay: 0.2,
        voiceMode: VOICE_MODE.mono, glide: 40, sustain: 100, release: 0.1, lfoSync: LFO_SYNC.tempo, lfoDivision: TEMPO_RATE['1/16'],
        lfoCutoff: 30, volume: -8 },
    },
    {
      name: 'Dub pluck',
      params: { oscA: 2, oscB: 1, oscBFine: 4, mix: 35, cutoff: 900, resonance: 30, filterEnv: 50, fDecay: 0.15, fSustain: 0, decay: 0.25,
        sustain: 0, release: 0.2, volume: -9 },
    },
  ],
};
