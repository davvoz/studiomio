/* "Trance Gate" (the type stays 'gate': saved projects call it that). A pattern of steps (up to 32) in time, locked to the bar: each
 * step opens the sound at its level (0 = closed) for the part of the step given by "Gate", with
 * attack and release to avoid clicks; swing delays the odd steps. "Depth" says
 * how much it closes: at 100% silence, less lets a bit of sound through (a stepped tremolo).
 * The steps are drawn in the panel (ui/device/gate); here there's only the description, the sound
 * is in gate-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

export const MAX_STEPS = 32;

/** How long a step is, in quarters. */
export const STEP_RATES: readonly (readonly [label: string, beats: number])[] = [
  ['1/4', 1], ['1/8', 1 / 2], ['1/8T', 1 / 3], ['1/16', 1 / 4], ['1/16T', 1 / 6], ['1/32', 1 / 8],
];

/** The level parameter of step `i` (from 0). */
export const stepParam = (i: number) => `step${i + 1}`;

/** A pattern written with "x" (open), "o" (half) and "." (closed): the levels of its steps. */
export function pattern(text: string): Record<string, number> {
  const steps = text.replace(/\s/g, '');
  return Object.fromEntries(Array.from({ length: MAX_STEPS }, (_, i) => {
    const c = steps[i % steps.length];
    return [stepParam(i), c === 'x' ? 100 : c === 'o' ? 50 : 0];
  }));
}

/** The starting pattern: the classic sixteenth-note trance gate. */
const INIT = pattern('x.xx .xx. x.xx .x.x');

const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

const rate = (label: string) => STEP_RATES.findIndex(([l]) => l === label);

export const GATE: DeviceType = {
  type: 'gate',
  label: 'Trance Gate',
  sections: [
    {
      label: 'Pattern',
      params: [
        choice('rate', 'Rate', STEP_RATES.map(([l]) => l), rate('1/16')),
        num('length', 'Steps', 1, MAX_STEPS, 16, '', { step: 1 }),
        num('swing', 'Swing', 0, 100, 0, '%', { step: 1 }),
      ],
    },
    {
      label: 'Step',
      params: [
        num('gate', 'Gate', 5, 100, 75, '%', { step: 1 }),
        num('attack', 'Attack', 0.5, 50, 1, 'ms', { scale: 'log', step: 0.1 }),
        num('release', 'Release', 0.5, 500, 20, 'ms', { scale: 'log', step: 0.1 }),
        num('depth', 'Depth', 0, 100, 100, '%', { step: 1 }),
      ],
    },
    {
      label: 'Steps',
      params: Array.from({ length: MAX_STEPS }, (_, i) =>
        num(stepParam(i), `Step ${i + 1}`, 0, 100, INIT[stepParam(i)], '%', { step: 1, hidden: true })),
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Eighths', params: { ...pattern('x'), rate: rate('1/8'), gate: 50 } },
    { name: 'Staccato sixteenths', params: { ...pattern('x'), gate: 35, release: 8 } },
    { name: 'Gallop', params: { ...pattern('x.xx'), gate: 60 } },
    { name: 'Swing', params: { ...pattern('x.xx x.x. xx.x x.xo'), swing: 55, gate: 65 } },
    { name: 'Triplets', params: { ...pattern('x.x x.. x.x .xx'), length: 12, rate: rate('1/16T'), gate: 70 } },
    { name: 'Step tremolo', params: { ...pattern('xo'), depth: 60, attack: 8, release: 60, gate: 100 } },
    { name: '1/4 breath', params: { ...pattern('x...'), rate: rate('1/32'), length: 8, gate: 100, attack: 2, release: 120 } },
  ],
};
