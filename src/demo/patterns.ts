/* Writing parts as on a drum machine or a 303: sixteenth rhythms for the pads
 * ("X..x o..."), acid lines one word per step with accents and slides, repetitions and modulation
 * curves. They serve the projects built from code (see acid-live.ts). */
import type { Beats } from '../core/music-time';
import { padNote } from '../devices/instruments/drums/drums';
import type { EnvelopePoint } from '../model/envelope';
import type { Note } from '../model/midi-clip';

/** A step: a sixteenth. */
export const STEP = 0.25;
export const BAR = 4;

/** A sixteenth rhythm for a pad: "X" accent, "x" hit, "o" soft hit, "." rest;
 *  spaces and "|" are only for reading. */
export function steps(pad: number, pattern: string, from: Beats = 0): Note[] {
  const VELOCITY: Readonly<Record<string, number>> = { X: 127, x: 104, o: 66 };
  return [...pattern.replace(/[\s|]/g, '')].flatMap((c, i) =>
    VELOCITY[c] ? [{ pitch: padNote(pad), start: from + i * STEP, duration: STEP, velocity: VELOCITY[c] }] : []);
}

const NOTE_NAMES: Readonly<Record<string, number>> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** An acid line in sixteenths, the way a 303 is programmed: one word per step, "." rest,
 *  "-" holds the previous note one more step. A note is name and octave ("a2", "c#3", "eb2"),
 *  capitalized if accented and "~" at the end if it slides into the next (the two
 *  overlap: Analog in Legato does the slide). */
export function acid(line: string, from: Beats = 0): Note[] {
  const notes: { pitch: number; start: number; steps: number; slide: boolean; accent: boolean }[] = [];
  line.replace(/\|/g, ' ').trim().split(/\s+/).forEach((word, i) => {
    if (word === '.') return;
    if (word === '-') {
      const last = notes.at(-1);
      if (last) last.steps++;
      return;
    }
    const m = /^([a-g])(#|b)?(\d)(~)?$/i.exec(word);
    if (!m) throw new Error(`invalid acid step: "${word}"`);
    const [, name, accidental, octave, slide] = m;
    const pitch = 12 * (Number(octave) + 1) + NOTE_NAMES[name.toLowerCase()] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
    notes.push({ pitch, start: from + i * STEP, steps: 1, slide: !!slide, accent: name !== name.toLowerCase() });
  });
  // 303 gate: half a step; with the slide the note reaches past the start of the next
  return notes.map(n => ({
    pitch: n.pitch, start: n.start, velocity: n.accent ? 127 : 92,
    duration: n.slide ? n.steps * STEP + 0.06 : (n.steps - 0.5) * STEP,
  }));
}

/** Swing: the offbeat sixteenths (the second and fourth of each beat) arrive
 *  `amount` sixteenths late (0.1–0.2 is techno's light groove). The notes on the
 *  beats and on the eighths stay where they are. */
export const swing = (notes: readonly Note[], amount: number): Note[] =>
  notes.map(n => {
    const step = Math.round(n.start / STEP);
    return Math.abs(n.start - step * STEP) < 1e-6 && step % 2 === 1 ? { ...n, start: n.start + amount * STEP } : { ...n };
  });

/** The notes repeated `times` times, every `period` beats. */
export const repeat = (notes: readonly Note[], period: Beats, times: number): Note[] =>
  Array.from({ length: times }, (_, k) => notes.map(n => ({ ...n, start: n.start + k * period }))).flat();

/** A bar repeated for `bars` bars, with the last one possibly different. */
export const bars = (pad: number, bar: string, count: number, last: string = bar): Note[] =>
  Array.from({ length: count }, (_, k) => steps(pad, k === count - 1 ? last : bar, k * BAR)).flat();

/** Points of a curve: [beat, value]. */
export const curve = (...points: (readonly [Beats, number])[]): EnvelopePoint[] => points.map(([beat, value]) => ({ beat, value }));

/** A pad played in a row from `from`: `count` hits every `every` beats, the velocity going from
 *  `velocity[0]` to `velocity[1]` (a growing roll, a stutter). */
export function roll(pad: number, from: Beats, count: number, every: Beats, velocity: readonly [number, number] = [100, 100]): Note[] {
  return Array.from({ length: count }, (_, k) => ({
    pitch: padNote(pad), start: from + k * every, duration: every,
    velocity: velocity[0] + ((velocity[1] - velocity[0]) * k) / Math.max(1, count - 1),
  }));
}

/** A loop sliced on the pads, in sixteenths: a number is the pad (the slice) starting there, "."
 *  lets the previous one play. With the slices choked to each other the loop is rebuilt or
 *  reassembled: "0 . 1 . 2 . 3 ." is the original in eighths. */
export function chop(line: string, from: Beats = 0, velocity = 110): Note[] {
  return line.replace(/\|/g, ' ').trim().split(/\s+/).flatMap((word, i) => {
    if (word === '.') return [];
    const pad = Number(word);
    if (!Number.isInteger(pad)) throw new Error(`invalid slice: "${word}"`);
    return [{ pitch: padNote(pad), start: from + i * STEP, duration: STEP, velocity }];
  });
}

/** The volume dropping on the hits (`hits`, in beats) and coming back up in `release` beats: the
 *  sidechain done with modulations. `depth` is how much volume is left at the hit (0..1). */
export function duck(hits: readonly Beats[], depth: number, release: Beats): EnvelopePoint[] {
  return [...hits].sort((a, b) => a - b).flatMap(h => [
    { beat: h, value: 1 }, { beat: h, value: depth }, { beat: h + release, value: 1 },
  ]);
}

/** The volume chopped between `from` and `to`: on for `duty` of each `every` step, then off
 *  (the stutter of glitch cuts). Outside the range it stays full. */
export function gate(from: Beats, to: Beats, every: Beats, duty = 0.5): EnvelopePoint[] {
  const points: EnvelopePoint[] = [];
  for (let t = from; t < to - 1e-9; t += every) {
    points.push({ beat: t, value: 1 }, { beat: t + every * duty, value: 1 }, { beat: t + every * duty, value: 0 }, { beat: t + every, value: 0 });
  }
  points.push({ beat: to, value: 1 });
  return points;
}
