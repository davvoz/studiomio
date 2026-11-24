import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileNotFoundError } from '../../src/persistence/directory';
import { FsAccessDirectory } from '../../src/persistence/fs-access-directory';

const notFound = () => new DOMException('not found', 'NotFoundError');

/** An in-memory folder handle behaving like the browser's: missing entries are NotFoundError. */
function folder(name: string): FileSystemDirectoryHandle {
  const files = new Map<string, Uint8Array>(), dirs = new Map<string, FileSystemDirectoryHandle>();
  const fileHandle = (n: string) => ({
    kind: 'file', name: n,
    getFile: async () => new File([files.get(n)! as Uint8Array<ArrayBuffer>], n),
    createWritable: async () => ({ write: async (d: Uint8Array) => { files.set(n, d); }, close: async () => {} }),
  });
  return {
    name, kind: 'directory',
    getFileHandle: async (n: string, o?: { create?: boolean }) => {
      if (n === 'locked') throw new DOMException('no', 'NotAllowedError');
      if (!files.has(n)) {
        if (!o?.create) throw notFound();
        files.set(n, new Uint8Array());
      }
      return fileHandle(n);
    },
    getDirectoryHandle: async (n: string, o?: { create?: boolean }) => {
      if (!dirs.has(n)) {
        if (!o?.create) throw notFound();
        dirs.set(n, folder(n));
      }
      return dirs.get(n)!;
    },
    removeEntry: async (n: string) => {
      if (n === 'locked') throw new Error('busy');
      if (!files.delete(n)) throw notFound();
    },
    async *values() {
      for (const n of files.keys()) yield { kind: 'file', name: n };
      for (const d of dirs.values()) yield d;
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe('project folders in the browser (File System Access)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('writes, reads, lists and removes files, also in subfolders', async () => {
    const d = new FsAccessDirectory(folder('Song'));
    expect(d.name).toBe('Song');
    expect(await d.exists('audio/a.wav')).toBe(false);
    await d.writeBytes('audio/a.wav', new Uint8Array([1, 2, 3]));
    await d.writeBytes('project.json', new Uint8Array([4]));
    expect(await d.exists('audio/a.wav')).toBe(true);
    expect([...await d.readBytes('audio/a.wav')]).toEqual([1, 2, 3]);
    expect(await d.list('audio')).toEqual(['a.wav']);
    expect(await d.list('')).toEqual(['project.json']);
    expect(await d.list('missing')).toEqual([]);
    await d.remove('audio/a.wav');
    await d.remove('audio/a.wav');
    await d.remove('nowhere/a.wav');
    await expect(d.readBytes('audio/a.wav')).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('other errors are not hidden', async () => {
    const d = new FsAccessDirectory(folder('Song'));
    await expect(d.exists('locked')).rejects.toThrow('no');
    await expect(d.remove('locked')).rejects.toThrow('busy');
  });

  it('choosing needs the browser\'s picker; a remembered folder needs permission', async () => {
    vi.stubGlobal('window', {});
    await expect(FsAccessDirectory.pick()).rejects.toThrow(/Chrome or Edge/);
    vi.stubGlobal('window', { showDirectoryPicker: async () => folder('Chosen') });
    expect((await FsAccessDirectory.pick()).name).toBe('Chosen');
    const asking = (query: string, request?: string) =>
      Object.assign(folder('Old'), { queryPermission: async () => query, requestPermission: request ? async () => request : undefined });
    expect(await FsAccessDirectory.reopen(asking('prompt', 'granted'))).toBeInstanceOf(FsAccessDirectory);
    await expect(FsAccessDirectory.reopen(asking('prompt', 'denied'))).rejects.toThrow('permission denied for the folder "Old"');
    await expect(FsAccessDirectory.reopen(asking('prompt'))).rejects.toThrow(/permission denied/);
  });
});
