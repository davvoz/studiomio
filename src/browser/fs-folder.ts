/* Le cartelle del disco per il browser, con la File System Access API (Chrome, Edge ed
 * Electron): la cartella la sceglie l'utente; le scelte si ricordano tra un avvio e l'altro in
 * IndexedDB (un handle di cartella si può conservare lì, non in localStorage). Dopo un riavvio
 * il browser può chiedere di nuovo il permesso di leggerla: lo chiede un clic dell'utente. */
import type { FolderPlaces } from './catalog';
import type { FolderEntry, FolderReader } from './sample-sources';

type Permission = 'granted' | 'denied' | 'prompt';

/** I metodi dei permessi non sono ancora nei tipi di TypeScript. */
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

  /** Si può leggere senza chiedere? */
  async readable(): Promise<boolean> {
    const h = this.handle as PermissionHandle;
    return !h.queryPermission || (await h.queryPermission({ mode: 'read' })) === 'granted';
  }

  /** Chiede il permesso di leggerla (serve un clic dell'utente). */
  async request(): Promise<boolean> {
    const h = this.handle as PermissionHandle;
    return !h.requestPermission || (await h.requestPermission({ mode: 'read' })) === 'granted';
  }

  /** È la stessa cartella del disco? */
  same(other: FsFolder): Promise<boolean> {
    return this.handle.isSameEntry(other.handle);
  }

  /** Fa scegliere una cartella all'utente. */
  static async pick(): Promise<FsFolder> {
    const picker = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (!picker) throw new Error('questo browser non permette di scegliere una cartella: usa Chrome o Edge');
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

/** Le cartelle in IndexedDB; senza IndexedDB (o se è bloccato) si ricordano solo finché l'app è aperta. */
export const indexedDbPlaces: FolderPlaces<FsFolder> = {
  async load() {
    try {
      const handles = await run<FileSystemDirectoryHandle[] | undefined>('readonly', s => s.get(KEY));
      return (handles ?? []).map(h => new FsFolder(h));
    } catch {
      return [];
    }
  },
  async save(folders) {
    try {
      await run('readwrite', s => s.put(folders.map(f => f.handle), KEY));
    } catch (e) {
      console.warn('browser: non è stato possibile ricordare le cartelle', e);
    }
  },
};
