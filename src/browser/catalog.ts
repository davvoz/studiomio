/* The browser's sources, in order: the fixed ones (the app's categories and places) and the folders
 * the user adds, which are remembered from one start to the next. */
import { Emitter, type Unsubscribe } from '../core/emitter';
import type { DeviceType } from '../devices/device-type';
import type { RackPreset } from '../model/rack-preset';
import type { BrowserSource } from './item';
import { deviceSource, kitSource, userPresetsSource, type UserPresetList, type UserRackList } from './device-sources';
import { folderSource, projectSamplesSource, type FolderReader, type SampleProvider } from './sample-sources';

/** Who keeps the added folders (IndexedDB in the app, a list in tests). */
export interface FolderPlaces<F extends FolderReader> {
  load(): Promise<F[]>;
  save(folders: readonly F[]): Promise<void>;
}

export interface StandardSources {
  readonly instruments: readonly DeviceType[];
  readonly effects: readonly DeviceType[];
  readonly user: UserPresetList;
  readonly racks?: UserRackList;
  /** The factory racks (Tornado…). */
  readonly factoryRacks?: readonly RackPreset[];
  readonly project: SampleProvider;
}

/** The app's sources, as in Live but only with what exists: Instruments, Drums (the Drum
 *  Machine kits), Audio Effects; then the places Current Project and User Presets. */
export function standardSources({ instruments, effects, user, racks, factoryRacks, project }: StandardSources): BrowserSource[] {
  const drums = instruments.filter(t => t.kit);
  return [
    deviceSource({ id: 'instruments', label: 'Instruments', kind: 'instrument', types: instruments, user, racks, factoryRacks }),
    ...(drums.length ? [kitSource('drums', 'Drums', drums, user)] : []),
    deviceSource({ id: 'effects', label: 'Audio effects', kind: 'effect', types: effects, user, racks, factoryRacks }),
    projectSamplesSource(project),
    userPresetsSource(instruments, effects, user, racks),
  ];
}

interface Place<F> {
  readonly folder: F;
  readonly source: BrowserSource;
}

/** All the browser's sources; `change` when a folder is added or removed. */
export class BrowserCatalog<F extends FolderReader = FolderReader> {
  private places: Place<F>[] = [];
  private next = 1;
  private readonly events = new Emitter<{ change: [] }>();

  constructor(private readonly fixed: readonly BrowserSource[], private readonly store: FolderPlaces<F> | null = null) {}

  get sources(): readonly BrowserSource[] {
    return [...this.fixed, ...this.places.map(p => p.source)];
  }

  source(id: string): BrowserSource | undefined {
    return this.sources.find(s => s.id === id);
  }

  onChange(fn: () => void): Unsubscribe {
    return this.events.on('change', fn);
  }

  /** Rereads the folders added in previous starts. */
  async restore(): Promise<void> {
    if (!this.store) return;
    this.places = (await this.store.load()).map(f => this.place(f));
    this.events.emit('change');
  }

  /** Adds a folder (if it's already there, the same one); returns its source. */
  async addFolder(folder: F, same: (a: F, b: F) => Promise<boolean> = async (a, b) => a === b): Promise<BrowserSource> {
    for (const p of this.places) if (await same(p.folder, folder)) return p.source;
    const place = this.place(folder);
    this.places = [...this.places, place];
    await this.store?.save(this.places.map(p => p.folder));
    this.events.emit('change');
    return place.source;
  }

  /** Removes a folder from the browser (nothing changes on disk). */
  async removeFolder(id: string): Promise<void> {
    const places = this.places.filter(p => p.source.id !== id);
    if (places.length === this.places.length) return;
    this.places = places;
    await this.store?.save(this.places.map(p => p.folder));
    this.events.emit('change');
  }

  private place(folder: F): Place<F> {
    return { folder, source: folderSource(`folder${this.next++}`, folder) };
  }
}
