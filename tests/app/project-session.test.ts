import { describe, expect, it } from 'vitest';
import { ProjectSession, type SessionAudio } from '../../src/app/project-session';
import { randomIds, type SampleId } from '../../src/core/id';
import type { AudioData } from '../../src/dsp/types';
import { Project } from '../../src/model/project';
import { MemoryDirectory, readText } from '../../src/persistence/directory';
import { PROJECT_FILE, RECOVERY_FILE } from '../../src/persistence/project-folder';
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
    // si comincia con una traccia MIDI, una audio e due bus
    expect(store.project.tracks.map(t => t.kind)).toEqual(['midi', 'audio']);
    expect(store.project.buses.map(b => b.name)).toEqual(['A Bus', 'B Bus']);
    expect(session.changed).toBe(false);
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

  it('raccogli e salva in ZIP: un altro utente lo apre e lo salva nella sua cartella', async () => {
    const disk = new MemoryDirectory('Brano');
    const store = new ProjectStore(Project.empty('p', randomIds), randomIds);
    const { audio } = fakeAudio();
    const session = new ProjectSession(store, audio, async () => disk);
    await session.importFiles([fileOf('voce.wav')], null, 0);
    await session.addAudio('scarto.wav', { channels: [new Float32Array(10)], sampleRate: 44100 }, new Uint8Array([9]));
    await session.save();
    store.apply(addTrack('audio'));

    const zip = await session.collectAndSave();
    expect(zip.name).toBe('Brano.zip');
    expect(session.changed).toBe(false); // su disco: salva anche la cartella

    const other = new MemoryDirectory('Suo');
    const theirs = new ProjectStore(Project.empty('q', randomIds), randomIds);
    const them = fakeAudio();
    const received = new ProjectSession(theirs, them.audio, async () => other);
    await received.openArchive(zip);
    expect(theirs.project.id).toBe(store.project.id);
    expect(theirs.project.tracks).toHaveLength(2);
    expect(theirs.project.samples.map(s => s.file)).toEqual(['audio/voce.wav']); // lo scarto non viaggia
    expect(them.loaded.size).toBe(1);
    expect([received.name, received.saved, received.changed]).toEqual(['Brano', false, false]);

    await received.save(); // non è su disco: chiede la cartella
    expect(received.saved).toBe(true);
    expect(await other.list('audio')).toEqual(['voce.wav']);
    expect(await other.exists(PROJECT_FILE)).toBe(true);
  });

  it('aprire una cartella senza progetto è un errore chiaro', async () => {
    const store = new ProjectStore(Project.empty('p', randomIds), randomIds);
    const session = new ProjectSession(store, fakeAudio().audio, async () => new MemoryDirectory('Vuota'));
    await expect(session.open()).rejects.toThrow(/"Vuota" non contiene un progetto/);
  });

  it('dice in che cartella vive il progetto (per i recenti): salva con nome e apri, non salva né lo ZIP', async () => {
    const disk = new MemoryDirectory('Brano');
    const store = new ProjectStore(Project.empty('p', randomIds), randomIds);
    const session = new ProjectSession(store, fakeAudio().audio, async () => new MemoryDirectory('Mai scelta'));
    const stored: string[] = [];
    session.on('stored', dir => stored.push(dir.name));
    await session.newProject();
    await expect(session.open(new MemoryDirectory('Vuota'))).rejects.toThrow(/non contiene/);
    const other = new ProjectSession(store, fakeAudio().audio, async () => disk);
    await other.saveAs();
    await session.open(disk); // una cartella già nota: non la chiede
    await session.save();
    await session.openArchive(await session.collectAndSave());
    expect(stored).toEqual(['Brano']);
  });

  it('copia di recupero: le modifiche non salvate si riprendono riaprendo, salvare la toglie', async () => {
    const disk = new MemoryDirectory('Brano');
    const store = new ProjectStore(Project.empty('p', randomIds), randomIds);
    const { audio, loaded } = fakeAudio();
    const session = new ProjectSession(store, audio, async () => disk);
    await session.autosave(); // non è su disco: niente
    expect(await disk.exists(RECOVERY_FILE)).toBe(false);
    await session.save();
    await session.autosave(); // niente da salvare
    expect(await disk.exists(RECOVERY_FILE)).toBe(false);

    await session.importFiles([fileOf('voce.wav')], null, 0);
    await session.autosave();
    expect(await disk.exists(RECOVERY_FILE)).toBe(true);
    const unsaved = store.project;
    const saved = JSON.parse(await readText(disk, PROJECT_FILE));

    // l'app si blocca: si riapre la cartella
    const store2 = new ProjectStore(Project.empty('q', randomIds), randomIds);
    const audio2 = fakeAudio();
    const reopened = new ProjectSession(store2, audio2.audio, async () => disk);
    await reopened.open();
    expect(store2.project.tracks).toHaveLength(0); // si apre il salvato
    expect(await reopened.hasRecovery()).toBe(true);
    await reopened.restoreRecovery();
    expect(store2.project.tracks.map(t => t.name)).toEqual(unsaved.tracks.map(t => t.name));
    expect(audio2.loaded.size).toBe(1); // il sample importato dopo il salvataggio torna nel motore
    expect(reopened.changed).toBe(true); // resta da salvare
    expect(JSON.parse(await readText(disk, PROJECT_FILE))).toEqual(saved); // il salvato non si tocca

    await reopened.save();
    expect(await disk.exists(RECOVERY_FILE)).toBe(false);
    expect(await reopened.hasRecovery()).toBe(false);

    // buttare le modifiche toglie la copia
    store2.apply(addTrack('midi'));
    await reopened.autosave();
    expect(await reopened.hasRecovery()).toBe(true);
    await reopened.discardRecovery();
    expect(await disk.exists(RECOVERY_FILE)).toBe(false);
    expect(loaded.size).toBe(1);
  });

  it('copia di recupero rovinata: il progetto si apre lo stesso, senza proporla', async () => {
    const disk = new MemoryDirectory('Brano');
    const store = new ProjectStore(Project.empty('p', randomIds), randomIds);
    const session = new ProjectSession(store, fakeAudio().audio, async () => disk);
    await session.save();
    await disk.writeBytes(RECOVERY_FILE, new TextEncoder().encode('{ rotto'));
    await session.open();
    expect(await session.hasRecovery()).toBe(false);
  });
});
