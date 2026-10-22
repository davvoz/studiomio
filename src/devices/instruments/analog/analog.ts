/* "Analog": il primo synth di studiomio. Sottrattivo classico: due oscillatori, filtro
 * risonante con il suo inviluppo, inviluppo del volume e un LFO. Si suona polifonico o a una
 * voce: in "Legato" le note che si sovrappongono scivolano l'una nell'altra senza ripartire
 * (lo slide della 303), e l'accento rende più forti e più aperte le note con velocity alta.
 * Qui c'è solo la descrizione (parametri e preset); il suono è in analog-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';
import { TEMPO_RATE, TEMPO_RATES } from '../../rates';
import { SEQUENCER_SECTION } from '../../sequencer';

export const WAVES = ['Saw', 'Square', 'Triangle', 'Sine'] as const;
export const FILTER_TYPES = ['Low-pass', 'Band-pass', 'High-pass'] as const;
export const LFO_WAVES = ['Sine', 'Triangle', 'Square'] as const;
/** La velocità dell'LFO: a tempo (una divisione) o libera in Hz. */
export const LFO_SYNC = { tempo: 0, hz: 1 } as const;
/** Poli: ogni nota la sua voce. Mono: una voce, ogni nota riparte (con glide se c'è). Legato:
 *  una voce, le note sovrapposte scivolano senza far ripartire gli inviluppi. */
export const VOICE_MODES = ['Poli', 'Mono', 'Legato'] as const;
export const VOICE_MODE = { poly: 0, mono: 1, legato: 2 } as const;
/** Quante copie scordate di ogni voce al massimo (unison, il "supersaw"). */
export const MAX_UNISON = 7;
/** Sopra questa velocity una nota è accentata (come gli accenti di un sequencer 303). */
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
      label: 'Oscillatori',
      params: [
        choice('oscA', 'Onda A', WAVES),
        choice('oscB', 'Onda B', WAVES, 1),
        num('oscBSemi', 'B semitoni', -24, 24, 0, 'st', { step: 1 }),
        num('oscBFine', 'B fine', -50, 50, 7, 'ct', { step: 1 }),
        percent('mix', 'Mix A/B', 50),
      ],
    },
    {
      label: 'Unison',
      params: [
        num('unison', 'Copie', 1, MAX_UNISON, 1, '', { step: 1 }),
        num('detune', 'Scordatura', 0, 100, 25, 'ct', { step: 1, when: { param: 'unison', is: [2, 3, 4, 5, 6, 7] } }),
        { ...percent('spread', 'Apertura', 80), when: { param: 'unison', is: [2, 3, 4, 5, 6, 7] } },
      ],
    },
    {
      label: 'Voce',
      params: [
        choice('voiceMode', 'Modo', VOICE_MODES),
        num('glide', 'Glide', 0, 500, 0, 'ms', { step: 1, when: { param: 'voiceMode', is: [VOICE_MODE.mono, VOICE_MODE.legato] } }),
        percent('accent', 'Accento', 0),
      ],
    },
    {
      label: 'Filtro',
      params: [
        choice('filterType', 'Tipo', FILTER_TYPES),
        num('cutoff', 'Cutoff', 20, 20000, 2400, 'Hz', { scale: 'log' }),
        percent('resonance', 'Risonanza', 20),
        percent('filterEnv', 'Inviluppo', 35, -100),
        percent('keyTrack', 'Key track', 50),
      ],
    },
    {
      label: 'Inviluppo filtro',
      params: [time('fAttack', 'Attack', 0.003), time('fDecay', 'Decay', 0.35), percent('fSustain', 'Sustain', 25), time('fRelease', 'Release', 0.25)],
    },
    {
      label: 'Inviluppo volume',
      params: [time('attack', 'Attack', 0.003), time('decay', 'Decay', 0.4), percent('sustain', 'Sustain', 80), time('release', 'Release', 0.2)],
    },
    {
      label: 'LFO',
      params: [
        choice('lfoWave', 'Onda', LFO_WAVES),
        choice('lfoSync', 'Sincro', ['Tempo', 'Hz'], LFO_SYNC.hz),
        choice('lfoDivision', 'Divisione', TEMPO_RATES.map(([l]) => l), TEMPO_RATE['1/4'], { when: { param: 'lfoSync', is: LFO_SYNC.tempo } }),
        num('lfoRate', 'Velocità', 0.05, 20, 5, 'Hz', { scale: 'log', when: { param: 'lfoSync', is: LFO_SYNC.hz } }),
        num('lfoPitch', '→ Pitch', 0, 100, 0, 'ct', { step: 1 }),
        percent('lfoCutoff', '→ Cutoff', 0),
      ],
    },
    SEQUENCER_SECTION,
    {
      label: 'Uscita',
      params: [percent('velocity', 'Velocity', 60), num('volume', 'Volume', -36, 6, -8, 'dB', { step: 0.5 })],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    {
      name: 'Basso',
      params: { oscA: 0, oscB: 1, oscBSemi: -12, oscBFine: 0, mix: 40, cutoff: 420, resonance: 30, filterEnv: 55, keyTrack: 30,
        fDecay: 0.22, fSustain: 10, fRelease: 0.1, decay: 0.3, sustain: 70, release: 0.08, volume: -6 },
    },
    {
      name: 'Acid',
      params: { oscA: 0, mix: 0, voiceMode: 2, glide: 60, accent: 70, cutoff: 300, resonance: 82, filterEnv: 70, keyTrack: 20,
        fDecay: 0.18, fSustain: 0, fRelease: 0.08, sustain: 100, release: 0.05, velocity: 35, volume: -9 },
    },
    {
      name: 'Acid quadra',
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
  ],
};
