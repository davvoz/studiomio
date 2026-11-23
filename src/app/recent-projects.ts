/* Recent projects, like Live's "Open Recent": the folders opened or saved, most recent
 * first. They're remembered in IndexedDB, like the browser's folders: a folder handle (browser)
 * or the folder's path (desktop app) can be kept there. */
import { loadHandles, saveHandles } from '../browser/fs-folder';

const KEY = 'recent-projects';
export const MAX_RECENT = 8;

/** A remembered project folder: a browser handle, or the path on disk in the desktop app. */
export type RecentProject = FileSystemDirectoryHandle | string;

/** The folder's name, for the menu. */
export const recentName = (r: RecentProject): string =>
  (typeof r === 'string' ? r.split(/[\\/]/).findLast(Boolean) ?? r : r.name);

/** Two paths are the same folder whatever the case and the separators (Windows). */
const samePath = (a: string, b: string): boolean => folderKey(a) === folderKey(b);

/** The path without its final separators, with "/" and in lower case. */
function folderKey(path: string): string {
  let end = path.length;
  while (end > 0 && (path[end - 1] === '/' || path[end - 1] === '\\')) end--;
  return path.slice(0, end).replaceAll('\\', '/').toLowerCase();
}

async function same(a: RecentProject, b: RecentProject): Promise<boolean> {
  if (typeof a === 'string' || typeof b === 'string') return typeof a === typeof b && samePath(a as string, b as string);
  return a.isSameEntry(b).catch(() => false);
}

export class RecentProjects {
  private entries: RecentProject[] = [];
  private loaded: Promise<void> | null = null;

  /** `changed`: the list changed (to redraw the menu). */
  constructor(private readonly changed: () => void = () => {}) {}

  /** Reads the list from IndexedDB, once: the later calls wait for the same reading (the changes
   *  wait for it too). The app calls it at startup. */
  load(): Promise<void> {
    this.loaded ??= loadHandles<RecentProject>(KEY).then(h => {
      this.entries = h;
      this.changed();
    });
    return this.loaded;
  }

  /** Until IndexedDB has answered the list is empty. */
  get list(): readonly RecentProject[] {
    return this.entries;
  }

  /** The folder goes to the top (if it was already there, it moves). */
  async add(entry: RecentProject): Promise<void> {
    await this.load();
    const others = await this.without(entry);
    await this.store([entry, ...others].slice(0, MAX_RECENT));
  }

  /** Removes a folder that no longer opens (moved, deleted). */
  async remove(entry: RecentProject): Promise<void> {
    await this.load();
    await this.store(await this.without(entry));
  }

  async clear(): Promise<void> {
    await this.load();
    await this.store([]);
  }

  private async without(entry: RecentProject): Promise<RecentProject[]> {
    const found = await Promise.all(this.entries.map(h => same(h, entry)));
    return this.entries.filter((_, i) => !found[i]);
  }

  private async store(entries: RecentProject[]): Promise<void> {
    this.entries = entries;
    this.changed();
    await saveHandles(KEY, entries);
  }
}
