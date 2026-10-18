import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPresets, removePreset, safeName, savePreset } from '../../electron/presets';

let root: string;
beforeEach(async () => { root = join(await mkdtemp(join(tmpdir(), 'studiomio-preset-')), 'Preset'); });
afterEach(async () => { await rm(join(root, '..'), { recursive: true, force: true }); });

const files = async () => (await readdir(root, { recursive: true })).map(f => f.replaceAll('\\', '/')).filter(f => f.endsWith('.json')).sort();

describe('preset dell\'utente come file', () => {
  it('cartella che non c\'è ancora: nessun preset', async () => {
    expect(await loadPresets(root)).toEqual([]);
  });

  it('un file per preset nella cartella del dispositivo, leggibile a mano', async () => {
    await savePreset(root, 'Prisma', { type: 'prisma', name: 'Pad caldo', params: { cutoff: 0.5 } });
    await savePreset(root, 'Delay', { type: 'delay', name: 'Eco', params: {} });
    expect(await files()).toEqual(['Delay/Eco.json', 'Prisma/Pad caldo.json']);
    const body = JSON.parse(await readFile(join(root, 'Prisma', 'Pad caldo.json'), 'utf8'));
    expect(body).toEqual({ studiomio: 'preset', version: 1, type: 'prisma', name: 'Pad caldo', params: { cutoff: 0.5 } });
    expect(await loadPresets(root)).toEqual(expect.arrayContaining([
      { type: 'prisma', name: 'Pad caldo', params: { cutoff: 0.5 } }, { type: 'delay', name: 'Eco', params: {} },
    ]));
  });

  it('salvare di nuovo lo stesso preset scrive sul suo file, anche se l\'utente lo ha spostato', async () => {
    await savePreset(root, 'Analog', { type: 'analog', name: 'Basso', params: { a: 1 } });
    await mkdir(join(root, 'Miei'), { recursive: true });
    await rename(join(root, 'Analog', 'Basso.json'), join(root, 'Miei', 'basso preferito.json'));
    await savePreset(root, 'Analog', { type: 'analog', name: 'Basso', params: { a: 2 } });
    expect(await files()).toEqual(['Miei/basso preferito.json']);
    expect(await loadPresets(root)).toEqual([{ type: 'analog', name: 'Basso', params: { a: 2 } }]);
  });

  it('nomi diversi che danno lo stesso nome di file non si sovrascrivono', async () => {
    await savePreset(root, 'Analog', { type: 'analog', name: 'a/b', params: {} });
    await savePreset(root, 'Analog', { type: 'analog', name: 'a:b', params: {} });
    // stesso nome ma altro dispositivo, nella stessa cartella: file a parte
    await savePreset(root, 'Analog', { type: 'drums', name: 'a/b', params: {} });
    expect(await files()).toEqual(['Analog/a_b (2).json', 'Analog/a_b (3).json', 'Analog/a_b.json']);
    expect((await loadPresets(root)).map(p => `${p.type}:${p.name}`).sort()).toEqual(['analog:a/b', 'analog:a:b', 'drums:a/b']);
  });

  it('elimina solo il preset scelto', async () => {
    await savePreset(root, 'Analog', { type: 'analog', name: 'Uno', params: {} });
    await savePreset(root, 'Analog', { type: 'analog', name: 'Due', params: {} });
    await removePreset(root, 'analog', 'Uno');
    expect(await files()).toEqual(['Analog/Due.json']);
  });

  it('i file che non sono preset si saltano', async () => {
    await mkdir(join(root, 'Altro'), { recursive: true });
    await writeFile(join(root, 'Altro', 'rotto.json'), '{rotto');
    await writeFile(join(root, 'Altro', 'altro.json'), JSON.stringify({ hello: 1 }));
    await writeFile(join(root, 'Altro', 'note.txt'), 'ciao');
    await writeFile(join(root, 'Altro', 'ok.json'), JSON.stringify({ type: 'eq', name: 'Ok', params: { g: 1, x: 'no' } }));
    expect(await loadPresets(root)).toEqual([{ type: 'eq', name: 'Ok', params: { g: 1 } }]);
  });

  it('nomi di file validi in Windows', () => {
    expect(safeName('Pad: caldo / "vero"?')).toBe('Pad_ caldo _ _vero__');
    expect(safeName('  fine...  ')).toBe('fine');
    expect(safeName('..')).toBe('preset');
    expect(safeName('CON')).toBe('_CON');
    expect(safeName('com1.txt')).toBe('_com1.txt');
    expect(safeName('x'.repeat(300))).toHaveLength(100);
  });
});
