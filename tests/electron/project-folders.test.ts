import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  exists, FOLDER_ICON, inside, list, markProjectFolder, projectFolderIn, read, remove, write,
} from '../../electron/project-folders';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'studiomio-project-')); });
afterEach(async () => {
  // the folder marked read-only and the hidden system files: they're removed anyway
  if (process.platform === 'win32') execFileSync('attrib', ['-r', '-h', '-s', root]);
  await rm(root, { recursive: true, force: true });
});

describe('project folders on disk', () => {
  it('files by relative path: written (with their folders), read, listed, removed', async () => {
    await write(root, 'audio/kick.wav', new Uint8Array([1, 2, 3]));
    await write(root, 'progetto.studiomio', new Uint8Array([123]));
    expect(await read(root, 'audio/kick.wav')).toEqual(new Uint8Array([1, 2, 3]));
    expect(await read(root, 'audio/none.wav')).toBeNull();
    expect(await list(root, '')).toEqual(['progetto.studiomio']);
    expect(await list(root, 'audio')).toEqual(['kick.wav']);
    expect(await list(root, 'missing')).toEqual([]);
    await remove(root, 'audio/kick.wav');
    expect(await exists(root, 'audio/kick.wav')).toBe(false);
    await remove(root, 'audio/kick.wav'); // already gone: nothing happens
  });

  it('nothing outside the folder', () => {
    expect(inside(root, 'audio/kick.wav')).toBe(join(root, 'audio', 'kick.wav'));
    for (const bad of ['../x', 'audio/../../x', '/etc/passwd', 'C:/x', 'a\\..\\b']) expect(() => inside(root, bad)).toThrow(/invalid path/);
    expect(() => inside('relative', 'x')).toThrow(/absolute/);
  });

  it('what Windows asks to open: the folder of a project file, or a folder', async () => {
    await mkdir(join(root, 'Song'));
    const file = join(root, 'Song', 'progetto.studiomio');
    await writeFile(file, '{}');
    await writeFile(join(root, 'note.txt'), '');
    expect(await projectFolderIn(['--flag', file])).toBe(join(root, 'Song'));
    expect(await projectFolderIn([join(root, 'Song')])).toBe(join(root, 'Song'));
    expect(await projectFolderIn([join(root, 'note.txt'), join(root, 'missing')])).toBeNull();
    expect(await projectFolderIn([])).toBeNull();
  });

  it.runIf(process.platform === 'win32')('the folder gets the icon once; an existing desktop.ini is left alone', async () => {
    const icon = join(root, 'source.ico');
    await writeFile(icon, new Uint8Array([0, 0, 1, 0]));
    const song = join(root, 'Song');
    await mkdir(song);
    await markProjectFolder(song, icon);
    expect(await readFile(join(song, 'desktop.ini'), 'utf8')).toContain(`IconResource=${FOLDER_ICON},0`);
    expect(await readFile(join(song, FOLDER_ICON))).toEqual(Buffer.from([0, 0, 1, 0]));
    const attributes = (path: string) => execFileSync('attrib', [path], { encoding: 'utf8' }).slice(0, 12);
    expect(attributes(join(song, 'desktop.ini'))).toMatch(/S.*H/);
    expect(attributes(join(song, FOLDER_ICON))).toContain('H');
    expect(attributes(song)).toContain('R');
    await markProjectFolder(song, icon); // already marked: no error, nothing changes
    // a folder that already has its own desktop.ini
    const own = join(root, 'Own');
    await mkdir(own);
    await writeFile(join(own, 'desktop.ini'), '[.ShellClassInfo]\r\nIconResource=mine.ico,0\r\n');
    await markProjectFolder(own, icon);
    expect(await exists(own, FOLDER_ICON)).toBe(false);
    execFileSync('attrib', ['-r', song]);
  });
});
