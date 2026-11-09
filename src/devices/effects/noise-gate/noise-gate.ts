/* "Noise Gate": lets the sound through only when it exceeds the threshold, and below closes it: it removes the
 * noise between one hit and the next, tightens the tails of a drum kit, separates the hits of a track
 * with bleed from other microphones. It opens above "Threshold" and closes again below "Threshold" minus
 * "Hysteresis", so a sound hovering around there doesn't make it chatter. "Hold" keeps it open a little
 * longer, "Range" says how much it closes (−80 dB is silence), "Invert" does the opposite (it
 * closes when the sound is loud). The filters and the sidechain concern only what the detector
 * listens to: with the sidechain the gate opens to the rhythm of another track. Not to be confused with
 * the Trance Gate, which opens and closes in time following a pattern. The sound is in noise-gate-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def });

export const NOISE_GATE: DeviceType = {
  type: 'noise-gate',
  label: 'Noise Gate',
  sidechain: true,
  sections: [
    {
      label: 'Threshold',
      params: [
        num('threshold', 'Threshold', -80, 0, -40, 'dB', { step: 0.1 }),
        num('hysteresis', 'Hysteresis', 0, 24, 3, 'dB', { step: 0.1 }),
        num('floor', 'Return', -80, 0, -80, 'dB', { step: 0.1 }),
        choice('flip', 'Invert', ['Off', 'On']),
      ],
    },
    {
      label: 'Times',
      params: [
        num('attack', 'Attack', 0.05, 100, 0.5, 'ms', { scale: 'log', step: 0.01 }),
        num('hold', 'Hold', 0, 500, 20, 'ms', { step: 1 }),
        num('release', 'Release', 1, 2000, 80, 'ms', { scale: 'log', step: 1 }),
      ],
    },
    {
      label: 'Detector',
      params: [
        num('scHp', 'High-pass', 20, 2000, 20, 'Hz', { scale: 'log', step: 1 }),
        num('scLp', 'Low-pass', 200, 20000, 20000, 'Hz', { scale: 'log', step: 1 }),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Remove the noise', params: { threshold: -50, hysteresis: 6, attack: 1, hold: 50, release: 150 } },
    { name: 'Tight snare', params: { threshold: -24, hysteresis: 4, attack: 0.2, hold: 10, release: 60, scHp: 180 } },
    { name: 'Dry kick', params: { threshold: -22, hysteresis: 4, attack: 0.1, hold: 25, release: 90, scLp: 900 } },
    { name: 'Cut tail', params: { threshold: -30, hysteresis: 2, attack: 0.5, hold: 0, release: 15 } },
    { name: 'Soft return', params: { threshold: -36, hysteresis: 6, floor: -14, attack: 2, hold: 30, release: 200 } },
    { name: 'Rhythm from the sidechain', params: { threshold: -30, hysteresis: 3, attack: 0.5, hold: 5, release: 40 } },
  ],
};
