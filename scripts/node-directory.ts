/* Una cartella del disco come Directory del progetto, per gli script in Node. */
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { FileNotFoundError, splitPath, type Directory } from '../src/persistence/directory';

export class NodeDirectory implements Directory {
  readonly name: string;

  constructor(private readonly root: string) {
    this.name = basename(root);
  }

  async exists(path: string): Promise<boolean> {
    return stat(this.full(path)).then(() => true, () => false);
  }

  async readBytes(path: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await readFile(this.full(path)));
    } catch {
      throw new FileNotFoundError(path);
    }
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    const file = this.full(path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  async list(dir: string): Promise<string[]> {
    const entries = await readdir(dir ? this.full(dir) : this.root, { withFileTypes: true }).catch(() => []);
    return entries.filter(e => e.isFile()).map(e => e.name);
  }

  async remove(path: string): Promise<void> {
    await rm(this.full(path), { force: true });
  }

  private full(path: string): string {
    const { dirs, file } = splitPath(path);
    return join(this.root, ...dirs, file);
  }
}
