/* The step sequencer of the monophonic instruments (Analog, Neuro), like a 303's that
 * writes itself. On, the instrument doesn't play the notes it receives: while a note is held
 * it plays a loop of steps in time with the bar, transposed onto that note (the clip holds the long
 * notes: the root, the chords of the progression). The loop is born from a number (Pattern) and the knobs
 * say how full it is, how much it widens in pitch, how many accents and slides: turning them the
 * loop changes while staying the same (with higher Density notes are added, none are moved).
 * Here is the description of the parameters; the sound is in dsp/step-sequencer.ts. */
import type { ChoiceParam, NumberParam, ParamSection } from './params';

/** The step rates: beats per step. */
export const SEQ_RATES: readonly (readonly [label: string, beats: number])[] = [
  ['1/8', 0.5], ['1/16', 0.25], ['1/16T', 1 / 6], ['1/32', 0.125],
];

/** The scales: intervals from the held note in order of importance. With Pitch at 0 only
 *  the first plays (the root); going up the others come in, in order. */
export const SEQ_SCALES: readonly (readonly [label: string, intervals: readonly number[]])[] = [
  // the root, the octave and the flat second, then the fifth and the rest of the phrygian
  ['Phrygian', [0, 12, 1, 7, 3, 10, 13, 8, 5, 15, 19, 24]],
  // brehho23's motif: root, flat second and tritone
  ['Phrygian and tritone', [0, 12, 1, 6, 3, 13, 7, 10, 18, 15, -12, 24]],
  ['Minor', [0, 12, 7, 3, 10, 5, 8, 15, 2, 19, 14, 24]],
  // the root hammering up and down an octave
  ['Octaves', [0, 12, 0, 24, -12, 12]],
  ['Fifths', [0, 7, 12, 19, -5, 24, 0, 7]],
];

/** The first, second… value of SEQ_SCALES by name. */
export const SEQ_SCALE = Object.fromEntries(SEQ_SCALES.map(([l], i) => [l, i])) as Readonly<Record<string, number>>;
export const SEQ_RATE = Object.fromEntries(SEQ_RATES.map(([l], i) => [l, i])) as Readonly<Record<string, number>>;

/** How many different patterns (the Pattern parameter goes from 0 to SEQ_PATTERNS − 1). */
export const SEQ_PATTERNS = 128;
/** At most this many steps in a loop. */
export const SEQ_MAX_STEPS = 32;

const ON = { param: 'seqOn', is: 1 } as const;
const num = (id: string, label: string, min: number, max: number, def: number, unit = '', step?: number): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...(step ? { step } : {}), when: ON });
const choice = (id: string, label: string, options: readonly string[], def: number): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, when: ON });

export const SEQUENCER_SECTION: ParamSection = {
  label: 'Sequencer',
  params: [
    { kind: 'choice', id: 'seqOn', label: 'Sequencer', options: ['Off', 'On'], default: 0 },
    num('seqPattern', 'Pattern', 0, SEQ_PATTERNS - 1, 0, '', 1),
    num('seqLength', 'Steps', 1, SEQ_MAX_STEPS, 16, '', 1),
    choice('seqRate', 'Rate', SEQ_RATES.map(([l]) => l), SEQ_RATE['1/16']),
    num('seqDensity', 'Density', 0, 100, 60, '%', 1),
    choice('seqScale', 'Scale', SEQ_SCALES.map(([l]) => l), SEQ_SCALE.Phrygian),
    num('seqRange', 'Height', 0, 100, 30, '%', 1),
    num('seqOctave', 'Octave', -2, 2, 0, '', 1),
    num('seqAccent', 'Accents', 0, 100, 30, '%', 1),
    num('seqSlide', 'Slide', 0, 100, 20, '%', 1),
    num('seqGate', 'Gate', 10, 100, 55, '%', 1),
    choice('seqKick', 'Downbeat', ['Play', 'Leave to the kick'], 0),
  ],
};
