/* The racks saved by whoever uses the app, with their devices and macros. Like the user presets
 * they're not in the project: they apply to all projects. In the desktop app they're files, one per rack,
 * in Documents\studiomio\Rack (the main process writes them); in the browser they stay in
 * local storage. */
import { Emitter, type Unsubscribe } from '../core/emitter';
import { rackPresetFrom, type RackPreset } from '../model/rack-preset';
import { SAMPLER, upgradeZoneTune } from './instruments/sampler/sampler';
import type { PresetStorage } from './user-presets';

/** Who keeps the racks: the files (desktop app) or local storage (browser). */
export interface RackBackend {
  /** All the saved racks; what isn't a rack is skipped here. */
  load(): Promise<unknown[]>;
  /** Writes the rack (over the one with the same name). */
  save(rack: RackPreset): Promise<void>;
  remove(name: string): Promise<void>;
  /** Shows where they are (the folder in File Explorer), if possible. */
  reveal?(): Promise<void>;
}

const KEY = 'studiomio.racks';

/** The racks in local storage, all in one entry: [rack, …]. */
export class StorageRacks implements RackBackend {
  constructor(private readonly storage: PresetStorage) {}

  async load(): Promise<unknown[]> {
    try {
      const raw: unknown = JSON.parse(this.storage.getItem(KEY) ?? '[]');
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  async save(rack: RackPreset): Promise<void> {
    this.write([...(await this.all()).filter(r => r.name !== rack.name), rack]);
  }

  async remove(name: string): Promise<void> {
    this.write((await this.all()).filter(r => r.name !== name));
  }

  private async all(): Promise<RackPreset[]> {
    return (await this.load()).flatMap(r => readRack(r) ?? []);
  }

  private write(racks: readonly RackPreset[]): void {
    try {
      this.storage.setItem(KEY, JSON.stringify(racks));
    } catch {
      throw new Error('the app\'s local storage is full or blocked.');
    }
  }
}

export class UserRacks {
  private racks: RackPreset[] = [];
  private readonly events = new Emitter<{ change: [] }>();

  constructor(private readonly backend: RackBackend | null) {}

  /** The racks changed (read, saved, deleted): for whoever lists them, like the browser. */
  onChange(fn: () => void): Unsubscribe {
    return this.events.on('change', fn);
  }

  /** Opens the racks folder (desktop app only). */
  get canReveal(): boolean {
    return !!this.backend?.reveal;
  }

  /** Reads the saved racks (at startup). */
  async load(): Promise<void> {
    if (!this.backend) return;
    this.racks = [];
    for (const raw of await this.backend.load()) {
      const rack = readRack(raw);
      if (rack) this.put(rack);
    }
    this.events.emit('change');
  }

  /** The saved racks in name order. */
  list(): RackPreset[] {
    return [...this.racks];
  }

  find(name: string): RackPreset | undefined {
    return this.racks.find(r => r.name === name);
  }

  /** Saves (or replaces, if the name already exists) a rack. */
  async save(rack: RackPreset): Promise<void> {
    if (!this.backend) throw new Error('the app\'s local storage isn\'t available.');
    await this.backend.save(rack);
    this.put(rack);
    this.events.emit('change');
  }

  async remove(name: string): Promise<void> {
    if (!this.backend) return;
    await this.backend.remove(name);
    this.racks = this.racks.filter(r => r.name !== name);
    this.events.emit('change');
  }

  async reveal(): Promise<void> {
    await this.backend?.reveal?.();
  }

  private put(rack: RackPreset): void {
    this.racks = [...this.racks.filter(r => r.name !== rack.name), rack].sort((a, b) => a.name.localeCompare(b.name));
  }
}

const localStorageOrNull = (): PresetStorage | null => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

/** This app's user racks: the files in the desktop app, local storage in the browser. */
export const userRacks = ((): UserRacks => {
  const desktop = typeof window === 'undefined' ? undefined : window.studiomioDesktop?.racks;
  if (desktop) return new UserRacks(desktop);
  const storage = localStorageOrNull();
  return new UserRacks(storage ? new StorageRacks(storage) : null);
})();

/** A saved rack, with the instrument's parameters written by a past version brought to
 *  today's (the Sampler's zones up to 0.3.18). */
function readRack(raw: unknown): RackPreset | null {
  const rack = rackPresetFrom(raw);
  const inst = rack?.instrument;
  if (!rack || inst?.type !== SAMPLER.type) return rack;
  return { ...rack, instrument: { ...inst, params: upgradeZoneTune(inst.params) } };
}
