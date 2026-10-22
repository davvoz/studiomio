import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, makeZip, readZip, type ZipEntry } from '../../src/dsp/codec/zip';
import { MemoryDirectory, readText } from '../../src/persistence/directory';
import { BACKUP_FILE, PROJECT_FILE, ProjectFolder, safeFileName, unpackProject } from '../../src/persistence/project-folder';
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

  it('raccoglie il progetto in uno ZIP con i soli file audio che usa', async () => {
    const dir = new MemoryDirectory('Brano');
    const folder = new ProjectFolder(dir);
    const { store, track, sampleId, ids } = setup({ audio: 1, sample: true });
    store.apply(addSample(sampleRef(ids, { name: 'scartato', file: 'audio/scartato.wav' })));
    store.apply(placeSample(track(0), sampleId, 0));
    await dir.writeBytes('audio/loop.wav', bytes(100));
    await dir.writeBytes('audio/scartato.wav', bytes(3));
    await dir.writeBytes('audio/vecchio.wav', bytes(3));
    await folder.save(store.project);
    await folder.save(store.project); // c'è anche il backup

    const entries = await folder.archive(store.project, 'Brano: v2');
    expect(entries.map(e => e.name)).toEqual([`Brano_ v2/${PROJECT_FILE}`, 'Brano_ v2/audio/loop.wav']);
    const json = JSON.parse(new TextDecoder().decode(entries[0].data));
    expect(json.samples.map((s: { file: string }) => s.file)).toEqual(['audio/loop.wav']);
    expect(entries[1].data).toEqual(bytes(100));

    await dir.remove('audio/loop.wav');
    await expect(folder.archive(store.project, 'Brano')).rejects.toThrow(/mancano i file audio: audio\/loop.wav/);
  });

  it('riapre lo ZIP raccolto come una cartella di progetto', async () => {
    const dir = new MemoryDirectory('Brano');
    const { store, track, sampleId } = setup({ audio: 1, sample: true });
    store.apply(placeSample(track(0), sampleId, 4));
    await dir.writeBytes('audio/loop.wav', bytes(100));
    const zip = makeZip(await new ProjectFolder(dir).archive(store.project, 'Brano'));

    const unpacked = await unpackProject(zip, 'ricevuto');
    expect(unpacked.name).toBe('Brano');
    const { project, missing } = await new ProjectFolder(unpacked).load();
    expect(missing).toEqual([]);
    expect(project.id).toBe(store.project.id);
    expect(project.tracks[0].arrangement[0].start).toBe(4);
    expect(await unpacked.readBytes('audio/loop.wav')).toEqual(bytes(100));
  });

  it('apre anche uno ZIP fatto a mano: compresso, senza cartella in cima, con file di troppo', async () => {
    const { store } = setup({ sample: true });
    const json = new TextEncoder().encode(await projectJson(store.project));
    const zip = deflatedZip([
      { name: PROJECT_FILE, data: json },
      { name: 'audio/loop.wav', data: bytes(1000) },
      { name: '../fuori.txt', data: bytes(1) },
      { name: BACKUP_FILE, data: bytes(1) },
    ]);
    const unpacked = await unpackProject(zip, 'A mano');
    expect(unpacked.name).toBe('A mano');
    expect((await unpacked.list('')).sort()).toEqual([PROJECT_FILE]);
    expect(await unpacked.readBytes('audio/loop.wav')).toEqual(bytes(1000));
    expect((await new ProjectFolder(unpacked).load()).missing).toEqual([]);

    await expect(unpackProject(deflatedZip([{ name: 'altro/note.txt', data: bytes(1) }]), 'Niente')).rejects.toThrow(/"Niente" non contiene un progetto/);
    await expect(readZip(bytes(100))).rejects.toThrow(/non è uno ZIP/);
  });

  it('nomi di file', () => {
    expect(safeFileName('  .nascosto. ')).toBe('nascosto');
    expect(safeFileName('???')).toBe('___');
    expect(safeFileName('')).toBe('audio');
  });
});

async function projectJson(project: Parameters<ProjectFolder['save']>[0]): Promise<string> {
  const dir = new MemoryDirectory();
  await dir.writeBytes('audio/loop.wav', bytes(1));
  await new ProjectFolder(dir).save(project);
  return readText(dir, PROJECT_FILE);
}

/** Uno ZIP compresso con deflate, come lo fanno Esplora risorse o 7-Zip. */
function deflatedZip(files: readonly ZipEntry[]): Uint8Array {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), packed = new Uint8Array(deflateRawSync(f.data));
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(8, 8, true); lh.setUint32(14, crc32(f.data), true);
    lh.setUint32(18, packed.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, packed);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(10, 8, true); ch.setUint32(16, crc32(f.data), true);
    ch.setUint32(20, packed.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + packed.length;
  }
  const cd = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cd, true); end.setUint32(16, offset, true);
  return new Uint8Array(Buffer.concat([...parts, ...central, new Uint8Array(end.buffer)]));
}
