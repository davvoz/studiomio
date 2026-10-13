import { FileNotFoundError, splitPath, type Directory } from './directory';

/** Cartella vera sul disco, scelta dall'utente con la File System Access API
 *  (Chrome ed Edge). Il permesso di scrittura viene chiesto alla prima scrittura. */
export class FsAccessDirectory implements Directory {
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  /** Chiede all'utente di scegliere (o creare) la cartella del progetto. */
  static async pick(): Promise<FsAccessDirectory> {
    const picker = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (!picker) throw new Error('questo browser non permette di scegliere una cartella: usa Chrome o Edge');
    return new FsAccessDirectory(await picker({ mode: 'readwrite', id: 'studiomio-project' }));
  }

  get name(): string {
    return this.root.name;
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.fileHandle(path, false);
      return true;
    } catch (e) {
      if (e instanceof FileNotFoundError) return false;
      throw e;
    }
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const file = await (await this.fileHandle(path, false)).getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    const w = await (await this.fileHandle(path, true)).createWritable();
    try {
      await w.write(data as Uint8Array<ArrayBuffer>);
    } finally {
      await w.close();
    }
  }

  async list(dir: string): Promise<string[]> {
    let handle: FileSystemDirectoryHandle;
    try {
      handle = dir ? await this.dirHandle(splitPath(`${dir}/x`).dirs, false) : this.root;
    } catch (e) {
      if (e instanceof FileNotFoundError) return [];
      throw e;
    }
    const names: string[] = [];
    const entries = (handle as unknown as { values(): AsyncIterable<FileSystemHandle> }).values();
    for await (const h of entries) if (h.kind === 'file') names.push(h.name);
    return names;
  }

  async remove(path: string): Promise<void> {
    const { dirs, file } = splitPath(path);
    try {
      await (await this.dirHandle(dirs, false)).removeEntry(file);
    } catch (e) {
      if (!(e instanceof FileNotFoundError) && !(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
    }
  }

  private async fileHandle(path: string, create: boolean): Promise<FileSystemFileHandle> {
    const { dirs, file } = splitPath(path);
    const dir = await this.dirHandle(dirs, create);
    return FsAccessDirectory.notFound(path, () => dir.getFileHandle(file, { create }));
  }

  private async dirHandle(dirs: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let h = this.root;
    for (const d of dirs) {
      const parent = h;
      h = await FsAccessDirectory.notFound(dirs.join('/'), () => parent.getDirectoryHandle(d, { create }));
    }
    return h;
  }

  private static async notFound<T>(path: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) throw new FileNotFoundError(path);
      throw e;
    }
  }
}
