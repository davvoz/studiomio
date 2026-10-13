import { describe, expect, it, vi } from 'vitest';
import type { AudioClip } from '../../src/model/audio-clip';
import {
  addMidiClip, addScene, deletePlacement, duplicatePlacement, movePlacement, placeSample, renameTrack,
  resizePlacement, setMixer, setSlot, setTempo, splitPlacement, updateClip,
} from '../../src/store/edits';
import { edit } from '../../src/store/project-store';
import { setup } from '../helpers/fixtures';

describe('ProjectStore', () => {
  it('annulla e ripeti', () => {
    const { store } = setup();
    store.apply(setTempo(90));
    store.apply(setTempo(100));
    expect(store.undoLabel).toBe('Tempo');
    store.undo();
    expect(store.project.tempo.bpm).toBe(90);
    store.undo();
    expect(store.project.tempo.bpm).toBe(120);
    store.redo();
    expect(store.project.tempo.bpm).toBe(90);
    store.apply(setTempo(70));
    expect(store.canRedo).toBe(false); // una modifica nuova cancella il "ripeti"
  });

  it('le modifiche continue con la stessa chiave sono un solo passo', () => {
    const { store } = setup();
    const before = store.project;
    for (const bpm of [121, 122, 123]) store.apply(setTempo(bpm), { mergeKey: 'drag-tempo' });
    store.endMerge();
    store.apply(setTempo(140), { mergeKey: 'drag-tempo' });
    store.undo();
    expect(store.project.tempo.bpm).toBe(123);
    store.undo();
    expect(store.project).toBe(before);
  });

  it('una modifica che non cambia nulla non entra nella cronologia', () => {
    const { store } = setup();
    const listener = vi.fn();
    store.onChange(listener);
    store.apply(setTempo(120));
    expect(store.canUndo).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('se una modifica fallisce il progetto resta com\'era', () => {
    const { store } = setup();
    const before = store.project;
    expect(() => store.apply(edit('rotta', () => { throw new Error('no'); }))).toThrow('no');
    expect(store.project).toBe(before);
    expect(store.canUndo).toBe(false);
  });

  it('avvisa chi ascolta, con la causa', () => {
    const { store } = setup();
    const causes: string[] = [];
    store.onChange((_p, _prev, cause) => causes.push(cause));
    store.apply(setTempo(99));
    store.undo();
    store.redo();
    store.load(store.project);
    expect(causes).toEqual(['edit', 'undo', 'redo', 'load']);
    expect(store.canUndo).toBe(false);
  });
});

describe('modifiche', () => {
  it('nomi e colori delle tracce nuove', () => {
    const { store } = setup({ audio: 2, midi: 1 });
    expect(store.project.tracks.map(t => t.name)).toEqual(['1 Audio', '2 Audio', '1 MIDI']);
    expect(new Set(store.project.tracks.map(t => t.color)).size).toBe(3);
  });

  it('inserire un sample, spostarlo su un\'altra traccia, accorciarlo da sinistra', () => {
    const { store, track, sampleId } = setup({ audio: 2, sample: true });
    store.apply(placeSample(track(0), sampleId, 4));
    const pl = store.project.tracks[0].arrangement[0];
    expect([pl.start, pl.length]).toEqual([4, 8]);

    store.apply(movePlacement(track(0), pl.id, 16, track(1)));
    expect(store.project.tracks[0].arrangement).toHaveLength(0);
    expect(store.project.tracks[1].arrangement[0].start).toBe(16);

    store.apply(resizePlacement(track(1), pl.id, { start: 18 }));
    const r = store.project.tracks[1].arrangement[0];
    expect([r.start, r.length, r.offset]).toEqual([18, 6, 2]);
    // il bordo sinistro non può andare prima dell'inizio del contenuto
    store.apply(resizePlacement(track(1), pl.id, { start: 0 }));
    expect(store.project.tracks[1].arrangement[0].start).toBe(16);
  });

  it('una clip MIDI non va su una traccia audio', () => {
    const { store, track } = setup({ audio: 1, midi: 1 });
    store.apply(addMidiClip(track(1), 0, 4));
    const id = store.project.tracks[1].arrangement[0].id;
    expect(() => store.apply(movePlacement(track(1), id, 0, track(0)))).toThrow(TypeError);
    expect(store.project.tracks[1].arrangement).toHaveLength(1);
  });

  it('duplicare crea una copia indipendente subito dopo', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(addMidiClip(track(0), 0, 4));
    const pl = store.project.tracks[0].arrangement[0];
    store.apply(duplicatePlacement(track(0), pl.id));
    const [a, b] = store.project.tracks[0].arrangement;
    expect(b.start).toBe(4);
    expect(b.clip.id).not.toBe(a.clip.id);
    store.apply(splitPlacement(track(0), b.id, 6));
    expect(store.project.tracks[0].arrangement).toHaveLength(3);
    store.apply(deletePlacement(track(0), a.id));
    expect(store.project.tracks[0].arrangement).toHaveLength(2);
  });

  it('modificare il contenuto di una clip posata', () => {
    const { store, track, sampleId } = setup({ audio: 1, sample: true });
    store.apply(placeSample(track(0), sampleId, 0));
    const id = store.project.tracks[0].arrangement[0].id;
    store.apply(updateClip<AudioClip>('Transpose', track(0), id, c => c.withTranspose(5)));
    expect((store.project.tracks[0].arrangement[0].clip as AudioClip).transpose).toBe(5);
    expect(store.undoLabel).toBe('Transpose');
  });

  it('session, scene, mixer e nomi', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(addScene());
    expect(store.project.tracks[0].slots).toHaveLength(5);
    const clip = store.project.tracks[0].slots[0];
    expect(clip).toBeNull();
    store.apply(addMidiClip(track(0), 0, 4));
    store.apply(setSlot(track(0), 4, store.project.tracks[0].arrangement[0].clip));
    expect(store.project.tracks[0].slots[4]).not.toBeNull();
    store.apply(setMixer(track(0), { volumeDb: -6, solo: true }));
    store.apply(renameTrack(track(0), 'Basso'));
    expect(store.project.tracks[0].mixer).toMatchObject({ volumeDb: -6, solo: true, mute: false });
    expect(store.project.tracks[0].name).toBe('Basso');
  });
});
