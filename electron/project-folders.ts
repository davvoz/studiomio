// The project folders on disk, by path, for the app (src/persistence/desktop-directory.ts): read
// and write their files, recognize the project Windows asks to open (double click on a
// .studiomio file, or "Open in studiomio" on a folder) and give the folder the app's icon.
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

/** The extension of the project file (progetto.studiomio): Windows opens it with studiomio. */
export const PROJECT_EXTENSION = '.studiomio';
/** The icon copied into each project folder (hidden), so the folder keeps it when moved or sent. */
export const FOLDER_ICON = 'studiomio.ico';
const DESKTOP_INI = 'desktop.ini';

const run = promisify(execFile);

/** The absolute path of `path` (relative, with "/") inside `root`: no "..", no absolute paths. */
export function inside(root: string, path: string): string {
  if (!isAbsolute(root)) throw new Error(`not an absolute folder: "${root}"`);
  const parts = path.split('/').filter(p => p !== '' && p !== '.');
  if (path.startsWith('/') || parts.some(p => p === '..' || /[\\:]/.test(p))) throw new Error(`invalid path: "${path}"`);
  return join(root, ...parts);
}

const isMissing = (e: unknown) => (e as NodeJS.ErrnoException | null)?.code === 'ENOENT';

export function exists(root: string, path: string): Promise<boolean> {
  return stat(inside(root, path)).then(() => true, () => false);
}

/** null: the file isn't there. */
export async function read(root: string, path: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(inside(root, path)));
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

export async function write(root: string, path: string, data: Uint8Array): Promise<void> {
  const file = inside(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, data);
}

/** The names of the files (not the folders) in `dir` ('' the folder itself); none if it isn't there. */
export async function list(root: string, dir: string): Promise<string[]> {
  const entries = await readdir(dir ? inside(root, dir) : root, { withFileTypes: true }).catch(e => {
    if (isMissing(e)) return [];
    throw e;
  });
  return entries.filter(e => e.isFile()).map(e => e.name);
}

export async function remove(root: string, path: string): Promise<void> {
  await rm(inside(root, path), { force: true });
}

/** The project folder a launch argument points to: the folder of a project file, or the folder
 *  itself ("Open in studiomio" on it: whether it holds a project the app says when opening it).
 *  The options (-…) and what doesn't exist are skipped; null if there's none. */
export async function projectFolderIn(args: readonly string[]): Promise<string | null> {
  const paths = args.filter(arg => !arg.startsWith('-'));
  const infos = await Promise.all(paths.map(arg => stat(arg).catch(() => null)));
  for (const [i, arg] of paths.entries()) {
    const info = infos[i];
    if (info?.isFile() && extname(arg).toLowerCase() === PROJECT_EXTENSION) return dirname(resolve(arg));
    if (info?.isDirectory()) return resolve(arg);
  }
  return null;
}

/** Gives the folder the app's icon, as Windows wants it: a hidden desktop.ini pointing to the icon
 *  copied (hidden) into the folder, and the folder marked read-only (for folders it only means "it
 *  has a desktop.ini"). A folder that already has a desktop.ini (its own, or ours) isn't touched.
 *  Only on Windows. */
export async function markProjectFolder(root: string, icon: string): Promise<void> {
  if (process.platform !== 'win32' || await exists(root, DESKTOP_INI)) return;
  await copyFile(icon, inside(root, FOLDER_ICON));
  await writeFile(inside(root, DESKTOP_INI), `[.ShellClassInfo]\r\nIconResource=${FOLDER_ICON},0\r\nInfoTip=studiomio project\r\n`);
  await run('attrib', ['+h', '+s', inside(root, DESKTOP_INI)]);
  await run('attrib', ['+h', inside(root, FOLDER_ICON)]);
  await run('attrib', ['+r', root]);
}
