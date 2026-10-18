/* I preset salvati da chi usa l'app, per tipo di dispositivo. Non sono nel progetto: valgono
 * per tutti i progetti, come quelli di fabbrica. Nell'app desktop sono file, uno per preset, in
 * Documenti\studiomio\Preset (li scrive il processo principale); nel browser restano nello
 * spazio locale. Si salvano solo i parametri: i sample caricati (es. i pad della Drum Machine)
 * sono file del progetto. */
import type { ParamValues } from '../model/device';
import { paramsOf, resolveParams, type DeviceType, type Preset } from './device-type';
import { effectType, instrumentType } from './registry';

/** Un preset con il suo tipo di dispositivo, come lo scrive e lo rilegge chi lo conserva. */
export interface StoredPreset extends Preset {
  readonly type: string;
}

/** Chi conserva i preset: i file (app desktop) o lo spazio locale (browser). */
export interface PresetBackend {
  /** Tutti i preset salvati; ciò che non è un preset si salta qui. */
  load(): Promise<unknown[]>;
  /** Scrive il preset (sopra quello con lo stesso tipo e nome); `folder` è la cartella dove
   *  metterlo se è nuovo (il nome del dispositivo). */
  save(folder: string, preset: StoredPreset): Promise<void>;
  remove(type: string, name: string): Promise<void>;
  /** Mostra dove sono (la cartella in Esplora file), se si può. */
  reveal?(): Promise<void>;
}

/** Lo spazio locale del browser: localStorage nell'app, una mappa nei test. */
export interface PresetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

declare global {
  interface Window {
    /** Dal preload di Electron (electron/preload.cts); assente nel browser. */
    readonly studiomioDesktop?: { readonly presets: Required<PresetBackend> };
  }
}

const KEY = 'studiomio.presets';

/** I valori da salvare: solo quelli diversi dai predefiniti, come nei preset di fabbrica. */
export function presetParams(t: DeviceType, values: ParamValues): ParamValues {
  const all = resolveParams(t, values);
  return Object.fromEntries(paramsOf(t).filter(p => all[p.id] !== p.default).map(p => [p.id, all[p.id]]));
}

/** Un preset da dati letti da fuori (file, spazio locale), o null se non lo è. */
export function storedPreset(raw: unknown): StoredPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const { type, name, params } = raw as Record<string, unknown>;
  if (typeof type !== 'string' || !type || typeof name !== 'string' || !name || !params || typeof params !== 'object') return null;
  const values = Object.fromEntries(Object.entries(params).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)));
  return { type, name, params: values };
}

/** I preset nello spazio locale, tutti in una voce: { tipo: [{ name, params }] }. */
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
      throw new Error('lo spazio locale dell\'app è pieno o bloccato.');
    }
  }
}

export class UserPresets {
  private presets = new Map<string, Preset[]>();

  /** `backend` conserva i preset; `folderOf` dà la cartella di un preset nuovo dal suo tipo. */
  constructor(
    private readonly backend: PresetBackend | null,
    private readonly folderOf: (type: string) => string = type => type,
  ) {}

  /** Si apre la cartella dei preset (solo nell'app desktop). */
  get canReveal(): boolean {
    return !!this.backend?.reveal;
  }

  /** Legge i preset salvati (all'avvio, prima di mostrare i dispositivi). */
  async load(): Promise<void> {
    if (!this.backend) return;
    this.presets = new Map();
    for (const p of await this.backend.load()) {
      const preset = storedPreset(p);
      if (preset) this.put(preset);
    }
  }

  /** I preset salvati per il tipo, in ordine di nome. */
  list(type: string): Preset[] {
    return [...(this.presets.get(type) ?? [])];
  }

  find(type: string, name: string): Preset | undefined {
    return this.presets.get(type)?.find(p => p.name === name);
  }

  /** Salva (o sostituisce, se il nome c'è già) un preset per il tipo. */
  async save(type: string, preset: Preset): Promise<void> {
    if (!this.backend) throw new Error('lo spazio locale dell\'app non è disponibile.');
    const stored: StoredPreset = { type, name: preset.name, params: { ...preset.params } };
    await this.backend.save(this.folderOf(type), stored);
    this.put(stored);
  }

  async remove(type: string, name: string): Promise<void> {
    if (!this.backend) return;
    await this.backend.remove(type, name);
    const list = (this.presets.get(type) ?? []).filter(p => p.name !== name);
    if (list.length) this.presets.set(type, list);
    else this.presets.delete(type);
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

/** I preset dell'utente di questa app: i file nell'app desktop, lo spazio locale nel browser. */
export const userPresets = ((): UserPresets => {
  const desktop = typeof window === 'undefined' ? undefined : window.studiomioDesktop?.presets;
  if (desktop) return new UserPresets(desktop, type => (instrumentType(type) ?? effectType(type))?.label ?? type);
  const storage = localStorageOrNull();
  return new UserPresets(storage ? new StoragePresets(storage) : null);
})();
