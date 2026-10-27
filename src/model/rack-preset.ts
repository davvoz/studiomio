/* Un rack salvato, da usare in altri progetti (come i preset dei rack di Live): i suoi
 * dispositivi con i parametri e le 8 macro con le mappature. Non conosce il progetto da cui
 * viene: una mappatura indica il dispositivo per posto nel rack (0 il primo), non per id. Non ci
 * sono i sample caricati (sono file del progetto) né il sidechain (è una traccia del progetto).
 * Qui ci sono i dati, come si prendono da una catena e come si rileggono da fuori. */
import type { DeviceId } from '../core/id';
import type { DeviceSettings, ParamValues } from './device';
import { INSTRUMENT_DEVICE } from './envelope';
import { MASTER, type ChainOwner, type Project } from './project';
import { findRack, MACRO_COUNT, MACRO_MODES, macroValueFor, springFor, type MacroMode, type MacroSpring } from './rack';
import { MidiTrack } from './track';

/** Un dispositivo del rack salvato: tipo, preset da cui era partito (da mostrare) e parametri. */
export interface SavedDevice {
  readonly type: string;
  readonly preset: string | null;
  readonly params: ParamValues;
}

export interface SavedEffect extends SavedDevice {
  readonly enabled: boolean;
}

export interface SavedMapping {
  /** Il posto del dispositivo nel rack: lo strumento, se c'è, è il primo. */
  readonly device: number;
  readonly param: string;
  readonly min: number;
  readonly max: number;
}

export interface SavedMacro {
  readonly name: string | null;
  readonly value: number;
  readonly mappings: readonly SavedMapping[];
  /** Assente: manopola. */
  readonly mode?: MacroMode;
  /** Solo delle molle. */
  readonly spring?: MacroSpring;
}

export interface RackPreset {
  readonly name: string;
  /** Lo strumento (Instrument Rack), o null (Audio Effect Rack). */
  readonly instrument: SavedDevice | null;
  /** Gli effetti nell'ordine della catena, dopo lo strumento. */
  readonly effects: readonly SavedEffect[];
  /** Sempre MACRO_COUNT. */
  readonly macros: readonly SavedMacro[];
}

/** Quanti dispositivi ha il rack salvato. */
export const rackPresetSize = (r: RackPreset): number => (r.instrument ? 1 : 0) + r.effects.length;

const saved = (s: DeviceSettings): SavedDevice => ({ type: s.type, preset: s.preset, params: { ...s.params } });

/** Il rack `id` della catena di `owner`, da salvare con il nome `name`. */
export function captureRack(p: Project, owner: ChainOwner, id: DeviceId, name: string): RackPreset {
  const rack = findRack(p.racksOf(owner), id);
  if (!rack) throw new RangeError(`rack ${id} non trovato`);
  const track = owner === MASTER ? undefined : p.track(owner);
  const effects = p.effectsOf(owner);
  const at = new Map(rack.devices.map((k, i) => [k, i]));
  return {
    name,
    instrument: rack.devices[0] === INSTRUMENT_DEVICE && track instanceof MidiTrack ? saved(track.instrument) : null,
    effects: rack.devices.filter(k => k !== INSTRUMENT_DEVICE).map(k => {
      const e = effects.find(x => x.id === k)!;
      return { ...saved(e), enabled: e.enabled };
    }),
    macros: rack.macros.map(m => ({
      name: m.name, value: m.value,
      mappings: m.mappings.map(x => ({ device: at.get(x.device)!, param: x.param, min: x.min, max: x.max })),
      ...(m.mode && m.mode !== 'knob' ? { mode: m.mode } : {}),
      ...(m.mode === 'spring' && m.spring ? { spring: { ...m.spring } } : {}),
    })),
  };
}

/** Un rack salvato da dati letti da fuori (file, spazio locale), o null se non lo è. Le
 *  mappature che non valgono si saltano; le macro mancanti sono vuote. */
export function rackPresetFrom(raw: unknown): RackPreset | null {
  if (!isObject(raw)) return null;
  const { name, instrument, effects, macros } = raw;
  if (typeof name !== 'string' || !name || !Array.isArray(effects)) return null;
  const inst = instrument === null || instrument === undefined ? null : savedDevice(instrument);
  if (inst === undefined) return null;
  const fx = effects.map(e => {
    const d = savedDevice(e);
    return d && { ...d, enabled: (e as Record<string, unknown>).enabled !== false };
  });
  if (fx.some(e => !e)) return null;
  const size = (inst ? 1 : 0) + fx.length;
  if (!size) return null;
  const list = Array.isArray(macros) ? macros : [];
  return {
    name, instrument: inst, effects: fx as SavedEffect[],
    macros: Array.from({ length: MACRO_COUNT }, (_, i) => savedMacro(list[i], size)),
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** undefined: non è un dispositivo. */
function savedDevice(raw: unknown): SavedDevice | undefined {
  if (!isObject(raw)) return undefined;
  const { type, preset, params } = raw;
  if (typeof type !== 'string' || !type || !isObject(params)) return undefined;
  return {
    type, preset: typeof preset === 'string' ? preset : null,
    params: Object.fromEntries(Object.entries(params).filter((x): x is [string, number] => finite(x[1]))),
  };
}

function savedMacro(raw: unknown, size: number): SavedMacro {
  if (!isObject(raw)) return { name: null, value: 0, mappings: [] };
  const mode = MACRO_MODES.find(([m]) => m === raw.mode)?.[0];
  const mappings = (Array.isArray(raw.mappings) ? raw.mappings : []).filter((x): x is SavedMapping => isObject(x)
    && Number.isInteger(x.device) && (x.device as number) >= 0 && (x.device as number) < size
    && typeof x.param === 'string' && !!x.param && finite(x.min) && finite(x.max));
  return {
    name: typeof raw.name === 'string' && raw.name ? raw.name : null,
    value: macroValueFor(mode ?? 'knob', finite(raw.value) ? raw.value : 0),
    mappings: mappings.map(({ device, param, min, max }) => ({ device, param, min, max })),
    ...(mode && mode !== 'knob' ? { mode } : {}),
    ...(mode === 'spring' && isObject(raw.spring) && finite(raw.spring.rest) && finite(raw.spring.time)
      ? { spring: springFor(raw.spring.rest, raw.spring.time, raw.spring.sync === true) } : {}),
  };
}
