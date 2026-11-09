/* "Multiband": three-band downward compression (the peaks come down) and upward
 * (the quiet details come up), like the OTT: the dense, close and aggressive sound of today's
 * electronic music. Depth doses everything, Time lengthens attack and release together, and each
 * band has its own gain. The sound is in multiband-core.ts. */
import type { DeviceType } from '../../device-type';
import type { NumberParam } from '../../params';

const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const percent = (id: string, label: string, def: number) => num(id, label, 0, 100, def, '%', { step: 1 });

export const MULTIBAND: DeviceType = {
  type: 'multiband',
  label: 'Multiband',
  sections: [
    {
      label: 'Compression',
      params: [
        percent('depth', 'Depth', 50),
        percent('time', 'Tempo', 50),
        percent('upward', 'Upward', 100),
        percent('downward', 'Downward', 100),
        num('input', 'Input', -12, 24, 0, 'dB', { step: 0.1 }),
      ],
    },
    {
      label: 'Bands',
      params: [
        num('xLow', 'Low cut', 40, 500, 120, 'Hz', { scale: 'log', step: 1 }),
        num('xHigh', 'High cut', 1000, 10000, 2500, 'Hz', { scale: 'log', step: 1 }),
        num('low', 'Lows', -12, 12, 0, 'dB', { step: 0.1 }),
        num('mid', 'Mids', -12, 12, 0, 'dB', { step: 0.1 }),
        num('high', 'Highs', -12, 12, 0, 'dB', { step: 0.1 }),
      ],
    },
    { label: 'Output', params: [num('output', 'Output', -24, 12, 0, 'dB', { step: 0.1 }), percent('mix', 'Dry/Wet', 100)] },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'OTT', params: { depth: 100, time: 50, input: 0, output: 4 } },
    { name: 'Dense', params: { depth: 60, time: 40, output: 2 } },
    { name: 'Aggressive lead', params: { depth: 80, time: 25, input: 4, high: 2, low: -3, output: 0 } },
    { name: 'Drums', params: { depth: 45, time: 35, upward: 60, mid: 1, output: 1, mix: 70 } },
    { name: 'Light master', params: { depth: 20, time: 60, upward: 50, output: 0 } },
  ],
};
