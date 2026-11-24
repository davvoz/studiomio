import { afterEach, describe, expect, it, vi } from 'vitest';
import { FsFolder, indexedDbPlaces, loadHandles, saveHandles } from '../../src/browser/fs-folder';

/** A folder handle with `children`: files are strings, folders objects. */
function handle(name: string, children: Record<string, unknown> = {}, perms: { query?: string; request?: string } = {}): FileSystemDirectoryHandle {
  return {
    name, kind: 'directory',
    async *values() {
      for (const [n, c] of Object.entries(children)) {
        yield typeof c === 'string' ? { kind: 'file', name: n, getFile: async () => new File([c], n) } : handle(n, c as Record<string, unknown>);
      }
    },
    queryPermission: perms.query ? async () => perms.query : undefined,
    requestPermission: perms.request ? async () => perms.request : undefined,
    isSameEntry: async (o: FileSystemDirectoryHandle) => o.name === name,
  } as unknown as FileSystemDirectoryHandle;
}

describe('browser folders', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists files and subfolders', async () => {
    const f = new FsFolder(handle('Samples', { 'kick.wav': 'x', Loops: { 'a.wav': 'y' } }));
    expect(f.name).toBe('Samples');
    const entries = await f.entries();
    expect(entries.map(e => `${e.kind} ${e.name}`)).toEqual(['file kick.wav', 'folder Loops']);
    const file = entries[0];
    expect(file.kind === 'file' && (await file.file()).name).toBe('kick.wav');
    const sub = entries[1];
    expect(sub.kind === 'folder' && (await sub.folder.entries()).map(e => e.name)).toEqual(['a.wav']);
    expect(await f.same(new FsFolder(handle('Samples')))).toBe(true);
  });

  it('permissions: readable without the API or when granted; a request may be refused', async () => {
    expect(await new FsFolder(handle('a')).readable()).toBe(true);
    expect(await new FsFolder(handle('a')).request()).toBe(true);
    expect(await new FsFolder(handle('a', {}, { query: 'prompt' })).readable()).toBe(false);
    expect(await new FsFolder(handle('a', {}, { request: 'denied' })).request()).toBe(false);
    expect(await new FsFolder(handle('a', {}, { query: 'granted', request: 'granted' })).readable()).toBe(true);
  });

  it('picking a folder needs the browser\'s picker', async () => {
    vi.stubGlobal('window', {});
    await expect(FsFolder.pick()).rejects.toThrow(/Chrome or Edge/);
    vi.stubGlobal('window', { showDirectoryPicker: async () => handle('Chosen') });
    expect((await FsFolder.pick()).name).toBe('Chosen');
  });

  it('without IndexedDB nothing is remembered, and nothing breaks', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadHandles('x')).toEqual([]);
    await saveHandles('x', [handle('a')]);
    await indexedDbPlaces.save([new FsFolder(handle('a'))]);
    expect(await indexedDbPlaces.load()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
