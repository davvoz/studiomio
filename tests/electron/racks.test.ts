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

describe('rack dell\'utente come file', () => {
  it('cartella che non c\'è ancora: nessun rack', async () => {
    expect(await loadRacks(root)).toEqual([]);
  });

  it('un file per rack, leggibile a mano', async () => {
    await saveRack(root, rack('Basso sporco'));
    expect(await files()).toEqual(['Basso sporco.json']);
    const body = JSON.parse(await readFile(join(root, 'Basso sporco.json'), 'utf8'));
    expect(body).toEqual({ studiomio: 'rack', version: 1, ...rack('Basso sporco') });
    expect(await loadRacks(root)).toEqual([rack('Basso sporco')]);
  });

  it('salvare di nuovo lo stesso rack scrive sul suo file, anche se l\'utente lo ha spostato; si elimina', async () => {
    await saveRack(root, rack('Eco'));
    await mkdir(join(root, 'Miei'), { recursive: true });
    await rename(join(root, 'Eco.json'), join(root, 'Miei', 'eco preferito.json'));
    await saveRack(root, rack('Eco', 80));
    expect(await files()).toEqual(['Miei/eco preferito.json']);
    expect(await loadRacks(root)).toEqual([rack('Eco', 80)]);
    await removeRack(root, 'Eco');
    expect(await files()).toEqual([]);
  });

  it('i file che non sono rack si saltano; i nomi strani diventano nomi di file validi', async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'preset.json'), JSON.stringify({ studiomio: 'preset', name: 'X', type: 'delay', params: {} }));
    await writeFile(join(root, 'rotto.json'), '{');
    await saveRack(root, rack('a/b'));
    await saveRack(root, rack('a:b'));
    expect(await files()).toEqual(['a_b (2).json', 'a_b.json', 'preset.json', 'rotto.json']);
    expect((await loadRacks(root)).map(r => r.name).sort()).toEqual(['a/b', 'a:b']);
  });
});
