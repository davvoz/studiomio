/* The presets saved by whoever uses the app, by device type. They're not in the project: they apply
 * to all projects, like the factory ones. In the desktop app they're files, one per preset, in
 * Documents\studiomio\Preset (the main process writes them); in the browser they stay in
 * local storage. Only the parameters are saved: the loaded samples (e.g. the Drum Machine's pads)
 * are project files. */
import { Emitter, type Unsubscribe } from '../core/emitter';
import type { ParamValues } from '../model/device';
import { paramsOf, resolveParams, type DeviceType, type Preset } from './device-type';
import { effectType, instrumentType } from './registry';
import type { RackBackend } from './user-racks';

/** A preset with its device type, as whoever keeps it writes and reads it back. */
export interface StoredPreset extends Preset {
  readonly type: string;
}

/** Who keeps the presets: the files (desktop app) or local storage (browser). */
export interface PresetBackend {
  /** All the saved presets; what isn't a preset is skipped here. */
  load(): Promise<unknown[]>;
  /** Writes the preset (over the one with the same type and name); `folder` is the folder to
   *  put it in if it's new (the device's name). */
  save(folder: string, preset: StoredPreset): Promise<void>;
  remove(type: string, name: string): Promise<void>;
  /** Shows where they are (the folder in File Explorer), if possible. */
  reveal?(): Promise<void>;
}

/** The browser's local storage: localStorage in the app, a map in tests. */
export interface PresetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

declare global {
  interface Window {
    /** From Electron's preload (electron/preload.cts); absent in the browser. */
    readonly studiomioDesktop?: { readonly presets: Required<PresetBackend>; readonly racks: Required<RackBackend> };
  }
}

const KEY = 'studiomio.presets';

/** The values to save: only those different from the defaults, as in the factory presets. */
export function presetParams(t: DeviceType, values: ParamValues): ParamValues {
  const all = resolveParams(t, values);
  // what a preset doesn't change (the Sampler's zone map) doesn't go in
  return Object.fromEntries(paramsOf(t).filter(p => all[p.id] !== p.default && !t.keepsOnPreset?.(p.id)).map(p => [p.id, all[p.id]]));
}

/** A preset from data read from outside (file, local storage), or null if it isn't one. */
export function storedPreset(raw: unknown): StoredPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const { type, name, params } = raw as Record<string, unknown>;
  if (typeof type !== 'string' || !type || typeof name !== 'string' || !name || !params || typeof params !== 'object') return null;
  const values = Object.fromEntries(Object.entries(params).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)));
  return { type, name, params: values };
}

/** The presets in local storage, all in one entry: { type: [{ name, params }] }. */
export class StoragePresets implements PresetBackend {
  constructor(private readonly storage: PresetStorage) {}

  async load(): Promise<unknown[]> {
    let raw: unknown;
    try {
      raw = JSON.parse(this.storage.getItem(KEY) ?? '{}');
    } catch {
      return [];
    }
    if (!raw || typeof raw !== 'object') return [];
    return Object.entries(raw).flatMap(([type, list]) => (Array.isArray(list) ? list.map(p => ({ ...p, type })) : []));
  }

  async save(_folder: string, preset: StoredPreset): Promise<void> {
    const all = await this.all();
    this.write([...all.filter(p => p.type !== preset.type || p.name !== preset.name), preset]);
  }

  async remove(type: string, name: string): Promise<void> {
    this.write((await this.all()).filter(p => p.type !== type || p.name !== name));
  }

  private async all(): Promise<StoredPreset[]> {
    return (await this.load()).flatMap(p => storedPreset(p) ?? []);
  }

  private write(presets: readonly StoredPreset[]): void {
    const all: Record<string, Preset[]> = {};
    for (const { type, name, params } of presets) (all[type] ??= []).push({ name, params });
    try {
      this.storage.setItem(KEY, JSON.stringify(all));
    } catch {
      throw new Error('the app\'s local storage is full or blocked.');
    }
  }
}

export class UserPresets {
  private presets = new Map<string, Preset[]>();
  private readonly events = new Emitter<{ change: [] }>();

  /** `backend` keeps the presets; `folderOf` gives the folder of a new preset from its type. */
  constructor(
    private readonly backend: PresetBackend | null,
    private readonly folderOf: (type: string) => string = type => type,
  ) {}

  /** The presets changed (read, saved, deleted): for whoever lists them, like the browser. */
  onChange(fn: () => void): Unsubscribe {
    return this.events.on('change', fn);
  }

  /** Opens the presets folder (desktop app only). */
  get canReveal(): boolean {
    return !!this.backend?.reveal;
  }

  /** Reads the saved presets (at startup, before showing the devices). */
  async load(): Promise<void> {
    if (!this.backend) return;
    this.presets = new Map();
    for (const p of await this.backend.load()) {
      const preset = storedPreset(p);
      if (preset) this.put(preset);
    }
    this.events.emit('change');
  }

  /** The saved presets for the type, in name order. */
  list(type: string): Preset[] {
    return [...(this.presets.get(type) ?? [])];
  }

  find(type: string, name: string): Preset | undefined {
    return this.presets.get(type)?.find(p => p.name === name);
  }

  /** Saves (or replaces, if the name already exists) a preset for the type. */
  async save(type: string, preset: Preset): Promise<void> {
    if (!this.backend) throw new Error('the app\'s local storage isn\'t available.');
    const stored: StoredPreset = { type, name: preset.name, params: { ...preset.params } };
    await this.backend.save(this.folderOf(type), stored);
    this.put(stored);
    this.events.emit('change');
  }

  async remove(type: string, name: string): Promise<void> {
    if (!this.backend) return;
    await this.backend.remove(type, name);
    const list = (this.presets.get(type) ?? []).filter(p => p.name !== name);
    if (list.length) this.presets.set(type, list);
    else this.presets.delete(type);
    this.events.emit('change');
  }

  async reveal(): Promise<void> {
    await this.backend?.reveal?.();
  }

  private put({ type, name, params }: StoredPreset): void {
    const list = (this.presets.get(type) ?? []).filter(p => p.name !== name);
    list.push({ name, params });
    list.sort((a, b) => a.name.localeCompare(b.name));
    this.presets.set(type, list);
  }
}

const localStorageOrNull = (): PresetStorage | null => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

/** This app's user presets: the files in the desktop app, local storage in the browser. */
export const userPresets = ((): UserPresets => {
  const desktop = typeof window === 'undefined' ? undefined : window.studiomioDesktop?.presets;
  if (desktop) return new UserPresets(desktop, type => (instrumentType(type) ?? effectType(type))?.label ?? type);
  const storage = localStorageOrNull();
  return new UserPresets(storage ? new StoragePresets(storage) : null);
})();
