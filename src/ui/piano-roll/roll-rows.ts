/* The piano roll's rows, without the DOM: how they're framed (the notes in the centre, with Fold only
 * theirs, with the pads' names taller), how Fold follows the notes, the names the instrument gives the notes. */
import { resolveParams } from '../../devices/device-type';
import { instrumentType } from '../../devices/registry';
import type { Project } from '../../model/project';
import type { InstrumentSettings } from '../../model/device';
import type { MidiTrack } from '../../model/track';
import { foldRows, PitchAxis, sameRows } from './pitch-axis';
import { ROLL } from './roll-painter';

/** The notes' names given by the instrument (the drum machine's pads), by pitch. */
export type NoteNames = ReadonlyMap<number, string>;

/** Height of the rows when the notes have a name (the pads): the tallest fitting all the
 *  pads, between these two (below the minimum the names can't be read). */
export const NAMED_ROW = { min: 10, max: 16 } as const;

/** With Fold the rows widen to fill the view, up to this height. */
export const FOLD_ROW_MAX = 20;

/** Vertically: with Fold all the rows, as tall as they can be; without, the notes (and the named pads) in the centre. */
export function fitRows(pitches: readonly number[], names: NoteNames | null, folded: boolean, notesHeight: number): PitchAxis {
  const rows = folded ? foldRows(pitches) : null;
  if (rows) {
    const h = Math.max(names ? NAMED_ROW.min : 8, Math.min(FOLD_ROW_MAX, Math.floor(notesHeight / rows.length)));
    return new PitchAxis(h, 0, ROLL.ruler, rows).scrolled(0, notesHeight);
  }
  const all = [...pitches, ...(names?.keys() ?? [])];
  const [lo, hi] = all.length ? [Math.min(...all), Math.max(...all)] : [60, 72];
  const fitting = Math.floor(notesHeight / (hi - lo + 2));
  const axis = new PitchAxis(names ? Math.max(NAMED_ROW.min, Math.min(NAMED_ROW.max, fitting)) : 12, 0, ROLL.ruler);
  return axis.centeredOn(lo, hi, notesHeight);
}

/** With Fold the rows follow the notes: a note at a new pitch adds one, the last note removed from a
 *  pitch removes it; without notes all the rows are shown. The new rows, 'refit' when Fold goes from
 *  rows to all of them (or back) and everything is framed again, null if nothing changes. */
export function followRows(current: PitchAxis, pitches: readonly number[], folded: boolean, notesHeight: number): PitchAxis | 'refit' | null {
  const rows = folded ? foldRows(pitches) : null;
  if (sameRows(rows, current.rows)) return null;
  if ((rows === null) !== (current.rows === null)) return 'refit';
  return current.withRows(rows, notesHeight);
}

/** The names the track's instrument gives the notes (the drum machine's pads), or null. */
export function noteNames(track: MidiTrack, project: Project): NoteNames | null {
  const instrument = track.instrument, type = instrumentType(instrument.type);
  const names = type?.noteNames?.(resolveParams(type, instrument.params), project.sampleNames(instrument));
  return names?.size ? names : null;
}

export const sameNames = (a: NoteNames | null, b: NoteNames | null): boolean =>
  a === b || (!!a && !!b && a.size === b.size && [...a].every(([k, v]) => b.get(k) === v));

/** The instrument as the panel names it: its kind, and the preset if it has one. */
export function instrumentLabel(instrument: InstrumentSettings): string {
  const name = instrumentType(instrument.type)?.label ?? instrument.type;
  return instrument.preset ? `${name} · ${instrument.preset}` : name;
}
