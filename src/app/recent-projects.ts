/* I progetti recenti, come "Apri recente" di Live: le cartelle aperte o salvate, la più recente
 * prima. Si ricordano in IndexedDB (un handle di cartella si può conservare lì), come le
 * cartelle del browser. */
import { loadHandles, saveHandles } from '../browser/fs-folder';

const KEY = 'recent-projects';
export const MAX_RECENT = 8;

export class RecentProjects {
  private handles: FileSystemDirectoryHandle[] = [];
  private readonly loaded: Promise<void>;

  /** `changed`: l'elenco è cambiato (per ridisegnare il menu). */
  constructor(private readonly changed: () => void = () => {}) {
    this.loaded = loadHandles(KEY).then(h => {
      this.handles = h;
      this.changed();
    });
  }

  /** Finché IndexedDB non ha risposto l'elenco è vuoto. */
  get list(): readonly FileSystemDirectoryHandle[] {
    return this.handles;
  }

  /** La cartella va in cima (se c'era già, si sposta). */
  async add(handle: FileSystemDirectoryHandle): Promise<void> {
    await this.loaded;
    const others = await this.without(handle);
    await this.store([handle, ...others].slice(0, MAX_RECENT));
  }

  /** Toglie una cartella che non si apre più (spostata, cancellata). */
  async remove(handle: FileSystemDirectoryHandle): Promise<void> {
    await this.loaded;
    await this.store(await this.without(handle));
  }

  async clear(): Promise<void> {
    await this.loaded;
    await this.store([]);
  }

  private async without(handle: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle[]> {
    const same = await Promise.all(this.handles.map(h => h.isSameEntry(handle).catch(() => false)));
    return this.handles.filter((_, i) => !same[i]);
  }

  private async store(handles: FileSystemDirectoryHandle[]): Promise<void> {
    this.handles = handles;
    this.changed();
    await saveHandles(KEY, handles);
  }
}
