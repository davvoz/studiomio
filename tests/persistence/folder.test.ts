import { describe, expect, it } from 'vitest';
import { MemoryDirectory, readText } from '../../src/persistence/directory';
import { BACKUP_FILE, PROJECT_FILE, ProjectFolder, safeFileName } from '../../src/persistence/project-folder';
import { addSample, placeSample, setTempo } from '../../src/store/edits';
import { sampleRef, setup } from '../helpers/fixtures';

const bytes = (n: number) => new Uint8Array(n).map((_, i) => i % 251);

describe('ProjectFolder', () => {
  it('salva e riapre il progetto, tenendo la versione precedente come backup', async () => {
    const dir = new MemoryDirectory('Brano');
    const folder = new ProjectFolder(dir);
    const { store, track, sampleId } = setup({ audio: 1, sample: true });
    await dir.writeBytes('audio/loop.wav', bytes(100));
    store.apply(placeSample(track(0), sampleId, 0));

    expect(await folder.hasProject()).toBe(false);
    await folder.save(store.project);
    store.apply(setTempo(140));
    await folder.save(store.project);

    const { project, missing } = await folder.load();
    expect(project.tempo.bpm).toBe(140);
    expect(missing).toEqual([]);
    expect(JSON.parse(await readText(dir, BACKUP_FILE)).tempo).toBe(120);
    expect(await dir.list('')).toEqual(expect.arrayContaining([PROJECT_FILE, BACKUP_FILE]));
  });

  it('non salva se mancano dei file audio, e li segnala all\'apertura', async () => {
    const dir = new MemoryDirectory();
    const folder = new ProjectFolder(dir);
    const { store } = setup({ sample: true });
    await expect(folder.save(store.project)).rejects.toThrow(/mancano i file audio: audio\/loop.wav/);
    await dir.writeBytes('audio/loop.wav', bytes(10));
    await folder.save(store.project);
    await dir.remove('audio/loop.wav');
    const { missing } = await folder.load();
    expect(missing.map(s => s.file)).toEqual(['audio/loop.wav']);
  });

  it('importa l\'audio con nomi sicuri e senza sovrascrivere', async () => {
    const dir = new MemoryDirectory();
    const folder = new ProjectFolder(dir);
    expect(await folder.importAudio('kick.wav', bytes(5))).toBe('audio/kick.wav');
    expect(await folder.importAudio('Kick.WAV', bytes(6))).toBe('audio/Kick 2.WAV');
    expect(await folder.importAudio('kick.wav', bytes(7))).toBe('audio/kick 3.wav');
    expect(await folder.importAudio('a/b:c?.wav', bytes(1))).toBe('audio/a_b_c_.wav');
    expect((await dir.readBytes('audio/kick 3.wav')).length).toBe(7);
  });

  it('trova i file audio non più usati', async () => {
    const dir = new MemoryDirectory();
    const folder = new ProjectFolder(dir);
    const { store, ids } = setup({ sample: true });
    store.apply(addSample(sampleRef(ids, { file: 'audio/usato.wav' })));
    for (const f of ['loop.wav', 'usato.wav', 'vecchio.wav']) await dir.writeBytes(`audio/${f}`, bytes(1));
    expect(await folder.unusedAudio(store.project)).toEqual(['audio/vecchio.wav']);
  });

  it('nomi di file', () => {
    expect(safeFileName('  .nascosto. ')).toBe('nascosto');
    expect(safeFileName('???')).toBe('___');
    expect(safeFileName('')).toBe('audio');
  });
});
