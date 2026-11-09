/** A folder to read and write files in, with relative paths separated by "/".
 *  The project doesn't know whether underneath there's the disk (File System Access API), a server or memory. */
export interface Directory {
  readonly name: string;
  exists(path: string): Promise<boolean>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, data: Uint8Array): Promise<void>;
  /** Names of the files (not the folders) contained in `dir`. */
  list(dir: string): Promise<string[]>;
  remove(path: string): Promise<void>;
}

export class FileNotFoundError extends Error {
  constructor(readonly path: string) {
    super(`file not found: ${path}`);
    this.name = 'FileNotFoundError';
  }
}

export const readText = async (d: Directory, path: string): Promise<string> =>
  new TextDecoder().decode(await d.readBytes(path));

export const writeText = (d: Directory, path: string, text: string): Promise<void> =>
  d.writeBytes(path, new TextEncoder().encode(text));

/** Splits a path into folders and file name, rejecting ".." and absolute paths. */
export function splitPath(path: string): { dirs: string[]; file: string } {
  const parts = path.split('/').filter(p => p !== '' && p !== '.');
  if (parts.length === 0 || parts.includes('..') || path.startsWith('/')) throw new Error(`invalid path: "${path}"`);
  return { dirs: parts.slice(0, -1), file: parts[parts.length - 1] };
}

/** In-memory folder: for tests and for projects not saved yet. */
export class MemoryDirectory implements Directory {
  private readonly files = new Map<string, Uint8Array>();

  constructor(readonly name = 'memory') {}

  async exists(path: string): Promise<boolean> {
    return this.files.has(MemoryDirectory.key(path));
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const data = this.files.get(MemoryDirectory.key(path));
    if (!data) throw new FileNotFoundError(path);
    return data.slice();
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    this.files.set(MemoryDirectory.key(path), data.slice());
  }

  async list(dir: string): Promise<string[]> {
    const prefix = dir ? `${splitPath(`${dir}/x`).dirs.join('/')}/` : '';
    return [...this.files.keys()]
      .filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .map(k => k.slice(prefix.length));
  }

  async remove(path: string): Promise<void> {
    this.files.delete(MemoryDirectory.key(path));
  }

  private static key(path: string): string {
    const { dirs, file } = splitPath(path);
    return [...dirs, file].join('/');
  }
}
