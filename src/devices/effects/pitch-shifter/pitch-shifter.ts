/* "Pitch Shifter": shifts the pitch without changing the tempo, like studio harmonizers.
 * Semitones and Fine say by how much (up to two octaves up or down); Window is the grain: short
 * sounds metallic and robotic, long smoother but with an echo. Stereo detunes the left down and
 * the right up (the voice doubling); Feedback sends the shifted sound back in, so it rises
 * (or falls) in a spiral; Glide makes the Semitones changes slide, for macro dives. Here there's only
 * the description; the sound is in pitch-shifter-core.ts. */
import type { DeviceType } from '../../device-type';
import type { NumberParam } from '../../params';

export const MAX_SHIFT = 24;
export const MIN_WINDOW_MS = 10;
export const MAX_WINDOW_MS = 200;

const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

export const PITCH_SHIFTER: DeviceType = {
  type: 'pitchShifter',
  label: 'Pitch Shifter',
  sections: [
    {
      label: 'Pitch',
      params: [
        num('semitones', 'Semitones', -MAX_SHIFT, MAX_SHIFT, 0, 'st', { step: 1 }),
        num('fine', 'Fine', -50, 50, 0, 'ct', { step: 1 }),
        num('glide', 'Glide', 0, 2000, 20, 'ms', { scale: 'log', step: 1 }),
      ],
    },
    {
      label: 'Sound',
      params: [
        num('window', 'Window', MIN_WINDOW_MS, MAX_WINDOW_MS, 60, 'ms', { scale: 'log', step: 1 }),
        num('spread', 'Stereo', 0, 50, 0, 'ct', { step: 1 }),
        num('feedback', 'Feedback', 0, 95, 0, '%', { step: 1 }),
      ],
    },
    { label: 'Output', params: [num('mix', 'Dry/Wet', 0, 100, 100, '%', { step: 1 })] },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Octave down', params: { semitones: -12, window: 80 } },
    { name: 'Octave up', params: { semitones: 12, window: 40 } },
    { name: 'Demon', params: { semitones: -7, window: 90, mix: 100 } },
    { name: 'Doubling', params: { spread: 18, window: 30, mix: 50 } },
    { name: 'Fifth', params: { semitones: 7, mix: 40 } },
    { name: 'Spiral', params: { semitones: 12, window: 120, feedback: 60, mix: 35 } },
    { name: 'Robot', params: { window: 12, spread: 8 } },
  ],
};
