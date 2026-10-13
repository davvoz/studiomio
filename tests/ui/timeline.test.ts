import { describe, expect, it } from 'vitest';
import { TimeSignature } from '../../src/core/music-time';
import { addMidiClip, placeSample } from '../../src/store/edits';
import { addedPlacements, deleteMany, duplicateMany, importSample, relocate, splitMany } from '../../src/store/selection-edits';
import { gridStep, hitTest, placementsInBox, TimelineGeometry } from '../../src/ui/timeline/geometry';
import { planMove, planResize, resolveSelection, snappedDelta } from '../../src/ui/timeline/planning';
import { sampleRef, setup } from '../helpers/fixtures';

describe('geometria della timeline', () => {
  it('battiti ↔ pixel, zoom attorno al puntatore', () => {
    const g = new TimelineGeometry(20, 4, 0);
    expect(g.beatToX(5)).toBe(20);
    expect(g.xToBeat(40)).toBe(6);
    const z = g.zoomed(40, 40); // il battito 6 resta a x=40
    expect(z.xToBeat(40)).toBeCloseTo(6, 12);
    expect(z.pxPerBeat).toBe(40);
    expect(g.zoomed(1e6, 0).pxPerBeat).toBe(600);
  });

  it('la griglia si adatta allo zoom', () => {
    const sig = TimeSignature.COMMON;
    expect(gridStep(200, sig)).toBe(1 / 8);
    expect(gridStep(24, sig)).toBe(1);
    expect(gridStep(3, sig)).toBe(8);
    expect(gridStep(24, new TimeSignature(6, 8))).toBe(1);
  });

  it('cosa c\'è sotto il puntatore: bordi, corpo, corsia, vuoto', () => {
    const { store, track } = setup({ midi: 2 });
    store.apply(addMidiClip(track(1), 4, 4)); // battiti 4–8 sulla seconda traccia
    const g = new TimelineGeometry(20, 0, 0, 70);
    const p = store.project;
    expect(hitTest(p, g, 82, 100)).toMatchObject({ kind: 'clip', zone: 'start', trackIndex: 1 });
    expect(hitTest(p, g, 120, 100)).toMatchObject({ kind: 'clip', zone: 'body' });
    expect(hitTest(p, g, 157, 100)).toMatchObject({ kind: 'clip', zone: 'end' });
    expect(hitTest(p, g, 120, 10)).toMatchObject({ kind: 'lane', trackIndex: 0 });
    expect(hitTest(p, g, 120, 500)).toMatchObject({ kind: 'empty' });
    expect(placementsInBox(p, 0, 5, 0, 1)).toHaveLength(1);
    expect(placementsInBox(p, 0, 3.9, 0, 5)).toHaveLength(0);
  });
});

describe('pianificazione dei gesti', () => {
  it('lo spostamento aggancia la clip presa alla griglia', () => {
    expect(snappedDelta(4, 1.3, 1)).toBe(1);
    expect(snappedDelta(4.5, 1.3, 1)).toBe(1.5);
    expect(snappedDelta(4, -10, 1)).toBe(-4); // mai prima dell'inizio
    expect(snappedDelta(4, 1.3, null)).toBeCloseTo(1.3, 12);
  });

  it('spostare su un\'altra traccia solo se è dello stesso tipo', () => {
    const { store, track, sampleId } = setup({ audio: 2, midi: 1, sample: true });
    store.apply(placeSample(track(0), sampleId, 0));
    const refs = resolveSelection(store.project, new Set([store.project.tracks[0].arrangement[0].id]));
    expect(planMove(store.project, refs, 2, 1, false)[0]).toMatchObject({ to: track(1), start: 2 });
    expect(planMove(store.project, refs, 2, 2, false)[0]).toMatchObject({ to: track(0) }); // la MIDI non va
    expect(planMove(store.project, refs, 2, -1, false)[0]).toMatchObject({ to: track(0) }); // fuori dall'elenco
  });

  it('ridimensionare rispetta i limiti del contenuto', () => {
    const { store, track, sampleId } = setup({ audio: 1, sample: true });
    store.apply(placeSample(track(0), sampleId, 4)); // 8 battiti, senza loop
    const pl = store.project.tracks[0].arrangement[0];
    expect(planResize(pl, 'start', 0, 1)).toEqual({ start: 4, end: 12 }); // non prima del contenuto
    expect(planResize(pl, 'start', 11.9, 1)).toEqual({ start: 11, end: 12 }); // lunghezza minima
    expect(planResize(pl, 'end', 30, 1)).toEqual({ start: 4, end: 12 }); // non oltre la fine del sample
    expect(planResize(pl, 'end', 6, 1)).toEqual({ start: 4, end: 6 });
  });
});

describe('modifiche sulla selezione', () => {
  it('spostare insieme due clip adiacenti non le fa tagliare a vicenda', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(addMidiClip(track(0), 0, 4));
    store.apply(addMidiClip(track(0), 4, 4));
    const refs = resolveSelection(store.project, new Set(store.project.tracks[0].arrangement.map(p => p.id)));
    store.apply(relocate('Sposta', planMove(store.project, refs, 2, 0, false)));
    expect(store.project.tracks[0].arrangement.map(p => [p.start, p.length])).toEqual([[2, 4], [6, 4]]);
  });

  it('duplicare mette la copia dopo la selezione; le copie sono nuove clip', () => {
    const { store, track } = setup({ midi: 2 });
    store.apply(addMidiClip(track(0), 0, 4));
    store.apply(addMidiClip(track(1), 2, 4));
    const before = store.project;
    const refs = resolveSelection(store.project, new Set(store.project.tracks.flatMap(t => t.arrangement.map(p => p.id))));
    store.apply(duplicateMany(refs));
    const added = addedPlacements(before, store.project);
    expect(added).toHaveLength(2);
    expect(store.project.tracks.map(t => t.arrangement.map(p => p.start))).toEqual([[0, 6], [2, 8]]);
    expect(store.undoLabel).toBe('Duplica');
  });

  it('dividere ed eliminare', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(addMidiClip(track(0), 0, 8));
    const refs = resolveSelection(store.project, new Set([store.project.tracks[0].arrangement[0].id]));
    store.apply(splitMany(refs, 3));
    expect(store.project.tracks[0].arrangement.map(p => p.start)).toEqual([0, 3]);
    store.apply(deleteMany(resolveSelection(store.project, new Set(store.project.tracks[0].arrangement.map(p => p.id)))));
    expect(store.project.tracks[0].arrangement).toHaveLength(0);
  });

  it('importare un sample: sulla traccia audio indicata, altrimenti su una nuova', () => {
    const { store, track, ids } = setup({ audio: 1, midi: 1 });
    store.apply(importSample(sampleRef(ids, { name: 'kick' }), track(0), 4));
    expect(store.project.tracks[0].arrangement[0].start).toBe(4);
    store.apply(importSample(sampleRef(ids, { name: 'snare', file: 'audio/snare.wav' }), track(1), 0));
    expect(store.project.tracks).toHaveLength(3);
    expect(store.project.tracks[2].name).toBe('snare');
    expect(store.undoLabel).toBe('Importa audio');
  });
});
