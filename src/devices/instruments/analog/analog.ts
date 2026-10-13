/* "Analog": il primo synth di studiomio. Sottrattivo classico: due oscillatori, filtro
 * risonante con il suo inviluppo, inviluppo del volume e un LFO. Qui c'è solo la descrizione
 * (parametri e preset); il suono è in analog-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

export const WAVES = ['Saw', 'Square', 'Triangle', 'Sine'] as const;
export const FILTER_TYPES = ['Low-pass', 'Band-pass', 'High-pass'] as const;
export const LFO_WAVES = ['Sine', 'Triangle', 'Square'] as const;

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def });
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
        num('lfoRate', 'Velocità', 0.05, 20, 5, 'Hz', { scale: 'log' }),
        num('lfoPitch', '→ Pitch', 0, 100, 0, 'ct', { step: 1 }),
        percent('lfoCutoff', '→ Cutoff', 0),
      ],
    },
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
      params: { oscA: 0, mix: 0, cutoff: 300, resonance: 82, filterEnv: 70, keyTrack: 20, fDecay: 0.18, fSustain: 0,
        fRelease: 0.08, sustain: 100, release: 0.05, velocity: 80, volume: -9 },
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
