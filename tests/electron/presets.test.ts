import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPresets, removePreset, safeName, savePreset } from '../../electron/presets';

let root: string;
beforeEach(async () => { root = join(await mkdtemp(join(tmpdir(), 'studiomio-preset-')), 'Preset'); });
afterEach(async () => { await rm(join(root, '..'), { recursive: true, force: true }); });

const files = async () => (await readdir(root, { recursive: true })).map(f => f.replaceAll('\\', '/')).filter(f => f.endsWith('.json')).sort();

describe('user presets as files', () => {
  it('folder that doesn\'t exist yet: no presets', async () => {
    expect(await loadPresets(root)).toEqual([]);
  });

  it('one file per preset in the device\'s folder, readable by hand', async () => {
    await savePreset(root, 'Prisma', { type: 'prisma', name: 'Warm pad', params: { cutoff: 0.5 } });
    await savePreset(root, 'Delay', { type: 'delay', name: 'Echo', params: {} });
    expect(await files()).toEqual(['Delay/Echo.json', 'Prisma/Warm pad.json']);
    const body = JSON.parse(await readFile(join(root, 'Prisma', 'Warm pad.json'), 'utf8'));
    expect(body).toEqual({ studiomio: 'preset', version: 1, type: 'prisma', name: 'Warm pad', params: { cutoff: 0.5 } });
    expect(await loadPresets(root)).toEqual(expect.arrayContaining([
      { type: 'prisma', name: 'Warm pad', params: { cutoff: 0.5 } }, { type: 'delay', name: 'Echo', params: {} },
    ]));
  });

  it('saving the same preset again writes to its file, even if the user moved it', async () => {
    await savePreset(root, 'Analog', { type: 'analog', name: 'Bass', params: { a: 1 } });
    await mkdir(join(root, 'Mine'), { recursive: true });
    await rename(join(root, 'Analog', 'Bass.json'), join(root, 'Mine', 'favourite bass.json'));
    await savePreset(root, 'Analog', { type: 'analog', name: 'Bass', params: { a: 2 } });
    expect(await files()).toEqual(['Mine/favourite bass.json']);
    expect(await loadPresets(root)).toEqual([{ type: 'analog', name: 'Bass', params: { a: 2 } }]);
  });

  it('different names giving the same file name don\'t overwrite each other', async () => {
    await savePreset(root, 'Analog', { type: 'analog', name: 'a/b', params: {} });
    await savePreset(root, 'Analog', { type: 'analog', name: 'a:b', params: {} });
    // same name but another device, in the same folder: separate file
    await savePreset(root, 'Analog', { type: 'drums', name: 'a/b', params: {} });
    expect(await files()).toEqual(['Analog/a_b (2).json', 'Analog/a_b (3).json', 'Analog/a_b.json']);
    expect((await loadPresets(root)).map(p => `${p.type}:${p.name}`).sort()).toEqual(['analog:a/b', 'analog:a:b', 'drums:a/b']);
  });

  it('deletes only the chosen preset', async () => {
    await savePreset(root, 'Analog', { type: 'analog', name: 'One', params: {} });
    await savePreset(root, 'Analog', { type: 'analog', name: 'Two', params: {} });
    await removePreset(root, 'analog', 'One');
    expect(await files()).toEqual(['Analog/Two.json']);
  });

  it('the files that aren\'t presets are skipped', async () => {
    await mkdir(join(root, 'Other'), { recursive: true });
    await writeFile(join(root, 'Other', 'broken.json'), '{rotto');
    await writeFile(join(root, 'Other', 'other.json'), JSON.stringify({ hello: 1 }));
    await writeFile(join(root, 'Other', 'note.txt'), 'hello');
    await writeFile(join(root, 'Other', 'ok.json'), JSON.stringify({ type: 'eq', name: 'Ok', params: { g: 1, x: 'no' } }));
    expect(await loadPresets(root)).toEqual([{ type: 'eq', name: 'Ok', params: { g: 1 } }]);
  });

  it('file names valid on Windows', () => {
    expect(safeName('Pad: warm / "real"?')).toBe('Pad_ warm _ _real__');
    expect(safeName('  fine...  ')).toBe('fine');
    expect(safeName('..')).toBe('preset');
    expect(safeName('CON')).toBe('_CON');
    expect(safeName('com1.txt')).toBe('_com1.txt');
    expect(safeName('x'.repeat(300))).toHaveLength(100);
  });
});
