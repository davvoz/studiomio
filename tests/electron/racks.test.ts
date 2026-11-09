import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRacks, removeRack, saveRack } from '../../electron/racks';

let root: string;
beforeEach(async () => { root = join(await mkdtemp(join(tmpdir(), 'studiomio-rack-')), 'Rack'); });
afterEach(async () => { await rm(join(root, '..'), { recursive: true, force: true }); });

const files = async () => (await readdir(root, { recursive: true })).map(f => f.replaceAll('\\', '/')).filter(f => f.endsWith('.json')).sort();

const rack = (name: string, mix = 30) => ({ name, instrument: null, effects: [{ type: 'delay', params: { mix } }], macros: [] });

describe('user racks as files', () => {
  it('folder that doesn\'t exist yet: no racks', async () => {
    expect(await loadRacks(root)).toEqual([]);
  });

  it('one file per rack, readable by hand', async () => {
    await saveRack(root, rack('Dirty bass'));
    expect(await files()).toEqual(['Dirty bass.json']);
    const body = JSON.parse(await readFile(join(root, 'Dirty bass.json'), 'utf8'));
    expect(body).toEqual({ studiomio: 'rack', version: 1, ...rack('Dirty bass') });
    expect(await loadRacks(root)).toEqual([rack('Dirty bass')]);
  });

  it('saving the same rack again writes to its file, even if the user moved it; it\'s deleted', async () => {
    await saveRack(root, rack('Echo'));
    await mkdir(join(root, 'Mine'), { recursive: true });
    await rename(join(root, 'Echo.json'), join(root, 'Mine', 'favourite echo.json'));
    await saveRack(root, rack('Echo', 80));
    expect(await files()).toEqual(['Mine/favourite echo.json']);
    expect(await loadRacks(root)).toEqual([rack('Echo', 80)]);
    await removeRack(root, 'Echo');
    expect(await files()).toEqual([]);
  });

  it('the files that aren\'t racks are skipped; odd names become valid file names', async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'preset.json'), JSON.stringify({ studiomio: 'preset', name: 'X', type: 'delay', params: {} }));
    await writeFile(join(root, 'broken.json'), '{');
    await saveRack(root, rack('a/b'));
    await saveRack(root, rack('a:b'));
    expect(await files()).toEqual(['a_b (2).json', 'a_b.json', 'broken.json', 'preset.json']);
    expect((await loadRacks(root)).map(r => r.name).sort()).toEqual(['a/b', 'a:b']);
  });
});
