import { describe, expect, it } from 'vitest';
import type { MidiClip } from '../../src/model/midi-clip';
import { duplicateLoopAt, placementRef } from '../../src/store/clip-ref';
import { addMidiClip, resizePlacement, setLoopRegion } from '../../src/store/edits';
import { duplicateLoopRegion } from '../../src/store/selection-edits';
import { setup } from '../helpers/fixtures';

const shape = (store: ReturnType<typeof setup>['store'], i: number) =>
  store.project.tracks[i].arrangement.map(p => [p.start, p.length, p.offset]);

describe('Duplica loop nell\'arrangement', () => {
  it('copia il tratto del loop su tutte le tracce subito dopo e ci sposta il loop', () => {
    const { store, track } = setup({ midi: 2 });
    store.apply(addMidiClip(track(0), 0, 8)); // a cavallo dell'inizio del loop
    store.apply(addMidiClip(track(1), 5, 2)); // dentro
    store.apply(addMidiClip(track(1), 9, 2)); // nel tratto che verrà coperto
    store.apply(setLoopRegion({ start: 4, end: 8 }));
    store.apply(duplicateLoopRegion());

    expect(shape(store, 0)).toEqual([[0, 8, 0], [8, 4, 4]]);
    expect(shape(store, 1)).toEqual([[5, 2, 0], [9, 2, 0]]);
    expect(store.project.tracks[1].arrangement[1].clip.id).not.toBe(store.project.tracks[1].arrangement[0].clip.id);
    expect([store.project.loop.start, store.project.loop.end]).toEqual([8, 12]);
  });

  it('un vuoto nel loop svuota anche il tratto copiato', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(addMidiClip(track(0), 9, 2));
    store.apply(setLoopRegion({ start: 4, end: 8 }));
    store.apply(duplicateLoopRegion());
    expect(shape(store, 0)).toEqual([]);
  });
});

describe('Duplica loop di una clip posata', () => {
  it('la clip che finiva con il loop si allunga per far sentire la copia', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(addMidiClip(track(0), 0, 4));
    const id = store.project.tracks[0].arrangement[0].id;
    store.apply(duplicateLoopAt(placementRef(track(0), id)));
    const pl = store.project.tracks[0].arrangement[0];
    expect([pl.length, (pl.clip as MidiClip).loop.end]).toEqual([8, 8]);
  });

  it('una clip che ripete già il loop più volte resta lunga com\'è', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(addMidiClip(track(0), 0, 4));
    const id = store.project.tracks[0].arrangement[0].id;
    store.apply(resizePlacement(track(0), id, { end: 12 }));
    store.apply(duplicateLoopAt(placementRef(track(0), id)));
    const pl = store.project.tracks[0].arrangement[0];
    expect([pl.length, (pl.clip as MidiClip).loop.end]).toEqual([12, 8]);
  });
});
