/* "Auto Pan": like Live's Auto Pan. An LFO (the same waves as the Auto Filter, locked to the
 * bar if synced) lowers and raises the volume of the two channels: with Stereo at 180° the channels
 * go in antiphase and the sound moves from one side to the other; at 0° they move together and it's a
 * tremolo. Phase shifts the cycle relative to the bar. Here there's only the description; the sound is
 * in auto-pan-core.ts. */
import type { DeviceType } from '../../device-type';
import { LFO_SHAPE, LFO_SHAPES } from '../../dsp/lfo';
import type { ChoiceParam, NumberParam } from '../../params';
import { TEMPO_RATE, TEMPO_RATES } from '../../rates';

export const AUTO_PAN_SYNC = { tempo: 0, hz: 1 } as const;

const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

export const AUTO_PAN: DeviceType = {
  type: 'autoPan',
  label: 'Auto Pan',
  sections: [
    {
      label: 'LFO',
      params: [
        num('amount', 'Amount', 0, 100, 100, '%', { step: 1 }),
        choice('shape', 'Wave', LFO_SHAPES),
        choice('sync', 'Sync', ['Tempo', 'Hz']),
        choice('division', 'Division', TEMPO_RATES.map(([l]) => l), TEMPO_RATE['1/2'], { when: { param: 'sync', is: AUTO_PAN_SYNC.tempo } }),
        num('rate', 'Rate', 0.01, 20, 1, 'Hz', { scale: 'log', step: 0.01, when: { param: 'sync', is: AUTO_PAN_SYNC.hz } }),
      ],
    },
    {
      label: 'Phase',
      params: [
        num('stereo', 'Stereo', 0, 180, 180, '°', { step: 1 }),
        num('phase', 'Phase', 0, 360, 0, '°', { step: 1 }),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Slow pan', params: { division: TEMPO_RATE['2 bars'], amount: 70 } },
    { name: 'Eighths pan', params: { division: TEMPO_RATE['1/8'], shape: LFO_SHAPE.triangle, amount: 60 } },
    { name: 'Tremolo', params: { stereo: 0, division: TEMPO_RATE['1/16'], amount: 60 } },
    { name: 'Vintage tremolo', params: { stereo: 0, sync: AUTO_PAN_SYNC.hz, rate: 5, amount: 45 } },
    { name: 'Square bounces', params: { shape: LFO_SHAPE.square, division: TEMPO_RATE['1/8'], amount: 80 } },
    { name: 'Random pan', params: { shape: LFO_SHAPE.smoothRandom, division: TEMPO_RATE['1/4'], amount: 70 } },
  ],
};
