import { describe, expect, it } from 'vitest';
import { ProjectSession, type SessionAudio } from '../../src/app/project-session';
import { randomIds, type SampleId } from '../../src/core/id';
import type { AudioData } from '../../src/dsp/types';
import { Project } from '../../src/model/project';
import { MemoryDirectory } from '../../src/persistence/directory';
import { PROJECT_FILE } from '../../src/persistence/project-folder';
import { addSample, addTrack, placeSample } from '../../src/store/edits';
import { ProjectStore } from '../../src/store/project-store';

/** Audio finto: "decodifica" qualunque file in 1 s di silenzio stereo e registra i sample caricati. */
function fakeAudio() {
  const loaded = new Map<SampleId, AudioData>();
  const audio: SessionAudio = {
    context: {
      decodeAudioData: async () => ({
        numberOfChannels: 2, sampleRate: 44100, getChannelData: () => new Float32Array(44100),
      }) as unknown as AudioBuffer,
    },
    engine: { stop: () => {} },
    dsp: { analyze: async () => ({ tempo: 100, transients: [0, 22050] }) },
    addSample: async (id, data) => { loaded.set(id, data); },
  };
  return { audio, loaded };
}

const fileOf = (name: string) => new File([new Uint8Array([1, 2, 3, 4])], name);

describe('ProjectSession', () => {
  it('importa un file: copia nella cartella, analisi, clip sulla timeline', async () => {
    const store = new ProjectStore(Project.empty('p', randomIds), randomIds);
    const { audio, loaded } = fakeAudio();
    const session = new ProjectSession(store, audio, async () => new MemoryDirectory());
    await session.importFiles([fileOf('kick.wav'), fileOf('snare.wav')], null, 4);
    const p = store.project;
    expect(p.samples.map(s => [s.name, s.file, s.analysis?.tempo])).toEqual([['kick', 'audio/kick.wav', 100], ['snare', 'audio/snare.wav', 100]]);
    expect(p.tracks.map(t => t.name)).toEqual(['kick', 'snare']); // un file per traccia
    expect(p.tracks[0].arrangement[0].start).toBe(4);
    expect(p.samples[0].analysis?.transients).toEqual([0, 0.5]);
    expect(loaded.size).toBe(2);
  });

  it('salva con nome, riapre e ritrova tutto', async () => {
    const disk = new MemoryDirectory('Brano');
    const store = new ProjectStore(Project.empty('p', randomIds), randomIds);
    const { audio, loaded } = fakeAudio();
    const session = new ProjectSession(store, audio, async () => disk);
    expect([session.saved, session.changed]).toEqual([false, false]); // vuoto: niente da perdere
    const sample = await session.addAudio('loop.wav', { channels: [new Float32Array(10)], sampleRate: 44100 }, new Uint8Array([9, 9]));
    store.apply(addSample(sample));
    await session.importFiles([fileOf('voce.wav')], null, 0);
    store.apply(placeSample(store.project.tracks[0].id, sample.id, 8));

    expect(session.changed).toBe(true);

    await session.save(); // mai salvato: chiede la cartella
    expect([session.saved, session.changed]).toEqual([true, false]);
    expect(session.name).toBe('Brano');
    expect(await disk.list('audio')).toEqual(expect.arrayContaining(['loop.wav', 'voce.wav']));
    expect(await disk.exists(PROJECT_FILE)).toBe(true);

    const saved = store.project;
    await session.newProject();
    expect(store.project.tracks).toHaveLength(0);
    loaded.clear();
    await session.open();
    expect(store.project.id).toBe(saved.id);
    expect(store.project.tracks[0].arrangement).toHaveLength(2);
    expect(loaded.size).toBe(2); // i sample tornano nel motore
    expect(session.saved).toBe(true);
    expect(store.canUndo).toBe(false);

    await session.newProject();
    store.apply(addTrack('audio'));
    expect(session.changed).toBe(true);
    session.forgetChanges(); // come il demo appena caricato
    expect([session.changed, session.saved]).toEqual([false, false]); // non perde nulla, ma non è su disco
  });

  it('aprire una cartella senza progetto è un errore chiaro', async () => {
    const store = new ProjectStore(Project.empty('p', randomIds), randomIds);
    const session = new ProjectSession(store, fakeAudio().audio, async () => new MemoryDirectory('Vuota'));
    await expect(session.open()).rejects.toThrow(/"Vuota" non contiene un progetto/);
  });
});
