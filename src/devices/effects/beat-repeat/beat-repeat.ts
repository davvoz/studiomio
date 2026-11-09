/* "Beat Repeat": like Live's Beat Repeat. In time, every Interval (shifted by Offset
 * sixteenths) and with a certain Chance, it captures a little piece Grid long and repeats it for
 * the length of the Gate: stutters, rolls, fills. The repetitions can drop in pitch and
 * decrease in volume at each round and go through a band-pass filter; they're added to the sound (Mix),
 * replace it while they play (Insert) or stay alone (Gate). "Repeat" on repeats
 * right away (on the next grid piece) until it's turned off: the button to play
 * live. With "Repeat Only" it repeats only with the button: off, the sound passes as it is, as
 * if the effect were off. It follows the transport's bar; when stopped it repeats only with Repeat.
 * Here there's only the description; the sound is in beat-repeat-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

/** How often a repetition starts: quarters, or bars (which depend on the time signature). */
export const INTERVALS: readonly (readonly [label: string, beats: number, bars: number])[] = [
  ['1/32', 1 / 8, 0], ['1/16', 1 / 4, 0], ['1/8', 1 / 2, 0], ['1/4', 1, 0], ['1/2', 2, 0],
  ['1 bar', 0, 1], ['2 bars', 0, 2], ['4 bars', 0, 4],
];

/** How long the repeated piece is, in quarters. */
export const GRIDS: readonly (readonly [label: string, beats: number])[] = [
  ['1/4', 1], ['1/8', 1 / 2], ['1/8T', 1 / 3], ['1/16', 1 / 4], ['1/16T', 1 / 6], ['1/32', 1 / 8], ['1/32T', 1 / 12], ['1/64', 1 / 16],
];

export const REPEAT_MODES = ['Mix', 'Insert', 'Gate'] as const;
export const REPEAT_MODE = { mix: 0, insert: 1, gate: 2 } as const;

/** At most how many times the Variation halves the grid (at 100%). */
export const MAX_VARIATION_HALVINGS = 3;

/** The lowest pitch the repetitions reach, adding up the drop, in semitones. */
export const MIN_REPEAT_PITCH = -48;

const OFF_ON = ['Off', 'On'] as const;

const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

/** The parameters of the timed repetitions, which with "Repeat Only" aren't needed. */
const AUTO = { when: { param: 'only', is: 0 } } as const;

const index = (list: readonly (readonly [string, ...unknown[]])[], label: string) => list.findIndex(([l]) => l === label);

export const BEAT_REPEAT: DeviceType = {
  type: 'beatRepeat',
  label: 'Beat Repeat',
  sections: [
    {
      label: 'When',
      params: [
        choice('interval', 'Interval', INTERVALS.map(([l]) => l), index(INTERVALS, '1 bar'), AUTO),
        num('offset', 'Offset', 0, 15, 8, '/16', { step: 1, ...AUTO }),
        num('chance', 'Chance', 0, 100, 100, '%', { step: 1, ...AUTO }),
        num('gate', 'Gate', 1, 64, 8, '/16', { step: 1, ...AUTO }),
        choice('repeat', 'Repeat', OFF_ON),
        choice('only', 'Solo Repeat', OFF_ON),
      ],
    },
    {
      label: 'Grid',
      params: [
        choice('grid', 'Grid', GRIDS.map(([l]) => l), index(GRIDS, '1/16')),
        num('variation', 'Variation', 0, 100, 0, '%', { step: 1 }),
      ],
    },
    {
      label: 'Repeats',
      params: [
        num('pitch', 'Pitch', -24, 0, 0, 'st', { step: 1 }),
        num('pitchDecay', 'Descent', 0, 4, 0, 'st', { step: 0.1 }),
        num('decay', 'Decay', 0, 100, 0, '%', { step: 1 }),
      ],
    },
    {
      label: 'Filter',
      params: [
        choice('filter', 'Filter', OFF_ON),
        num('freq', 'Frequency', 50, 18000, 1000, 'Hz', { scale: 'log', step: 1, when: { param: 'filter', is: 1 } }),
        num('width', 'Width', 0.5, 9, 3, 'ott', { step: 0.1, when: { param: 'filter', is: 1 } }),
      ],
    },
    {
      label: 'Output',
      params: [
        choice('mode', 'Mode', REPEAT_MODES),
        num('volume', 'Volume', -36, 6, 0, 'dB', { step: 0.1 }),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Stutter', params: { interval: index(INTERVALS, '1/2'), offset: 4, gate: 4, grid: index(GRIDS, '1/32'), mode: REPEAT_MODE.insert } },
    { name: 'End-of-phrase roll', params: { interval: index(INTERVALS, '4 bars'), offset: 12, gate: 4, grid: index(GRIDS, '1/16'), mode: REPEAT_MODE.insert } },
    { name: 'Tape stop', params: { gate: 8, grid: index(GRIDS, '1/8'), pitchDecay: 2, decay: 15, mode: REPEAT_MODE.insert } },
    { name: 'Glitch', params: { interval: index(INTERVALS, '1/4'), offset: 0, chance: 30, gate: 2, grid: index(GRIDS, '1/16'), variation: 100, mode: REPEAT_MODE.insert } },
    { name: 'Filtered echo', params: { gate: 16, grid: index(GRIDS, '1/8T'), decay: 30, filter: 1, freq: 1800, width: 2, mode: REPEAT_MODE.mix, volume: -4 } },
  ],
};
