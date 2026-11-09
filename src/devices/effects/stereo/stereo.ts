/* "Stereo": Live's Utility for the image. Width (0 % mono, 100 % as it is, up to 200 %),
 * "Mono bass" which below the chosen frequency removes the side (the difference between the channels): the sub
 * and the kick stay in the centre, as club systems and vinyl want, while above it the
 * sound stays wide. And a gain. The sound is in stereo-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const bassMono: ChoiceParam = { kind: 'choice', id: 'bassMono', label: 'Mono lows', options: ['Off', 'On'], default: 1 };

export const STEREO: DeviceType = {
  type: 'stereo',
  label: 'Stereo',
  sections: [
    {
      label: 'Image',
      params: [
        num('width', 'Width', 0, 200, 100, '%', { step: 1 }),
        bassMono,
        num('monoFreq', 'Below', 40, 400, 120, 'Hz', { scale: 'log', when: { param: 'bassMono', is: 1 } }),
      ],
    },
    { label: 'Output', params: [num('gain', 'Gain', -24, 12, 0, 'dB', { step: 0.1 })] },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Master', params: { monoFreq: 110 } },
    { name: 'Mono bass', params: { monoFreq: 200 } },
    { name: 'Wide', params: { width: 140, monoFreq: 150 } },
    { name: 'Mono', params: { width: 0 } },
  ],
};
