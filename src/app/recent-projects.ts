/* Recent projects, like Live's "Open Recent": the folders opened or saved, most recent
 * first. They're remembered in IndexedDB (a folder handle can be kept there), like the
 * browser's folders. */
import { loadHandles, saveHandles } from '../browser/fs-folder';

const KEY = 'recent-projects';
export const MAX_RECENT = 8;

export class RecentProjects {
  private handles: FileSystemDirectoryHandle[] = [];
  private readonly loaded: Promise<void>;

  /** `changed`: the list changed (to redraw the menu). */
  constructor(private readonly changed: () => void = () => {}) {
    this.loaded = loadHandles(KEY).then(h => {
      this.handles = h;
      this.changed();
    });
  }

  /** Until IndexedDB has answered the list is empty. */
  get list(): readonly FileSystemDirectoryHandle[] {
    return this.handles;
  }

  /** The folder goes to the top (if it was already there, it moves). */
  async add(handle: FileSystemDirectoryHandle): Promise<void> {
    await this.loaded;
    const others = await this.without(handle);
    await this.store([handle, ...others].slice(0, MAX_RECENT));
  }

  /** Removes a folder that no longer opens (moved, deleted). */
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
