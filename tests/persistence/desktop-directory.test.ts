import { describe, expect, it } from 'vitest';
import { DesktopDirectory, type DesktopFolders } from '../../src/persistence/desktop-directory';
import { FileNotFoundError, MemoryDirectory } from '../../src/persistence/directory';
import { PROJECT_FILE, ProjectFolder } from '../../src/persistence/project-folder';
import { setup } from '../helpers/fixtures';

/** The main process, faked with one in-memory folder per path; it records the calls. */
function fakeFolders(picked: string | null = 'C:\\Musica\\Abisso NEW') {
  const disks = new Map<string, MemoryDirectory>();
  const disk = (root: string) => disks.get(root) ?? disks.set(root, new MemoryDirectory()).get(root)!;
  const calls: string[] = [];
  const folders: DesktopFolders = {
    pick: async () => picked,
    exists: (root, path) => disk(root).exists(path),
    read: (root, path) => disk(root).readBytes(path).catch(() => null),
    write: (root, path, data) => { calls.push(`write ${path}`); return disk(root).writeBytes(path, data); },
    list: (root, dir) => disk(root).list(dir),
    remove: (root, path) => disk(root).remove(path),
    markProject: async root => { calls.push(`mark ${root}`); },
    launched: async () => null,
    onOpen: () => {},
  };
  return { folders, calls, disk };
}

describe('desktop folders, by path', () => {
  it('the folder chosen by path: its name, its files, the icon when saving a project', async () => {
    const { folders, calls } = fakeFolders();
    const dir = await DesktopDirectory.pick(folders);
    expect([dir.path, dir.name]).toEqual(['C:\\Musica\\Abisso NEW', 'Abisso NEW']);
    expect(new DesktopDirectory('/home/me/Song/', folders).name).toBe('Song');

    const { store } = setup({ audio: 1 });
    await new ProjectFolder(dir).save(store.project);
    expect(calls).toEqual([`write ${PROJECT_FILE}`, 'mark C:\\Musica\\Abisso NEW']);
    expect((await new ProjectFolder(dir).load()).project.tracks).toHaveLength(1);
    expect(await dir.list('')).toEqual([PROJECT_FILE]);
  });

  it('a missing file is FileNotFoundError; no paths outside the folder', async () => {
    const dir = new DesktopDirectory('C:\\Song', fakeFolders().folders);
    await expect(dir.readBytes('audio/none.wav')).rejects.toBeInstanceOf(FileNotFoundError);
    await expect(dir.writeBytes('../outside.txt', new Uint8Array(1))).rejects.toThrow(/invalid path/);
    await expect(dir.exists('/abs.txt')).rejects.toThrow(/invalid path/);
  });

  it('giving up the choice is an AbortError, as in the browser (the app ignores it)', async () => {
    await expect(DesktopDirectory.pick(fakeFolders(null).folders)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
