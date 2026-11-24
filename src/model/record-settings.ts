/* How what's played is recorded, as Live's Record Quantization: the input quantization (grid, triplets,
 * strength, note ends) that brings the recorded notes onto the grid, and the latency compensation
 * that moves them back by the delay between the engine's clock and what's heard. Pure data and maths. */
import type { Beats } from '../core/music-time';
import type { Note } from './midi-clip';

/** The input quantization: `grid` an id of RECORD_GRIDS ('off': none), `strength` 0 … 1 (1: right on
 *  the grid, ½: halfway), `ends` the notes' ends too. */
export interface RecordQuantize {
  readonly grid: string;
  readonly triplet: boolean;
  readonly strength: number;
  readonly ends: boolean;
}

export const RECORD_GRIDS: readonly { readonly id: string; readonly label: string; readonly beats: Beats }[] = [
  { id: '1/4', label: '1/4', beats: 1 },
  { id: '1/8', label: '1/8', beats: 1 / 2 },
  { id: '1/16', label: '1/16', beats: 1 / 4 },
  { id: '1/32', label: '1/32', beats: 1 / 8 },
];

export const NO_RECORD_QUANTIZE: RecordQuantize = { grid: 'off', triplet: false, strength: 1, ends: false };

/** The shortest note kept, as in a take. */
const MIN_DURATION: Beats = 1 / 64;

/** The grid's step in beats (triplets: ⅔ of it), null without quantization. */
export function quantizeStep(q: RecordQuantize): Beats | null {
  const grid = RECORD_GRIDS.find(g => g.id === q.grid);
  if (!grid) return null;
  return q.triplet ? (grid.beats * 2) / 3 : grid.beats;
}

export const sameRecordQuantize = (a: RecordQuantize, b: RecordQuantize): boolean =>
  a.grid === b.grid && a.triplet === b.triplet && a.strength === b.strength && a.ends === b.ends;

/** Throws if the settings can't be (a grid that doesn't exist, a strength outside 0 … 1). */
export function checkRecordQuantize(q: RecordQuantize): void {
  if (q.grid !== 'off' && !RECORD_GRIDS.some(g => g.id === q.grid)) throw new RangeError(`unknown record quantization grid: ${q.grid}`);
  if (!(q.strength >= 0 && q.strength <= 1)) throw new RangeError(`record quantization strength outside 0…1: ${q.strength}`);
}

/** Where a clip's notes live: from `start` to `end`, round when it loops (a note quantized onto the end
 *  goes to the start). */
export interface NoteSpan {
  readonly start: Beats;
  readonly end: Beats;
  readonly loops: boolean;
}

/** `x` brought `strength` of the way to the nearest line of the grid. */
const pulled = (x: Beats, step: Beats, strength: number): Beats => x + (Math.round(x / step) * step - x) * strength;

/** The recorded note quantized: its start (and with `ends` its end, at least a step after the start)
 *  towards the grid; it stays in `span`, and doesn't go past its end. */
export function quantizeRecorded(note: Note, q: RecordQuantize, span: NoteSpan): Note {
  const step = quantizeStep(q);
  if (step === null) return note;
  const end = note.start + note.duration;
  let start = pulled(note.start, step, q.strength);
  let last = end;
  if (q.ends) {
    const target = Math.max(Math.round(end / step) * step, Math.round(note.start / step) * step + step);
    last = end + (target - end) * q.strength;
  }
  // onto the loop's end: it's the loop's start
  if (span.loops && start >= span.end - 1e-9) {
    const length = span.end - span.start;
    start -= length;
    last -= length;
  }
  start = Math.max(0, Math.min(start, span.end - MIN_DURATION));
  const duration = Math.max(MIN_DURATION, Math.min(last - start, span.end - start));
  return { ...note, start, duration };
}

/** The latency compensation in beats, how much earlier the played notes are put: the audio device's
 *  delay (`audioSeconds`, unknown: 0) and the hand correction (`offsetMs`: more earlier, below 0 later), at `bpm`. */
export function compensationBeats(audioSeconds: number, offsetMs: number, bpm: number): Beats {
  const seconds = (Number.isFinite(audioSeconds) ? audioSeconds : 0) + offsetMs / 1000;
  return (seconds * bpm) / 60;
}

/** The hand correction's limits, in ms. */
export const OFFSET_MS = { min: -50, max: 200 } as const;
