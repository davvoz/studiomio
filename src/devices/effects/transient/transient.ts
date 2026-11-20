/* "Transient": shapes the hits without a threshold, whatever their level. Attack raises (or
 * lowers) the first milliseconds of every hit, Sustain what follows it: a kick with more punch
 * and less boom, a snare with a longer ring, percussion turned into clicks. Speed is how long
 * the attack lasts, Length how long the sustain is followed. Clip catches the raised peaks with a
 * soft curve at 0 dB. The sound is in transient-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def: number): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def });

export const TRANSIENT: DeviceType = {
  type: 'transient',
  label: 'Transient',
  sections: [
    {
      label: 'Shape',
      params: [
        num('attack', 'Attack', -100, 100, 0, '%', { step: 1 }),
        num('sustain', 'Sustain', -100, 100, 0, '%', { step: 1 }),
      ],
    },
    {
      label: 'Time',
      params: [
        num('speed', 'Speed', 2, 60, 12, 'ms', { scale: 'log' }),
        num('length', 'Length', 20, 800, 120, 'ms', { scale: 'log' }),
      ],
    },
    {
      label: 'Output',
      params: [
        num('output', 'Output', -24, 12, 0, 'dB', { step: 0.1 }),
        choice('clip', 'Clip', ['Off', 'On'], 0),
        num('mix', 'Mix', 0, 100, 100, '%', { step: 1 }),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Kick punch', params: { attack: 60, sustain: -25, speed: 8, length: 90, clip: 1 } },
    { name: 'Tight kick', params: { attack: 30, sustain: -70, speed: 10, length: 60, clip: 1 } },
    { name: 'Snare crack', params: { attack: 55, sustain: 20, speed: 6, length: 150 } },
    { name: 'Clicky percussion', params: { attack: 80, sustain: -60, speed: 4, length: 50, clip: 1 } },
    { name: 'Room up', params: { attack: -20, sustain: 70, speed: 15, length: 300 } },
    { name: 'Soft hits', params: { attack: -60, sustain: 10, speed: 20, length: 120 } },
  ],
};
