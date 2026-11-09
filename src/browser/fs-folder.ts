/* Disk folders for the browser, with the File System Access API (Chrome, Edge and
 * Electron): the user chooses the folder; the choices are remembered from one start to the next in
 * IndexedDB (a folder handle can be kept there, not in localStorage). After a restart
 * the browser may ask again for permission to read it: a user click asks for it. */
import type { FolderPlaces } from './catalog';
import type { FolderEntry, FolderReader } from './sample-sources';

type Permission = 'granted' | 'denied' | 'prompt';

/** The permission methods aren't in TypeScript's types yet. */
interface PermissionHandle extends FileSystemDirectoryHandle {
  queryPermission?(o: { mode: 'read' }): Promise<Permission>;
  requestPermission?(o: { mode: 'read' }): Promise<Permission>;
}

export class FsFolder implements FolderReader {
  constructor(readonly handle: FileSystemDirectoryHandle) {}

  get name(): string {
    return this.handle.name;
  }

  async entries(): Promise<FolderEntry[]> {
    const out: FolderEntry[] = [];
    for await (const h of this.handle.values()) {
      if (h.kind === 'directory') out.push({ kind: 'folder', name: h.name, folder: new FsFolder(h) });
      else out.push({ kind: 'file', name: h.name, file: () => h.getFile() });
    }
    return out;
  }

  /** Can it be read without asking? */
  async readable(): Promise<boolean> {
    const h = this.handle as PermissionHandle;
    return !h.queryPermission || (await h.queryPermission({ mode: 'read' })) === 'granted';
  }

  /** Asks for permission to read it (needs a user click). */
  async request(): Promise<boolean> {
    const h = this.handle as PermissionHandle;
    return !h.requestPermission || (await h.requestPermission({ mode: 'read' })) === 'granted';
  }

  /** Is it the same disk folder? */
  same(other: FsFolder): Promise<boolean> {
    return this.handle.isSameEntry(other.handle);
  }

  /** Lets the user choose a folder. */
  static async pick(): Promise<FsFolder> {
    const picker = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (!picker) throw new Error('this browser doesn\'t allow choosing a folder: use Chrome or Edge');
    return new FsFolder(await picker({ mode: 'read', id: 'studiomio-browser' }));
  }
}

const DB = 'studiomio-browser', STORE = 'places', KEY = 'folders';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(db => new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close()));
}

/** The folders remembered under `key` (empty if IndexedDB is missing or blocked). */
export async function loadHandles(key: string): Promise<FileSystemDirectoryHandle[]> {
  try {
    return (await run<FileSystemDirectoryHandle[] | undefined>('readonly', s => s.get(key))) ?? [];
  } catch {
    return [];
  }
}

/** Remembers the folders under `key`; without IndexedDB they only last while the app is open. */
export async function saveHandles(key: string, handles: readonly FileSystemDirectoryHandle[]): Promise<void> {
  try {
    await run('readwrite', s => s.put([...handles], key));
  } catch (e) {
    console.warn('couldn\'t remember the folders', e);
  }
}

/** The browser's folders in IndexedDB. */
export const indexedDbPlaces: FolderPlaces<FsFolder> = {
  load: async () => (await loadHandles(KEY)).map(h => new FsFolder(h)),
  save: folders => saveHandles(KEY, folders.map(f => f.handle)),
};
