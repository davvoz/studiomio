// The user's presets as files: one per preset, in a folder per device under
// Documents\studiomio\Preset. Who the preset is (type and name) is written in the file, not in its
// name: the user can move, rename or copy the files, even from another computer.
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export interface StoredPreset {
  readonly type: string;
  readonly name: string;
  readonly params: Readonly<Record<string, number>>;
}

interface PresetFile extends StoredPreset {
  readonly path: string;
}

/** All the presets in the folder (and below); files that aren't presets are skipped. */
export async function loadPresets(root: string): Promise<StoredPreset[]> {
  return (await scan(root)).map(({ type, name, params }) => ({ type, name, params }));
}

/** Writes the preset: over its file if it already exists (same type and name), otherwise in a new file
 *  in the folder `folder`. */
export async function savePreset(root: string, folder: string, preset: StoredPreset): Promise<void> {
  const existing = (await scan(root)).find(f => f.type === preset.type && f.name === preset.name);
  const path = existing?.path ?? await freePath(join(root, safeName(folder)), safeName(preset.name));
  await writeJson(path, { studiomio: 'preset', version: 1, type: preset.type, name: preset.name, params: preset.params });
}

/** Writes a JSON file: first a separate file, then the swap, so an interruption doesn't leave
 *  a half-written file. */
export async function writeJson(path: string, body: unknown): Promise<void> {
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

/** Deletes the preset's files (type and name). */
export async function removePreset(root: string, type: string, name: string): Promise<void> {
  for (const f of await scan(root)) {
    if (f.type === type && f.name === name) await rm(f.path, { force: true });
  }
}

/** A name valid as a file name on Windows (and elsewhere). */
export function safeName(name: string): string {
  let s = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100).trim().replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s)) s = `_${s}`;
  return s || 'preset';
}

const scan = (root: string): Promise<PresetFile[]> => scanJson(root, parse);

/** The JSON files in the folder (and below) that `parse` recognizes; the others are skipped. */
export async function scanJson<T>(root: string, parse: (raw: unknown, path: string) => T | null): Promise<T[]> {
  let entries: string[];
  try {
    entries = await readdir(root, { recursive: true });
  } catch {
    return []; // the folder doesn't exist yet
  }
  const files = await Promise.all(entries.filter(e => e.toLowerCase().endsWith('.json')).map(async (e): Promise<T | null> => {
    const path = join(root, e);
    try {
      return parse(JSON.parse(await readFile(path, 'utf8')), path);
    } catch {
      return null;
    }
  }));
  return files.filter((f): f is Awaited<T> => f !== null) as T[];
}

function parse(raw: unknown, path: string): PresetFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const { type, name, params } = raw as Record<string, unknown>;
  if (typeof type !== 'string' || !type || typeof name !== 'string' || !name || !params || typeof params !== 'object') return null;
  const values = Object.fromEntries(Object.entries(params).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)));
  return { type, name, params: values, path };
}

/** `dir\base.json`, or `base (2).json`… if a file with that name already exists. */
export async function freePath(dir: string, base: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  for (let n = 1; ; n++) {
    const path = resolve(dir, n === 1 ? `${base}.json` : `${base} (${n}).json`);
    if (!path.startsWith(resolve(dir) + sep)) throw new Error('invalid file name');
    if (!existsSync(path)) return path;
  }
}
