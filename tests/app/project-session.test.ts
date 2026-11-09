import { describe, expect, it } from 'vitest';
import { ProjectSession, type SessionAudio } from '../../src/app/project-session';
import { randomIds, type SampleId } from '../../src/core/id';
import type { AudioData } from '../../src/dsp/types';
import { Project } from '../../src/model/project';
import { MemoryDirectory, readText } from '../../src/persistence/directory';
import { PROJECT_FILE, RECOVERY_FILE } from '../../src/persistence/project-folder';
import { addSample, addTrack, placeSample } from '../../src/store/edits';
import { ProjectStore } from '../../src/store/project-store';

/** Fake audio: "decodes" any file into 1 s of stereo silence and records the loaded samples. */
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
  it('imports a file: copy into the folder, analysis, clip on the timeline', async () => {
    const store = new ProjectStore(Project.empty('p', randomIds), randomIds);
    const { audio, loaded } = fakeAudio();
    const session = new ProjectSession(store, audio, async () => new MemoryDirectory());
    await session.importFiles([fileOf('kick.wav'), fileOf('snare.wav')], null, 4);
    const p = store.project;
    expect(p.samples.map(s => [s.name, s.file, s.analysis?.tempo])).toEqual([['kick', 'audio/kick.wav', 100], ['snare', 'audio/snare.wav', 100]]);
    expect(p.tracks.map(t => t.name)).toEqual(['kick', 'snare']); // one file per track
    expect(p.tracks[0].arrangement[0].start).toBe(4);
    expect(p.samples[0].analysis?.transients).toEqual([0, 0.5]);
    expect(loaded.size).toBe(2);
  });

  it('saves as, reopens and finds everything', async () => {
    const disk = new MemoryDirectory('Song');
    const store = new ProjectStore(Project.empty('p', randomIds), randomIds);
    const { audio, loaded } = fakeAudio();
    const session = new ProjectSession(store, audio, async () => disk);
    expect([session.saved, session.changed]).toEqual([false, false]); // empty: nothing to lose
    const sample = await session.addAudio('loop.wav', { channels: [new Float32Array(10)], sampleRate: 44100 }, new Uint8Array([9, 9]));
    store.apply(addSample(sample));
    await session.importFiles([fileOf('voce.wav')], null, 0);
    store.apply(placeSample(store.project.tracks[0].id, sample.id, 8));

    expect(session.changed).toBe(true);

    await session.save(); // never saved: it asks for the folder
    expect([session.saved, session.changed]).toEqual([true, false]);
    expect(session.name).toBe('Song');
    expect(await disk.list('audio')).toEqual(expect.arrayContaining(['loop.wav', 'voce.wav']));
    expect(await disk.exists(PROJECT_FILE)).toBe(true);

    const saved = store.project;
    await session.newProject();
    // it starts with a MIDI track, an audio one and two buses
    expect(store.project.tracks.map(t => t.kind)).toEqual(['midi', 'audio']);
    expect(store.project.buses.map(b => b.name)).toEqual(['A Bus', 'B Bus']);
    expect(session.changed).toBe(false);
    loaded.clear();
    await session.open();
    expect(store.project.id).toBe(saved.id);
    expect(store.project.tracks[0].arrangement).toHaveLength(2);
    expect(loaded.size).toBe(2); // the samples go back into the engine
    expect(session.saved).toBe(true);
    expect(store.canUndo).toBe(false);

    await session.newProject();
    store.apply(addTrack('audio'));
    expect(session.changed).toBe(true);
    session.forgetChanges(); // like the demo just loaded
    expect([session.changed, session.saved]).toEqual([false, false]); // it loses nothing, but it isn't on disk
  });

  it('collect and save to ZIP: another user opens it and saves it in their folder', async () => {
    const disk = new MemoryDirectory('Song');
    const store = new ProjectStore(Project.empty('p', randomIds), randomIds);
    const { audio } = fakeAudio();
    const session = new ProjectSession(store, audio, async () => disk);
    await session.importFiles([fileOf('voce.wav')], null, 0);
    await session.addAudio('discard.wav', { channels: [new Float32Array(10)], sampleRate: 44100 }, new Uint8Array([9]));
    await session.save();
    store.apply(addTrack('audio'));

    const zip = await session.collectAndSave();
    expect(zip.name).toBe('Song.zip');
    expect(session.changed).toBe(false); // on disk: it also saves the folder

    const other = new MemoryDirectory('Theirs');
    const theirs = new ProjectStore(Project.empty('q', randomIds), randomIds);
    const them = fakeAudio();
    const received = new ProjectSession(theirs, them.audio, async () => other);
    await received.openArchive(zip);
    expect(theirs.project.id).toBe(store.project.id);
    expect(theirs.project.tracks).toHaveLength(2);
    expect(theirs.project.samples.map(s => s.file)).toEqual(['audio/voce.wav']); // the discarded one doesn't travel
    expect(them.loaded.size).toBe(1);
    expect([received.name, received.saved, received.changed]).toEqual(['Song', false, false]);

    await received.save(); // it isn't on disk: it asks for the folder
    expect(received.saved).toBe(true);
    expect(await other.list('audio')).toEqual(['voce.wav']);
    expect(await other.exists(PROJECT_FILE)).toBe(true);
  });

  it('opening a folder without a project is a clear error', async () => {
    const store = new ProjectStore(Project.empty('p', randomIds), randomIds);
    const session = new ProjectSession(store, fakeAudio().audio, async () => new MemoryDirectory('Empty'));
    await expect(session.open()).rejects.toThrow(/"Empty" doesn't contain a studiomio project/);
  });

  it('says which folder the project lives in (for the recents): save as and open, not save nor the ZIP', async () => {
    const disk = new MemoryDirectory('Song');
    const store = new ProjectStore(Project.empty('p', randomIds), randomIds);
    const session = new ProjectSession(store, fakeAudio().audio, async () => new MemoryDirectory('Never chosen'));
    const stored: string[] = [];
    session.on('stored', dir => stored.push(dir.name));
    await session.newProject();
    await expect(session.open(new MemoryDirectory('Empty'))).rejects.toThrow(/doesn't contain/);
    const other = new ProjectSession(store, fakeAudio().audio, async () => disk);
    await other.saveAs();
    await session.open(disk); // an already known folder: it doesn't ask for it
    await session.save();
    await session.openArchive(await session.collectAndSave());
    expect(stored).toEqual(['Song']);
  });

  it('recovery copy: the unsaved changes are recovered on reopening, saving removes it', async () => {
    const disk = new MemoryDirectory('Song');
    const store = new ProjectStore(Project.empty('p', randomIds), randomIds);
    const { audio, loaded } = fakeAudio();
    const session = new ProjectSession(store, audio, async () => disk);
    await session.autosave(); // it isn't on disk: nothing
    expect(await disk.exists(RECOVERY_FILE)).toBe(false);
    await session.save();
    await session.autosave(); // nothing to save
    expect(await disk.exists(RECOVERY_FILE)).toBe(false);

    await session.importFiles([fileOf('voce.wav')], null, 0);
    await session.autosave();
    expect(await disk.exists(RECOVERY_FILE)).toBe(true);
    const unsaved = store.project;
    const saved = JSON.parse(await readText(disk, PROJECT_FILE));

    // the app hangs: the folder is reopened
    const store2 = new ProjectStore(Project.empty('q', randomIds), randomIds);
    const audio2 = fakeAudio();
    const reopened = new ProjectSession(store2, audio2.audio, async () => disk);
    await reopened.open();
    expect(store2.project.tracks).toHaveLength(0); // the saved one opens
    expect(await reopened.hasRecovery()).toBe(true);
    await reopened.restoreRecovery();
    expect(store2.project.tracks.map(t => t.name)).toEqual(unsaved.tracks.map(t => t.name));
    expect(audio2.loaded.size).toBe(1); // the sample imported after saving goes back into the engine
    expect(reopened.changed).toBe(true); // it still needs saving
    expect(JSON.parse(await readText(disk, PROJECT_FILE))).toEqual(saved); // the saved one isn't touched

    await reopened.save();
    expect(await disk.exists(RECOVERY_FILE)).toBe(false);
    expect(await reopened.hasRecovery()).toBe(false);

    // throwing away the changes removes the copy
    store2.apply(addTrack('midi'));
    await reopened.autosave();
    expect(await reopened.hasRecovery()).toBe(true);
    await reopened.discardRecovery();
    expect(await disk.exists(RECOVERY_FILE)).toBe(false);
    expect(loaded.size).toBe(1);
  });

  it('damaged recovery copy: the project opens anyway, without offering it', async () => {
    const disk = new MemoryDirectory('Song');
    const store = new ProjectStore(Project.empty('p', randomIds), randomIds);
    const session = new ProjectSession(store, fakeAudio().audio, async () => disk);
    await session.save();
    await disk.writeBytes(RECOVERY_FILE, new TextEncoder().encode('{ broken'));
    await session.open();
    expect(await session.hasRecovery()).toBe(false);
  });
});
