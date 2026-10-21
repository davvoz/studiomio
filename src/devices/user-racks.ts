/* I rack salvati da chi usa l'app, con i loro dispositivi e le macro. Come i preset dell'utente
 * non sono nel progetto: valgono per tutti i progetti. Nell'app desktop sono file, uno per rack,
 * in Documenti\studiomio\Rack (li scrive il processo principale); nel browser restano nello
 * spazio locale. */
import { Emitter, type Unsubscribe } from '../core/emitter';
import { rackPresetFrom, type RackPreset } from '../model/rack-preset';
import { SAMPLER, upgradeZoneTune } from './instruments/sampler/sampler';
import type { PresetStorage } from './user-presets';

/** Chi conserva i rack: i file (app desktop) o lo spazio locale (browser). */
export interface RackBackend {
  /** Tutti i rack salvati; ciò che non è un rack si salta qui. */
  load(): Promise<unknown[]>;
  /** Scrive il rack (sopra quello con lo stesso nome). */
  save(rack: RackPreset): Promise<void>;
  remove(name: string): Promise<void>;
  /** Mostra dove sono (la cartella in Esplora file), se si può. */
  reveal?(): Promise<void>;
}

const KEY = 'studiomio.racks';

/** I rack nello spazio locale, tutti in una voce: [rack, …]. */
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
      throw new Error('lo spazio locale dell\'app è pieno o bloccato.');
    }
  }
}

export class UserRacks {
  private racks: RackPreset[] = [];
  private readonly events = new Emitter<{ change: [] }>();

  constructor(private readonly backend: RackBackend | null) {}

  /** I rack sono cambiati (letti, salvati, eliminati): per chi li elenca, come il browser. */
  onChange(fn: () => void): Unsubscribe {
    return this.events.on('change', fn);
  }

  /** Si apre la cartella dei rack (solo nell'app desktop). */
  get canReveal(): boolean {
    return !!this.backend?.reveal;
  }

  /** Legge i rack salvati (all'avvio). */
  async load(): Promise<void> {
    if (!this.backend) return;
    this.racks = [];
    for (const raw of await this.backend.load()) {
      const rack = readRack(raw);
      if (rack) this.put(rack);
    }
    this.events.emit('change');
  }

  /** I rack salvati in ordine di nome. */
  list(): RackPreset[] {
    return [...this.racks];
  }

  find(name: string): RackPreset | undefined {
    return this.racks.find(r => r.name === name);
  }

  /** Salva (o sostituisce, se il nome c'è già) un rack. */
  async save(rack: RackPreset): Promise<void> {
    if (!this.backend) throw new Error('lo spazio locale dell\'app non è disponibile.');
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

/** I rack dell'utente di questa app: i file nell'app desktop, lo spazio locale nel browser. */
export const userRacks = ((): UserRacks => {
  const desktop = typeof window === 'undefined' ? undefined : window.studiomioDesktop?.racks;
  if (desktop) return new UserRacks(desktop);
  const storage = localStorageOrNull();
  return new UserRacks(storage ? new StorageRacks(storage) : null);
})();

/** Un rack salvato, con i parametri dello strumento scritti da una versione passata portati a
 *  quelli di adesso (le zone del Sampler fino alla 0.3.18). */
function readRack(raw: unknown): RackPreset | null {
  const rack = rackPresetFrom(raw);
  const inst = rack?.instrument;
  if (!rack || inst?.type !== SAMPLER.type) return rack;
  return { ...rack, instrument: { ...inst, params: upgradeZoneTune(inst.params) } };
}
