/* "Reverse": the sound backwards, in timed pieces. Time is divided into pieces
 * Length long, locked to the bar: while a piece passes you hear the previous one, read from the
 * end to the start (the suck-back before the drop). "Reverse" turns it on and off on the fly, with
 * a fade; Dry/Wet mixes in the straight sound. Here there's only the description; the sound is in
 * reverse-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

/** How long a piece is: quarters, or bars (which depend on the time signature). */
export const REVERSE_LENGTHS: readonly (readonly [label: string, beats: number, bars: number])[] = [
  ['1/16', 1 / 4, 0], ['1/8', 1 / 2, 0], ['1/4', 1, 0], ['1/2', 2, 0], ['1 bar', 0, 1],
];

/** The longest piece, in quarters: with very long time signatures "1 bar" stops here (the tape
 *  must remember two). */
export const MAX_REVERSE_BEATS = 16;

const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

const length = (label: string) => REVERSE_LENGTHS.findIndex(([l]) => l === label);

export const REVERSE: DeviceType = {
  type: 'reverse',
  label: 'Reverse',
  sections: [
    {
      label: 'Reverse',
      params: [
        choice('reverse', 'Reverse', ['Off', 'On'], 1),
        choice('length', 'Length', REVERSE_LENGTHS.map(([l]) => l), length('1/2')),
      ],
    },
    { label: 'Output', params: [num('mix', 'Dry/Wet', 0, 100, 100, '%', { step: 1 })] },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Reversed quarters', params: { length: length('1/4') } },
    { name: '1-bar suck', params: { length: length('1 bar') } },
    { name: 'Sixteenth glitch', params: { length: length('1/16') } },
    { name: 'Half and half', params: { length: length('1/8'), mix: 50 } },
  ],
};
