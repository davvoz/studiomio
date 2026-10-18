// I preset dell'utente come file: uno per preset, in una cartella per dispositivo sotto
// Documenti\studiomio\Preset. Chi è il preset (tipo e nome) è scritto nel file, non nel suo
// nome: l'utente può spostare, rinominare o copiare i file, anche da un altro computer.
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

/** Tutti i preset nella cartella (e sotto); i file che non sono preset si saltano. */
export async function loadPresets(root: string): Promise<StoredPreset[]> {
  return (await scan(root)).map(({ type, name, params }) => ({ type, name, params }));
}

/** Scrive il preset: sopra il suo file se c'è già (stesso tipo e nome), se no in un file nuovo
 *  nella cartella `folder`. */
export async function savePreset(root: string, folder: string, preset: StoredPreset): Promise<void> {
  const existing = (await scan(root)).find(f => f.type === preset.type && f.name === preset.name);
  const path = existing?.path ?? await freePath(join(root, safeName(folder)), safeName(preset.name));
  const body = { studiomio: 'preset', version: 1, type: preset.type, name: preset.name, params: preset.params };
  // prima un file a parte, poi lo scambio: un'interruzione non lascia un preset a metà
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

/** Elimina i file del preset (tipo e nome). */
export async function removePreset(root: string, type: string, name: string): Promise<void> {
  for (const f of await scan(root)) {
    if (f.type === type && f.name === name) await rm(f.path, { force: true });
  }
}

/** Un nome valido come nome di file in Windows (e altrove). */
export function safeName(name: string): string {
  let s = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100).trim().replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s)) s = `_${s}`;
  return s || 'preset';
}

async function scan(root: string): Promise<PresetFile[]> {
  let entries: string[];
  try {
    entries = await readdir(root, { recursive: true });
  } catch {
    return []; // la cartella non c'è ancora
  }
  const files = await Promise.all(entries.filter(e => e.toLowerCase().endsWith('.json')).map(async (e): Promise<PresetFile | null> => {
    const path = join(root, e);
    try {
      return parse(JSON.parse(await readFile(path, 'utf8')), path);
    } catch {
      return null;
    }
  }));
  return files.filter((f): f is PresetFile => f !== null);
}

function parse(raw: unknown, path: string): PresetFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const { type, name, params } = raw as Record<string, unknown>;
  if (typeof type !== 'string' || !type || typeof name !== 'string' || !name || !params || typeof params !== 'object') return null;
  const values = Object.fromEntries(Object.entries(params).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)));
  return { type, name, params: values, path };
}

/** `dir\base.json`, o `base (2).json`… se c'è già un file con quel nome. */
async function freePath(dir: string, base: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  for (let n = 1; ; n++) {
    const path = resolve(dir, n === 1 ? `${base}.json` : `${base} (${n}).json`);
    if (!path.startsWith(resolve(dir) + sep)) throw new Error('nome del preset non valido');
    if (!existsSync(path)) return path;
  }
}
