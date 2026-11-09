/* "Redux": the lo-fi sound of old samplers and video games. It lowers the sample
 * rate (each sample stays still until the next arrives: the stepped waveform
 * and the folding frequencies) and the bits (the stepped volume, the grainy hiss).
 * Jitter makes the sample step irregular; the filter can remove the frequencies that would
 * fold back (Pre) or smooth the steps (Post). Here there's only the description; the sound is
 * in redux-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

export const REDUX_FILTERS = ['Off', 'Before', 'After'] as const;
export const REDUX_FILTER = { off: 0, pre: 1, post: 2 } as const;

/** The highest frequency: from here up (beyond the project rate) it reduces nothing any more. */
export const MAX_RATE = 48000;
export const MAX_BITS = 16;

const choice = (id: string, label: string, options: readonly string[], def = 0): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def });
const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

export const REDUX: DeviceType = {
  type: 'redux',
  label: 'Redux',
  sections: [
    {
      label: 'Samples',
      params: [
        num('rate', 'Frequency', 100, MAX_RATE, 8000, 'Hz', { scale: 'log' }),
        num('jitter', 'Jitter', 0, 100, 0, '%', { step: 1 }),
        choice('filter', 'Filter', REDUX_FILTERS),
      ],
    },
    { label: 'Bit', params: [num('bits', 'Bit', 1, MAX_BITS, 8, 'bit', { step: 0.1 })] },
    {
      label: 'Output',
      params: [
        num('mix', 'Dry/Wet', 0, 100, 100, '%', { step: 1 }),
        num('output', 'Output', -24, 12, 0, 'dB', { step: 0.1 }),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: '12-bit sampler', params: { rate: 26000, bits: 12, filter: REDUX_FILTER.post } },
    { name: 'Video game', params: { rate: 5500, bits: 4 } },
    { name: 'Broken telephone', params: { rate: 3000, bits: 6, jitter: 30, filter: REDUX_FILTER.pre } },
    { name: 'Dust', params: { rate: 16000, bits: 10, mix: 40 } },
    { name: 'Wrecked', params: { rate: 800, bits: 2, jitter: 60, output: -6 } },
  ],
};
