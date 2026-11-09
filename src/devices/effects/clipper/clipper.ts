/* "Clipper": cuts the peaks above the Ceiling, with no times (neither attack nor release): the
 * waveform flattens only where it exceeds. On the kick and on the drum bus it removes the attack's
 * peaks and leaves the body; before the master's Limiter it takes the shortest peaks (the
 * kick, the claps), so the limiter works less and the mix sounds loud without pumping. The Knee
 * softens the input into the curve (0 = hard clipping, 100 = tanh saturation). It runs
 * oversampled: the clipping's harmonics don't fold back. The sound is in clipper-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

/** The oversampling factors, in the order of the values of the "Quality" parameter. */
export const CLIPPER_OVERSAMPLING = [2, 4, 8] as const;

const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def: number): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def });

export const CLIPPER: DeviceType = {
  type: 'clipper',
  label: 'Clipper',
  sections: [
    {
      label: 'Cut',
      params: [
        num('drive', 'Input', 0, 24, 0, 'dB', { step: 0.1 }),
        num('ceiling', 'Ceiling', -24, 0, -0.3, 'dB', { step: 0.1 }),
        num('knee', 'Knee', 0, 100, 30, '%', { step: 1 }),
      ],
    },
    {
      label: 'Output',
      params: [
        num('output', 'Output', -24, 12, 0, 'dB', { step: 0.1 }),
        choice('oversampling', 'Oversampling', CLIPPER_OVERSAMPLING.map(f => `${f}×`), 1),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Kick', params: { drive: 4, ceiling: -3, knee: 20 } },
    { name: 'Drums', params: { drive: 3, ceiling: -1, knee: 40 } },
    { name: 'Master', params: { drive: 2, ceiling: -0.8, knee: 25 } },
    { name: 'Saturation', params: { drive: 9, ceiling: -6, knee: 100, output: 3 } },
  ],
};
