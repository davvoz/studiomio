/* The project's files from the File menu and from Windows: new, open (also a recent one, a folder
 * Windows asks to open, a ZIP), save, import from another project, collect into a ZIP, the demo.
 * Before leaving a project with changes it asks whether to save them; a project with changes
 * never saved (the app hung) offers to recover them. The dialogs are given (`choose`). */
import type { Directory } from '../persistence/directory';
import { DesktopDirectory, desktopFolders } from '../persistence/desktop-directory';
import { FsAccessDirectory } from '../persistence/fs-access-directory';
import { ProjectFolder } from '../persistence/project-folder';
import type { Project } from '../model/project';
import type { ImportChoice } from '../model/project-import';
import type { DialogButton } from '../ui/dialog';
import type { ProjectSession } from './project-session';
import { recentName, type RecentProject, type RecentProjects } from './recent-projects';

/** The desktop app chooses the project folders by path (Windows can open them, they get the app's
 *  icon); the browser with File System Access. */
export function projectPicker(): () => Promise<Directory> {
  const folders = desktopFolders();
  return folders ? () => DesktopDirectory.pick(folders) : FsAccessDirectory.pick;
}

/** What the recent list remembers of a folder: the browser's handle or the desktop path. */
export function recentEntry(dir: Directory): RecentProject | null {
  if (dir instanceof FsAccessDirectory) return dir.root;
  if (dir instanceof DesktopDirectory) return dir.path;
  return null;
}

/** A recent folder to open, null if it's gone. A browser folder's permission is asked right away,
 *  while the click on the item still counts. */
export async function reopenRecent(entry: RecentProject): Promise<Directory | null> {
  if (typeof entry === 'string') {
    const folders = desktopFolders();
    return folders ? new DesktopDirectory(entry, folders) : null;
  }
  try {
    return await FsAccessDirectory.reopen(entry);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotFoundError') return null;
    throw e;
  }
}

type Choose = <T>(title: string, message: string, buttons: readonly DialogButton<T>[]) => Promise<T | null>;

export interface ProjectFilesDeps {
  readonly session: Pick<ProjectSession,
    'name' | 'changed' | 'newProject' | 'open' | 'save' | 'saveAs' | 'openArchive' | 'importFrom' | 'collectAndSave'
    | 'hasRecovery' | 'restoreRecovery' | 'discardRecovery' | 'forgetChanges'>;
  readonly recent: Pick<RecentProjects, 'remove'>;
  /** A dialog with buttons; null if closed without choosing. */
  readonly choose: Choose;
  /** The dialog choosing what to import from another project. */
  readonly chooseImport: (source: Project, folderName: string) => Promise<ImportChoice | null>;
  /** Folder of a recent project (null: it's gone), of a path Windows gives, whether it has a project. */
  readonly reopen: (entry: RecentProject) => Promise<Directory | null>;
  readonly pathFolder: (path: string) => Directory | null;
  readonly hasProject: (dir: Directory) => Promise<boolean>;
  /** Fills the empty project with the demo (it can't be undone). */
  readonly buildDemo: () => Promise<void>;
  /** Hands a file to the user (the browser's download). */
  readonly download: (file: Blob, name: string) => void;
  /** Runs an action, its errors in the status bar. */
  run(action: () => unknown): void;
  say(text: string): void;
}

/** The real folders, for the app. */
export const diskFolders = {
  reopen: reopenRecent,
  pathFolder: (path: string): Directory | null => {
    const folders = desktopFolders();
    return folders ? new DesktopDirectory(path, folders) : null;
  },
  hasProject: (dir: Directory): Promise<boolean> => new ProjectFolder(dir).hasProject(),
};

export class ProjectFiles {
  constructor(private readonly deps: ProjectFilesDeps) {}

  newProject(): void { this.deps.run(async () => { if (await this.closeProject()) this.deps.session.newProject(); }); }
  open(): void { this.deps.run(async () => { if (await this.closeProject()) await this.openFolder(); }); }
  save(): void { this.deps.run(() => this.deps.session.save()); }
  saveAs(): void { this.deps.run(() => this.deps.session.saveAs()); }

  /** Imports tracks, buses and the master's devices from another project folder. */
  importFromProject(): void { this.deps.run(() => this.deps.session.importFrom(this.deps.chooseImport)); }

  /** Collect and save: the project in a ZIP file to hand to another user. */
  collectAndSave(): void {
    this.deps.run(async () => {
      const file = await this.deps.session.collectAndSave();
      this.deps.download(file, file.name);
    });
  }

  /** Opens a recent project; if the folder is gone (moved, deleted) it leaves the list. */
  openRecent(entry: RecentProject): void {
    this.deps.run(async () => {
      const dir = await this.deps.reopen(entry);
      if (!dir || !(await this.deps.hasProject(dir))) {
        await this.deps.recent.remove(entry);
        return this.deps.say(`"${recentName(entry)}" is gone (moved or deleted?): removed from recent projects.`);
      }
      if (await this.closeProject()) await this.openFolder(dir);
    });
  }

  /** Opens the project in a disk folder chosen from Windows: a double click on its file or "Open in
   *  studiomio" on the folder (desktop app only). */
  openPath(path: string): void {
    const dir = this.deps.pathFolder(path);
    if (!dir) return;
    this.deps.run(async () => { if (await this.closeProject()) await this.openFolder(dir); });
  }

  openArchive(file: File): void {
    this.deps.run(async () => { if (await this.closeProject()) await this.deps.session.openArchive(file); });
  }

  /** A ZIP dropped on the window is a project to open, other files are audio to import. */
  dropFiles(files: readonly File[], importAudio: () => Promise<void>): void {
    const archive = files.find(f => /\.zip$/i.test(f.name));
    if (archive) this.openArchive(archive);
    else this.deps.run(importAudio);
  }

  loadDemo(): void {
    this.deps.run(async () => {
      if (!(await this.closeProject())) return;
      this.deps.session.newProject(true);
      await this.deps.buildDemo();
      this.deps.session.forgetChanges();
      this.deps.say('Demo project loaded: press Space to listen to it.');
    });
  }

  /** Opens a project folder; if there are changes never saved (the app hung or was closed
   *  without saving) asks whether to recover them. */
  private async openFolder(dir?: Directory): Promise<void> {
    const { session } = this.deps;
    await session.open(dir);
    if (!(await session.hasRecovery())) return;
    const answer = await this.deps.choose('Recover unsaved changes?',
      `"${session.name}" has changes that weren't saved: the app hung or was closed without saving. Do you want to recover them?`, [
        { label: 'Discard them', value: 'discard' },
        { label: 'Restore them', value: 'restore', primary: true },
      ]);
    if (answer === 'restore') await session.restoreRecovery();
    else if (answer === 'discard') await session.discardRecovery();
  }

  /** Before leaving the project (new, open, demo): if there are changes asks whether to save them.
   *  false: give up (also if saving doesn't succeed). */
  private async closeProject(): Promise<boolean> {
    const { session } = this.deps;
    if (!session.changed) return true;
    const answer = await this.deps.choose('Save changes?', `If you don't save them, the changes to "${session.name}" will be lost.`, [
      { label: 'Don\'t save', value: 'discard' },
      { label: 'Undo', value: 'cancel' },
      { label: 'Save', value: 'save', primary: true },
    ]);
    if (answer === 'save') await session.save(); // if choosing the folder is cancelled, it stops here
    if (answer === 'discard') await session.discardRecovery();
    return answer === 'save' || answer === 'discard';
  }
}
