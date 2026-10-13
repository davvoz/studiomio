/* Operazioni del piano roll sulle note di una clip: funzioni pure che ricevono le note e
 * quelle selezionate e restituiscono le note nuove e la nuova selezione. La selezione è fatta
 * delle note stesse (per identità): MidiClip conserva gli oggetti delle note valide. */
import type { Beats } from '../core/music-time';
import type { Note } from './midi-clip';

export interface NoteChange {
  readonly notes: readonly Note[];
  readonly selected: readonly Note[];
}

export type Selection = ReadonlySet<Note>;

/** Durata minima di una nota. */
export const MIN_NOTE: Beats = 1 / 64;

const clampPitch = (p: number) => Math.max(0, Math.min(127, p));

/** Applica `fn` alle note selezionate; le altre restano. */
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

/** Sposta (o copia) le note selezionate di `dBeat` battiti e `dPitch` semitoni. Lo
 *  spostamento si ferma ai bordi: nessuna nota esce da 0..127 o finisce prima del battito 0. */
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

/** Allunga o accorcia le note selezionate dal bordo `edge`, tenendo fermo l'altro. */
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

/** Porta gli inizi delle note selezionate (o di tutte, se non ce ne sono) sulla griglia. */
export function quantizeNotes(notes: readonly Note[], sel: Selection, step: Beats): NoteChange {
  const target = sel.size ? sel : new Set(notes);
  const r = mapSelected(notes, target, n => ({ ...n, start: Math.max(0, Math.round(n.start / step) * step) }));
  return { notes: r.notes, selected: sel.size ? r.selected : [] };
}

/** Copia le note selezionate subito dopo la fine della selezione; la copia resta selezionata. */
export function duplicateNotes(notes: readonly Note[], sel: Selection, grid: Beats): NoteChange {
  const chosen = notes.filter(n => sel.has(n));
  if (!chosen.length) return { notes, selected: [] };
  const start = Math.min(...chosen.map(n => n.start)), end = Math.max(...chosen.map(n => n.start + n.duration));
  // la copia parte sulla griglia, alla fine della selezione arrotondata in su
  const span = Math.max(grid, Math.ceil((end - start) / grid - 1e-9) * grid);
  return moveNotes(notes, sel, span, 0, true);
}

/** Cambia la velocity: la nota `anchor` va a `velocity`, le altre selezionate si spostano
 *  della stessa quantità (come in Ableton). */
export function setVelocity(notes: readonly Note[], sel: Selection, anchor: Note, velocity: number): NoteChange {
  const delta = velocity - anchor.velocity;
  const target = sel.has(anchor) ? sel : new Set([anchor]);
  return mapSelected(notes, target, n => ({ ...n, velocity: Math.max(1, Math.min(127, Math.round(n.velocity + delta))) }));
}

export function addNote(notes: readonly Note[], note: Note): NoteChange {
  const n = { ...note, pitch: clampPitch(note.pitch), velocity: Math.max(1, Math.min(127, Math.round(note.velocity))) };
  return { notes: [...notes, n], selected: [n] };
}

/** Note che toccano il rettangolo [b0, b1) × [p0, p1]. */
export function notesInBox(notes: readonly Note[], b0: Beats, b1: Beats, p0: number, p1: number): Note[] {
  const [lo, hi] = [Math.min(p0, p1), Math.max(p0, p1)];
  const [s, e] = [Math.min(b0, b1), Math.max(b0, b1)];
  return notes.filter(n => n.pitch >= lo && n.pitch <= hi && n.start < e && n.start + n.duration > s);
}
