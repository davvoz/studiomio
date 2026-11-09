// The racks saved by the user as files: one per rack, under Documents\studiomio\Rack. As for
// presets, who the rack is (the name) is written in the file, not in its name: the user can move,
// rename or copy the files. The app checks the content when it reads them back.
import { rm } from 'node:fs/promises';
import { freePath, safeName, scanJson, writeJson } from './presets.js';

/** A rack as the app sends it: the name and the rest (devices and macros). */
export interface StoredRack {
  readonly name: string;
  readonly [field: string]: unknown;
}

interface RackFile {
  readonly rack: StoredRack;
  readonly path: string;
}

/** All the racks in the folder (and below); files that aren't racks are skipped. */
export async function loadRacks(root: string): Promise<StoredRack[]> {
  return (await scan(root)).map(f => f.rack);
}

/** Writes the rack: over its file if it already exists (same name), otherwise in a new file. */
export async function saveRack(root: string, rack: StoredRack): Promise<void> {
  const existing = (await scan(root)).find(f => f.rack.name === rack.name);
  const path = existing?.path ?? await freePath(root, safeName(rack.name));
  const { studiomio: _kind, version: _version, ...body } = rack;
  await writeJson(path, { studiomio: 'rack', version: 1, ...body });
}

/** Deletes the rack's files (by name). */
export async function removeRack(root: string, name: string): Promise<void> {
  for (const f of await scan(root)) {
    if (f.rack.name === name) await rm(f.path, { force: true });
  }
}

const scan = (root: string): Promise<RackFile[]> => scanJson(root, (raw, path) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { studiomio: kind, version: _version, ...rack } = raw as Record<string, unknown>;
  if (kind !== 'rack' || typeof rack.name !== 'string' || !rack.name) return null;
  return { rack: rack as StoredRack, path };
});
