/** Una cartella in cui leggere e scrivere file, con percorsi relativi separati da "/".
 *  Il progetto non sa se sotto c'è il disco (File System Access API), un server o la memoria. */
export interface Directory {
  readonly name: string;
  exists(path: string): Promise<boolean>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, data: Uint8Array): Promise<void>;
  /** Nomi dei file (non delle cartelle) contenuti in `dir`. */
  list(dir: string): Promise<string[]>;
  remove(path: string): Promise<void>;
}

export class FileNotFoundError extends Error {
  constructor(readonly path: string) {
    super(`file non trovato: ${path}`);
    this.name = 'FileNotFoundError';
  }
}

export const readText = async (d: Directory, path: string): Promise<string> =>
  new TextDecoder().decode(await d.readBytes(path));

export const writeText = (d: Directory, path: string, text: string): Promise<void> =>
  d.writeBytes(path, new TextEncoder().encode(text));

/** Separa un percorso in cartelle e nome del file, rifiutando ".." e percorsi assoluti. */
export function splitPath(path: string): { dirs: string[]; file: string } {
  const parts = path.split('/').filter(p => p !== '' && p !== '.');
  if (parts.length === 0 || parts.includes('..') || path.startsWith('/')) throw new Error(`percorso non valido: "${path}"`);
  return { dirs: parts.slice(0, -1), file: parts[parts.length - 1] };
}

/** Cartella in memoria: per i test e per i progetti non ancora salvati. */
export class MemoryDirectory implements Directory {
  private readonly files = new Map<string, Uint8Array>();

  constructor(readonly name = 'memoria') {}

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
