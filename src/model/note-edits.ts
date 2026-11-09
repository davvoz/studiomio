/* Piano roll operations on a clip's notes: pure functions receiving the notes and
 * the selected ones and returning the new notes and the new selection. The selection is made
 * of the notes themselves (by identity): MidiClip keeps the objects of the valid notes. */
import type { Beats } from '../core/music-time';
import type { Note } from './midi-clip';

export interface NoteChange {
  readonly notes: readonly Note[];
  readonly selected: readonly Note[];
}

export type Selection = ReadonlySet<Note>;

/** Minimum length of a note. */
export const MIN_NOTE: Beats = 1 / 64;

const clampPitch = (p: number) => Math.max(0, Math.min(127, p));

/** Applies `fn` to the selected notes; the others stay. */
function mapSelected(notes: readonly Note[], sel: Selection, fn: (n: Note) => Note): NoteChange {
  const selected: Note[] = [];
  const out = notes.map(n => {
    if (!sel.has(n)) return n;
    const m = fn(n);
    selected.push(m);
    return m;
  });
  return { notes: out, selected };
}

/** Moves (or copies) the selected notes by `dBeat` beats and `dPitch` semitones. The
 *  move stops at the edges: no note leaves 0..127 or ends before beat 0. */
export function moveNotes(notes: readonly Note[], sel: Selection, dBeat: Beats, dPitch: number, copy = false): NoteChange {
  const chosen = notes.filter(n => sel.has(n));
  if (!chosen.length) return { notes, selected: [] };
  const lo = Math.min(...chosen.map(n => n.pitch)), hi = Math.max(...chosen.map(n => n.pitch));
  const dp = Math.max(-lo, Math.min(127 - hi, Math.round(dPitch)));
  const db = Math.max(-Math.min(...chosen.map(n => n.start)), dBeat);
  const shift = (n: Note): Note => ({ ...n, start: n.start + db, pitch: n.pitch + dp });
  if (!copy) return mapSelected(notes, sel, shift);
  const copies = chosen.map(shift);
  return { notes: [...notes, ...copies], selected: copies };
}

/** Lengthens or shortens the selected notes from edge `edge`, keeping the other still. */
export function resizeNotes(notes: readonly Note[], sel: Selection, edge: 'start' | 'end', dBeat: Beats): NoteChange {
  const resize = {
    end: (n: Note): Note => ({ ...n, duration: Math.max(MIN_NOTE, n.duration + dBeat) }),
    start: (n: Note): Note => {
      const end = n.start + n.duration;
      const start = Math.max(0, Math.min(end - MIN_NOTE, n.start + dBeat));
      return { ...n, start, duration: end - start };
    },
  }[edge];
  return mapSelected(notes, sel, resize);
}

export function deleteNotes(notes: readonly Note[], sel: Selection): NoteChange {
  return { notes: notes.filter(n => !sel.has(n)), selected: [] };
}

/** Brings the starts of the selected notes (or of all, if there are none) onto the grid. */
export function quantizeNotes(notes: readonly Note[], sel: Selection, step: Beats): NoteChange {
  const target = sel.size ? sel : new Set(notes);
  const r = mapSelected(notes, target, n => ({ ...n, start: Math.max(0, Math.round(n.start / step) * step) }));
  return { notes: r.notes, selected: sel.size ? r.selected : [] };
}

/** A time range of the clip (Live's time selection: the drawn box). */
export interface TimeRange {
  readonly start: Beats;
  readonly end: Beats;
}

/** How far Ctrl+D moves the copy: the length of the time selection if there is one (as in Live),
 *  otherwise that of the chosen notes rounded up to the grid. */
export function duplicateSpan(notes: readonly Note[], sel: Selection, grid: Beats, time: TimeRange | null = null): Beats {
  if (time) return time.end - time.start;
  const chosen = notes.filter(n => sel.has(n));
  if (!chosen.length) return grid;
  const start = Math.min(...chosen.map(n => n.start)), end = Math.max(...chosen.map(n => n.start + n.duration));
  return Math.max(grid, Math.ceil((end - start) / grid - 1e-9) * grid);
}

/** Copies the selected notes right after the end of the selection (time selection, if any); the copy
 *  stays selected. */
export function duplicateNotes(notes: readonly Note[], sel: Selection, grid: Beats, time: TimeRange | null = null): NoteChange {
  if (!notes.some(n => sel.has(n))) return { notes, selected: [] };
  return moveNotes(notes, sel, duplicateSpan(notes, sel, grid, time), 0, true);
}

/** Changes the velocity: note `anchor` goes to `velocity`, the other selected ones move
 *  by the same amount (as in Ableton). */
export function setVelocity(notes: readonly Note[], sel: Selection, anchor: Note, velocity: number): NoteChange {
  const delta = velocity - anchor.velocity;
  const target = sel.has(anchor) ? sel : new Set([anchor]);
  return mapSelected(notes, target, n => ({ ...n, velocity: Math.max(1, Math.min(127, Math.round(n.velocity + delta))) }));
}

export function addNote(notes: readonly Note[], note: Note): NoteChange {
  const n = { ...note, pitch: clampPitch(note.pitch), velocity: Math.max(1, Math.min(127, Math.round(note.velocity))) };
  return { notes: [...notes, n], selected: [n] };
}

/** Notes touching the rectangle [b0, b1) × [p0, p1]. */
export function notesInBox(notes: readonly Note[], b0: Beats, b1: Beats, p0: number, p1: number): Note[] {
  const [lo, hi] = [Math.min(p0, p1), Math.max(p0, p1)];
  const [s, e] = [Math.min(b0, b1), Math.max(b0, b1)];
  return notes.filter(n => n.pitch >= lo && n.pitch <= hi && n.start < e && n.start + n.duration > s);
}
