/* Le fonti del browser, in ordine: quelle fisse (categorie e luoghi dell'app) e le cartelle che
 * l'utente aggiunge, che si ricordano tra un avvio e l'altro. */
import { Emitter, type Unsubscribe } from '../core/emitter';
import type { DeviceType } from '../devices/device-type';
import type { RackPreset } from '../model/rack-preset';
import type { BrowserSource } from './item';
import { deviceSource, kitSource, userPresetsSource, type UserPresetList, type UserRackList } from './device-sources';
import { folderSource, projectSamplesSource, type FolderReader, type SampleProvider } from './sample-sources';

/** Chi conserva le cartelle aggiunte (IndexedDB nell'app, una lista nei test). */
export interface FolderPlaces<F extends FolderReader> {
  load(): Promise<F[]>;
  save(folders: readonly F[]): Promise<void>;
}

export interface StandardSources {
  readonly instruments: readonly DeviceType[];
  readonly effects: readonly DeviceType[];
  readonly user: UserPresetList;
  readonly racks?: UserRackList;
  /** I rack di fabbrica (Tornado…). */
  readonly factoryRacks?: readonly RackPreset[];
  readonly project: SampleProvider;
}

/** Le fonti dell'app, come in Live ma solo con ciò che c'è: Strumenti, Batterie (i kit della
 *  Drum Machine), Effetti audio; poi i luoghi Progetto corrente e Preset dell'utente. */
export function standardSources({ instruments, effects, user, racks, factoryRacks, project }: StandardSources): BrowserSource[] {
  const drums = instruments.filter(t => t.kit);
  return [
    deviceSource({ id: 'instruments', label: 'Strumenti', kind: 'instrument', types: instruments, user, racks, factoryRacks }),
    ...(drums.length ? [kitSource('drums', 'Batterie', drums, user)] : []),
    deviceSource({ id: 'effects', label: 'Effetti audio', kind: 'effect', types: effects, user, racks, factoryRacks }),
    projectSamplesSource(project),
    userPresetsSource(instruments, effects, user, racks),
  ];
}

interface Place<F> {
  readonly folder: F;
  readonly source: BrowserSource;
}

/** Tutte le fonti del browser; `change` quando si aggiunge o si toglie una cartella. */
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

  /** Rilegge le cartelle aggiunte negli avvii precedenti. */
  async restore(): Promise<void> {
    if (!this.store) return;
    this.places = (await this.store.load()).map(f => this.place(f));
    this.events.emit('change');
  }

  /** Aggiunge una cartella (se c'è già, la stessa); restituisce la sua fonte. */
  async addFolder(folder: F, same: (a: F, b: F) => Promise<boolean> = async (a, b) => a === b): Promise<BrowserSource> {
    for (const p of this.places) if (await same(p.folder, folder)) return p.source;
    const place = this.place(folder);
    this.places = [...this.places, place];
    await this.store?.save(this.places.map(p => p.folder));
    this.events.emit('change');
    return place.source;
  }

  /** Toglie una cartella dal browser (sul disco non cambia niente). */
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
