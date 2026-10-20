import { describe, expect, it } from 'vitest';
import { asId } from '../../src/core/id';
import { MidiClip, type Note } from '../../src/model/midi-clip';
import {
  addNote, deleteNotes, duplicateNotes, MIN_NOTE, moveNotes, notesInBox, quantizeNotes, resizeNotes, setVelocity,
} from '../../src/model/note-edits';

const n = (pitch: number, start: number, duration = 1, velocity = 100): Note => ({ pitch, start, duration, velocity });

describe('operazioni sulle note', () => {
  const a = n(60, 0), b = n(64, 1), c = n(67, 2);
  const all = [a, b, c];

  it('spostare: battiti e semitoni, solo le selezionate', () => {
    const r = moveNotes(all, new Set([a, b]), 0.5, 2);
    expect(r.notes).toEqual([n(62, 0.5), n(66, 1.5), c]);
    expect(r.selected).toEqual([n(62, 0.5), n(66, 1.5)]);
    expect(r.notes[2]).toBe(c); // le altre note restano gli stessi oggetti
  });

  it('spostare si ferma ai bordi, senza deformare il gruppo', () => {
    const r = moveNotes(all, new Set([a, c]), -3, 100);
    expect(r.selected).toEqual([n(120, 0), n(127, 2)]); // il La più acuto arriva a 127, il gruppo resta intero
  });

  it('copiare con Ctrl: le originali restano, le copie sono selezionate', () => {
    const r = moveNotes(all, new Set([b]), 4, 0, true);
    expect(r.notes).toHaveLength(4);
    expect(r.selected).toEqual([n(64, 5)]);
  });

  it('allungare dalla fine o dall\'inizio, con una durata minima', () => {
    expect(resizeNotes(all, new Set([a]), 'end', 0.5).selected).toEqual([n(60, 0, 1.5)]);
    expect(resizeNotes(all, new Set([b]), 'start', 0.25).selected).toEqual([n(64, 1.25, 0.75)]);
    expect(resizeNotes(all, new Set([b]), 'start', 5).selected[0].duration).toBeCloseTo(MIN_NOTE, 12);
    expect(resizeNotes(all, new Set([b]), 'end', -5).selected[0].duration).toBe(MIN_NOTE);
  });

  it('quantizzare gli inizi: le selezionate, o tutte se non c\'è selezione', () => {
    const loose = [n(60, 0.1), n(62, 0.9)];
    expect(quantizeNotes(loose, new Set(), 0.5).notes.map(x => x.start)).toEqual([0, 1]);
    expect(quantizeNotes(loose, new Set([loose[1]]), 0.5).notes.map(x => x.start)).toEqual([0.1, 1]);
  });

  it('duplicare dopo la fine della selezione, sulla griglia', () => {
    const r = duplicateNotes(all, new Set([a, b]), 1); // selezione 0..2
    expect(r.selected).toEqual([n(60, 2), n(64, 3)]);
  });

  it('duplicare con una selezione di tempo: la copia va dopo la fine del riquadro, non della nota', () => {
    const short = n(60, 0, 0.25);
    // una nota di un sedicesimo scelta con un riquadro lungo una battuta
    expect(duplicateNotes([short], new Set([short]), 0.25, { start: 0, end: 4 }).selected).toEqual([n(60, 4, 0.25)]);
    // senza riquadro resta subito dopo la nota
    expect(duplicateNotes([short], new Set([short]), 0.25).selected).toEqual([n(60, 0.25, 0.25)]);
  });

  it('velocity: la nota trascinata va al valore, le altre selezionate la seguono', () => {
    const quiet = n(62, 3, 1, 40);
    const r = setVelocity([...all, quiet], new Set([a, quiet]), a, 120);
    expect(r.selected.map(x => x.velocity)).toEqual([120, 60]);
    expect(setVelocity(all, new Set(), c, 300).selected).toEqual([n(67, 2, 1, 127)]);
  });

  it('eliminare, aggiungere, riquadro', () => {
    expect(deleteNotes(all, new Set([b])).notes).toEqual([a, c]);
    expect(addNote(all, n(200, 4)).selected).toEqual([n(127, 4)]);
    expect(notesInBox(all, 0.5, 1.5, 61, 70)).toEqual([b]);
    expect(notesInBox(all, 1.5, 0.5, 70, 59)).toEqual([a, b]);
  });

  it('la clip conserva gli oggetti delle note: la selezione sopravvive alle modifiche', () => {
    const clip = MidiClip.empty(asId('clip-1'), 'x', '#fff').withNotes(all);
    const r = moveNotes(clip.notes, new Set([clip.notes[0]]), 0, 1);
    const next = clip.withNotes(r.notes);
    expect(next.notes.includes(r.selected[0])).toBe(true);
  });
});
