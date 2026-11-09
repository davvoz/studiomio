/* "Reverb": a room, a hall or a long tail to throw vocals and snares into. Size
 * and decay separate (as in studio algorithmic reverbs), pre-delay to detach the
 * tail from the hit, high damping (the walls absorb the high frequencies first), low cut
 * on the tail (so it doesn't get muddy), stereo width and mix. The sound is in reverb-core.ts. */
import type { DeviceType } from '../../device-type';
import type { NumberParam } from '../../params';

const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

export const MAX_PREDELAY_MS = 250;

export const REVERB: DeviceType = {
  type: 'reverb',
  label: 'Reverb',
  sections: [
    {
      label: 'Space',
      params: [
        num('size', 'Size', 10, 100, 60, '%', { step: 1 }),
        num('decay', 'Decay', 0.2, 20, 2.2, 's', { scale: 'log', step: 0.01 }),
        num('predelay', 'Pre-delay', 0, MAX_PREDELAY_MS, 20, 'ms', { step: 1 }),
        num('diffusion', 'Diffusion', 0, 100, 70, '%', { step: 1 }),
      ],
    },
    {
      label: 'Colour',
      params: [
        num('damping', 'Damping', 1000, 20000, 7000, 'Hz', { scale: 'log', step: 1 }),
        num('lowCut', 'Low cut', 20, 1000, 150, 'Hz', { scale: 'log', step: 1 }),
        num('width', 'Width', 0, 100, 100, '%', { step: 1 }),
      ],
    },
    { label: 'Output', params: [num('mix', 'Dry/Wet', 0, 100, 25, '%', { step: 1 })] },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Room', params: { size: 30, decay: 0.7, predelay: 5, damping: 9000, mix: 18 } },
    { name: 'Hall', params: { size: 75, decay: 2.8, predelay: 25, damping: 6000, mix: 25 } },
    { name: 'Cymbal', params: { size: 55, decay: 1.6, predelay: 10, diffusion: 90, damping: 12000, lowCut: 250, mix: 22 } },
    { name: 'Vocal throw', params: { size: 85, decay: 4.5, predelay: 60, damping: 5000, lowCut: 300, mix: 35 } },
    { name: 'Endless tail', params: { size: 100, decay: 18, predelay: 0, damping: 4000, lowCut: 200, mix: 50 } },
  ],
};
