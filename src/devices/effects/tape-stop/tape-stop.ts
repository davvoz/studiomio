/* "Tape Stop": the tape (or the turntable) coming to a stop. With "Stop" on, the sound slows down until
 * it stops within the Duration, with the chosen Curve, and stays still; off, it restarts: with
 * Restart it speeds up from standstill to the sound of now, at 0 it comes back right away. With the transport
 * running, the braking can wait for the next grid line (Start), so it falls in time.
 * Here there's only the description; the sound is in tape-stop-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

/** The synced durations of the braking, in quarters. */
export const BRAKE_DIVISIONS: readonly (readonly [label: string, beats: number])[] = [
  ['1/16', 1 / 4], ['1/8', 1 / 2], ['1/4', 1], ['1/2', 2], ['1 bar', 4], ['2 bars', 8],
];

/** Where the start of the braking can fall: right away, or on the next line (in quarters). */
export const STARTS: readonly (readonly [label: string, beats: number])[] = [
  ['Immediately', 0], ['1/16', 1 / 4], ['1/8', 1 / 2], ['1/4', 1], ['1/2', 2], ['1 bar', 4],
];

/** How the speed drops: in a straight line, soft (slow at the start and at the end), or fast
 *  at the start like a turntable. */
export const BRAKE_CURVES = ['Linear', 'Soft', 'Fast'] as const;
export const BRAKE_CURVE = { linear: 0, smooth: 1, fast: 2 } as const;

export const TAPE_SYNC = { tempo: 0, ms: 1 } as const;
export const MAX_BRAKE_MS = 4000;
export const MAX_SPIN_MS = 2000;

const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

const division = (label: string) => BRAKE_DIVISIONS.findIndex(([l]) => l === label);
const start = (label: string) => STARTS.findIndex(([l]) => l === label);

export const TAPE_STOP: DeviceType = {
  type: 'tapeStop',
  label: 'Tape Stop',
  sections: [
    {
      label: 'Stop',
      params: [
        choice('stop', 'Stop', ['Off', 'On']),
        choice('start', 'Start', STARTS.map(([l]) => l), start('Immediately')),
      ],
    },
    {
      label: 'Brake',
      params: [
        choice('sync', 'Sync', ['Tempo', 'ms']),
        choice('division', 'Length', BRAKE_DIVISIONS.map(([l]) => l), division('1/2'), { when: { param: 'sync', is: TAPE_SYNC.tempo } }),
        num('time', 'Length', 20, MAX_BRAKE_MS, 500, 'ms', { scale: 'log', step: 1, when: { param: 'sync', is: TAPE_SYNC.ms } }),
        choice('curve', 'Curve', BRAKE_CURVES),
      ],
    },
    {
      label: 'Restart',
      params: [num('spin', 'Restart', 0, MAX_SPIN_MS, 0, 'ms', { step: 1 })],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: '1-bar stop', params: { division: division('1 bar'), start: start('1/4') } },
    { name: 'Turntable off', params: { sync: TAPE_SYNC.ms, time: 900, curve: BRAKE_CURVE.fast } },
    { name: 'Short brake', params: { division: division('1/8'), curve: BRAKE_CURVE.smooth, start: start('1/16') } },
    { name: 'Slow start', params: { division: division('1/4'), spin: 600 } },
  ],
};
