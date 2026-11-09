/* "Phaser": the swirling movement. As Phaser it's a row of allpasses shifting the phase, and
 * summed back with the sound it makes notches in the spectrum that rise and fall; as Flanger it's a
 * very short delay that oscillates (the "jet" on reeses, hi-hats, pads). Rate synced
 * or in Hz, depth, feedback (also negative: notches instead of peaks), right channel
 * offset for stereo, mix. Here there's only the description; the sound is in phaser-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';
import { TEMPO_RATE, TEMPO_RATES } from '../../rates';

export const PHASER_MODES = ['Phaser', 'Flanger'] as const;
export const PHASER_MODE = { phaser: 0, flanger: 1 } as const;
export const PHASER_SYNC = { tempo: 0, hz: 1 } as const;
export const PHASER_STAGES = [2, 4, 6, 8, 12] as const;
export const MAX_FLANGER_MS = 15;

const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

export const PHASER: DeviceType = {
  type: 'phaser',
  label: 'Phaser',
  sections: [
    {
      label: 'Mode',
      params: [
        choice('mode', 'Mode', PHASER_MODES),
        choice('stages', 'Stages', PHASER_STAGES.map(String), 2, { when: { param: 'mode', is: PHASER_MODE.phaser } }),
        num('center', 'Centre', 100, 8000, 900, 'Hz', { scale: 'log', step: 1, when: { param: 'mode', is: PHASER_MODE.phaser } }),
        num('delay', 'Delay', 0.2, MAX_FLANGER_MS, 2.5, 'ms', { scale: 'log', step: 0.01, when: { param: 'mode', is: PHASER_MODE.flanger } }),
      ],
    },
    {
      label: 'Movement',
      params: [
        choice('sync', 'Sync', ['Tempo', 'Hz']),
        choice('division', 'Division', TEMPO_RATES.map(([l]) => l), TEMPO_RATE['1 bar'], { when: { param: 'sync', is: PHASER_SYNC.tempo } }),
        num('rate', 'Rate', 0.01, 10, 0.3, 'Hz', { scale: 'log', step: 0.01, when: { param: 'sync', is: PHASER_SYNC.hz } }),
        num('depth', 'Depth', 0, 100, 70, '%', { step: 1 }),
        num('stereo', 'Stereo', 0, 180, 90, '°', { step: 1 }),
      ],
    },
    {
      label: 'Output',
      params: [
        num('feedback', 'Feedback', -95, 95, 40, '%', { step: 1 }),
        num('mix', 'Dry/Wet', 0, 100, 50, '%', { step: 1 }),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Slow phaser', params: { division: TEMPO_RATE['4 bars'], depth: 80, feedback: 55, center: 700 } },
    { name: 'Jet', params: { mode: PHASER_MODE.flanger, delay: 1.8, division: TEMPO_RATE['2 bars'], depth: 85, feedback: 70, mix: 50 } },
    { name: 'Spinning reese', params: { mode: PHASER_MODE.flanger, delay: 4, division: TEMPO_RATE['1 bar'], depth: 60, feedback: -60, stereo: 120, mix: 40 } },
    { name: 'Metallic hats', params: { mode: PHASER_MODE.flanger, delay: 0.8, division: TEMPO_RATE['8 bars'], depth: 90, feedback: 75, mix: 45 } },
    { name: 'Throat', params: { stages: 4, center: 1200, division: TEMPO_RATE['1/2'], depth: 60, feedback: 70, mix: 50 } },
  ],
};
