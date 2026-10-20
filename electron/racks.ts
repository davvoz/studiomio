// I rack salvati dall'utente come file: uno per rack, sotto Documenti\studiomio\Rack. Come per i
// preset, chi è il rack (il nome) è scritto nel file, non nel suo nome: l'utente può spostare,
// rinominare o copiare i file. Il contenuto lo controlla l'app quando li rilegge.
import { rm } from 'node:fs/promises';
import { freePath, safeName, scanJson, writeJson } from './presets.js';

/** Un rack come lo manda l'app: il nome e il resto (dispositivi e macro). */
export interface StoredRack {
  readonly name: string;
  readonly [field: string]: unknown;
}

interface RackFile {
  readonly rack: StoredRack;
  readonly path: string;
}

/** Tutti i rack nella cartella (e sotto); i file che non sono rack si saltano. */
export async function loadRacks(root: string): Promise<StoredRack[]> {
  return (await scan(root)).map(f => f.rack);
}

/** Scrive il rack: sopra il suo file se c'è già (stesso nome), se no in un file nuovo. */
export async function saveRack(root: string, rack: StoredRack): Promise<void> {
  const existing = (await scan(root)).find(f => f.rack.name === rack.name);
  const path = existing?.path ?? await freePath(root, safeName(rack.name));
  const { studiomio: _kind, version: _version, ...body } = rack;
  await writeJson(path, { studiomio: 'rack', version: 1, ...body });
}

/** Elimina i file del rack (per nome). */
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
