/* "Limiter": the last link of the master. It pushes the sound (Gain) and keeps it below the Ceiling
 * without letting a peak through, looking ahead a few milliseconds: the gain drops
 * before the peak arrives, so no distortion on the attack. With "Inter-sample" it also measures
 * the peaks the converter rebuilds between one sample and the next (true peak). The
 * sound is in limiter-core.ts. */
import type { DeviceType } from '../../device-type';
import type { NumberParam } from '../../params';

const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

/** How far ahead it looks at most (milliseconds): it also sets the maximum delay. */
export const MAX_LOOKAHEAD_MS = 10;

export const LIMITER: DeviceType = {
  type: 'limiter',
  label: 'Limiter',
  sections: [
    {
      label: 'Limiter',
      params: [
        num('gain', 'Gain', 0, 24, 0, 'dB', { step: 0.1 }),
        num('ceiling', 'Ceiling', -12, 0, -0.3, 'dB', { step: 0.1 }),
        num('release', 'Release', 10, 1000, 80, 'ms', { scale: 'log', step: 1 }),
        num('lookahead', 'Lookahead', 0.5, MAX_LOOKAHEAD_MS, 2, 'ms', { scale: 'log', step: 0.1 }),
        { kind: 'choice', id: 'truePeak', label: 'Between samples', options: ['Off', 'On'], default: 1 },
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Master', params: { gain: 4, ceiling: -0.3, release: 60 } },
    { name: 'Loud', params: { gain: 8, ceiling: -0.3, release: 40, lookahead: 1.5 } },
    { name: 'Transparent', params: { gain: 2, ceiling: -1, release: 200, lookahead: 5 } },
  ],
};
