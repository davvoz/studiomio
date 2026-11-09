/* "Compressor": lowers the volume when the sound exceeds the threshold, by as much as the
 * ratio says, with a soft knee. To hold a bus together (glue), give punch to a
 * drum kit (slow attack: the hit passes, the body gets squashed) or, with the mix, compress in
 * parallel. The high-pass on the detector keeps the lows from making it pump. With the
 * sidechain the detector listens to another track: the kick ducking the bass. Here is the
 * description; the sound is in compressor-core.ts, the curve (shared by sound and drawing) in
 * compressor-math.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

export const DETECTORS = ['Peak', 'RMS'] as const;
export const DETECTOR = { peak: 0, rms: 1 } as const;

const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def });

export const COMPRESSOR: DeviceType = {
  type: 'compressor',
  label: 'Compressor',
  sidechain: true,
  sections: [
    {
      label: 'Curve',
      params: [
        num('threshold', 'Threshold', -60, 0, -18, 'dB', { step: 0.1 }),
        num('ratio', 'Ratio', 1, 20, 4, ':1', { scale: 'log', step: 0.1 }),
        num('knee', 'Knee', 0, 24, 6, 'dB', { step: 0.1 }),
      ],
    },
    {
      label: 'Times',
      params: [
        num('attack', 'Attack', 0.1, 100, 10, 'ms', { scale: 'log', step: 0.1 }),
        num('release', 'Release', 5, 1000, 120, 'ms', { scale: 'log', step: 1 }),
        choice('detector', 'Detector', DETECTORS),
        num('scHp', 'High-pass det.', 20, 500, 20, 'Hz', { scale: 'log', step: 1 }),
      ],
    },
    {
      label: 'Output',
      params: [
        choice('auto', 'Auto gain', ['Off', 'On'], 1),
        num('makeup', 'Gain', -12, 24, 0, 'dB', { step: 0.1 }),
        num('mix', 'Dry/Wet', 0, 100, 100, '%', { step: 1 }),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Glue', params: { threshold: -14, ratio: 2, knee: 10, attack: 30, release: 150, scHp: 90 } },
    { name: 'Drum punch', params: { threshold: -20, ratio: 4, knee: 6, attack: 25, release: 80, scHp: 60 } },
    { name: 'Parallel', params: { threshold: -32, ratio: 10, knee: 4, attack: 2, release: 60, mix: 35, makeup: 6 } },
    { name: 'Bass', params: { threshold: -18, ratio: 5, knee: 6, attack: 8, release: 90, detector: DETECTOR.rms } },
    { name: 'Voice', params: { threshold: -22, ratio: 3.5, knee: 8, attack: 5, release: 100, scHp: 120, detector: DETECTOR.rms } },
    { name: 'Squash', params: { threshold: -36, ratio: 20, knee: 2, attack: 0.3, release: 40, makeup: 4 } },
  ],
};
