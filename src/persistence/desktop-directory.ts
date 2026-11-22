/* A folder on disk in the desktop app, by its path: Electron's main process reads and writes it
 * (electron/project-folders.ts). Unlike the browser's folders (File System Access) the path is known,
 * so a project can be opened from Windows (double click on its file) and its folder gets the
 * app's icon. */
import { FileNotFoundError, splitPath, type Directory } from './directory';

/** What the main process does on the disk folders: `root` an absolute folder, `path` relative
 *  to it with "/". */
export interface DesktopFolders {
  /** Asks the user to choose (or create) a folder; null if they give up. */
  pick(): Promise<string | null>;
  exists(root: string, path: string): Promise<boolean>;
  /** null: the file isn't there. */
  read(root: string, path: string): Promise<Uint8Array | null>;
  write(root: string, path: string, data: Uint8Array): Promise<void>;
  list(root: string, dir: string): Promise<string[]>;
  remove(root: string, path: string): Promise<void>;
  /** The app's icon on the folder (Windows); a failure is only logged. */
  markProject(root: string): Promise<void>;
  /** The project folder the app was launched with (double click on a project), only the first
   *  time it's asked; null if none. */
  launched(): Promise<string | null>;
  /** A project folder to open, chosen from Windows while the app is already open. */
  onOpen(fn: (folder: string) => void): void;
}

declare global {
  interface StudiomioDesktop {
    readonly folders: DesktopFolders;
  }
}

/** The desktop app's folders; undefined in the browser. */
export const desktopFolders = (): DesktopFolders | undefined =>
  (typeof window === 'undefined' ? undefined : window.studiomioDesktop?.folders);

/** The path is checked here too, before asking the main process: no "..", no absolute paths. */
const checked = (path: string): string => {
  splitPath(path);
  return path;
};

export class DesktopDirectory implements Directory {
  constructor(readonly path: string, private readonly folders: DesktopFolders) {}

  /** Asks the user to choose (or create) the project folder; giving up is an AbortError, as for
   *  the browser's picker. */
  static async pick(folders: DesktopFolders): Promise<DesktopDirectory> {
    const path = await folders.pick();
    if (!path) throw new DOMException('no folder chosen', 'AbortError');
    return new DesktopDirectory(path, folders);
  }

  /** The folder's name: the last part of the path. */
  get name(): string {
    return this.path.split(/[\\/]/).filter(Boolean).pop() ?? this.path;
  }

  async exists(path: string): Promise<boolean> {
    return this.folders.exists(this.path, checked(path));
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const data = await this.folders.read(this.path, checked(path));
    if (!data) throw new FileNotFoundError(path);
    return data;
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    return this.folders.write(this.path, checked(path), data);
  }

  async list(dir: string): Promise<string[]> {
    return this.folders.list(this.path, dir ? checked(dir) : '');
  }

  async remove(path: string): Promise<void> {
    return this.folders.remove(this.path, checked(path));
  }

  async markProject(): Promise<void> {
    return this.folders.markProject(this.path);
  }
}
