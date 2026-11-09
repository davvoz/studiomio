/* "Chorus": copies of the sound slightly delayed, with the delay wobbling slowly, so they detune a
 * little and the sound widens. Chorus: two voices in antiphase; Ensemble: three voices offset by a
 * third of a cycle, denser (the strings of '80s synths); Vibrato: a single voice, without the
 * dry sound, and the pitch oscillating. The right channel wobbles offset (Width) for stereo;
 * the feedback sends the voices back in (towards the flanger). The LFO can be tempo-synced, locked
 * to the bar. Here there's only the description; the sound is in chorus-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';
import { TEMPO_RATE, TEMPO_RATES } from '../../rates';

export const CHORUS_MODES = ['Chorus', 'Ensemble', 'Vibrato'] as const;
export const CHORUS_MODE = { chorus: 0, ensemble: 1, vibrato: 2 } as const;
export const CHORUS_SYNC = { tempo: 0, hz: 1 } as const;

/** How much the delay wobbles, back and forth, with Depth at 100%. */
export const MAX_DEPTH_MS = 6;
export const MAX_DELAY_MS = 30;

const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

export const CHORUS: DeviceType = {
  type: 'chorus',
  label: 'Chorus',
  sections: [
    {
      label: 'Voices',
      params: [
        choice('mode', 'Mode', CHORUS_MODES),
        num('delay', 'Delay', 1, MAX_DELAY_MS, 10, 'ms', { scale: 'log', step: 0.1 }),
        num('feedback', 'Feedback', -90, 90, 0, '%', { step: 1 }),
      ],
    },
    {
      label: 'Movement',
      params: [
        choice('sync', 'Sync', ['Tempo', 'Hz'], CHORUS_SYNC.hz),
        choice('division', 'Division', TEMPO_RATES.map(([l]) => l), TEMPO_RATE['1 bar'], { when: { param: 'sync', is: CHORUS_SYNC.tempo } }),
        num('rate', 'Rate', 0.05, 10, 0.8, 'Hz', { scale: 'log', step: 0.01, when: { param: 'sync', is: CHORUS_SYNC.hz } }),
        num('depth', 'Depth', 0, 100, 40, '%', { step: 1 }),
        num('width', 'Width', 0, 100, 100, '%', { step: 1 }),
      ],
    },
    { label: 'Output', params: [num('mix', 'Dry/Wet', 0, 100, 50, '%', { step: 1, when: { param: 'mode', is: [CHORUS_MODE.chorus, CHORUS_MODE.ensemble] } })] },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Wide chorus', params: { delay: 14, rate: 0.5, depth: 55, mix: 50 } },
    { name: 'String ensemble', params: { mode: CHORUS_MODE.ensemble, delay: 9, rate: 0.6, depth: 45, mix: 60 } },
    { name: 'Vibrato', params: { mode: CHORUS_MODE.vibrato, delay: 4, rate: 5.5, depth: 30 } },
    { name: 'Tempo chorus', params: { sync: CHORUS_SYNC.tempo, division: TEMPO_RATE['2 bars'], depth: 50, mix: 45 } },
    { name: 'Almost flanger', params: { delay: 3, depth: 60, feedback: 60, rate: 0.25, mix: 50 } },
  ],
};
