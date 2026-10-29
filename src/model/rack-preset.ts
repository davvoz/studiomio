/* Un rack salvato, da usare in altri progetti (come i preset dei rack di Live): i suoi
 * dispositivi con i parametri, le 8 macro con le mappature e i rack che ha dentro. Non conosce il
 * progetto da cui viene: una mappatura indica il dispositivo per posto nel rack (0 il primo), o
 * il rack dentro per posto nella lista dei rack dentro, non per id. Non ci
 * sono i sample caricati (sono file del progetto) né il sidechain (è una traccia del progetto).
 * Qui ci sono i dati, come si prendono da una catena e come si rileggono da fuori. */
import type { DeviceId } from '../core/id';
import type { DeviceSettings, ParamValues } from './device';
import { INSTRUMENT_DEVICE } from './envelope';
import { MASTER, type ChainOwner, type Project } from './project';
import {
  checkRacks, findRack, innerRacks, MACRO_COUNT, MACRO_MODES, macroValueFor, springFor, type DeviceKey, type Macro, type MacroMode,
  type MacroSpring, type Rack,
} from './rack';
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

/** Una mappatura muove un parametro di un dispositivo (`device`) o una macro di un rack dentro (`rack`). */
export type SavedMapping = SavedMappingOf<{
  /** Il posto del dispositivo nel rack: lo strumento, se c'è, è il primo. */
  readonly device: number;
  readonly rack?: undefined;
}> | SavedMappingOf<{
  /** Il posto del rack in `RackPreset.racks`; `param` è la sua macro ("macroN"). */
  readonly rack: number;
  readonly device?: undefined;
}>;

type SavedMappingOf<Target> = Target & {
  readonly param: string;
  readonly min: number;
  readonly max: number;
};

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
  /** I rack dentro, ognuno prima di quelli che ha dentro; assente se non ce ne sono. */
  readonly racks?: readonly SavedInnerRack[];
}

/** Un rack dentro il rack salvato. */
export interface SavedInnerRack {
  readonly name: string | null;
  /** Il posto del suo primo dispositivo nel rack salvato, e quanti ne ha. */
  readonly first: number;
  readonly count: number;
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
  const inner = innerRacks(p.racksOf(owner), rack);
  const rackAt = new Map(inner.map((r, i) => [r.id as DeviceKey, i]));
  const macros = (r: Rack): SavedMacro[] => r.macros.map(m => ({
    name: m.name, value: m.value,
    mappings: m.mappings.map((x): SavedMapping => (rackAt.has(x.device)
      ? { rack: rackAt.get(x.device)!, param: x.param, min: x.min, max: x.max }
      : { device: at.get(x.device)!, param: x.param, min: x.min, max: x.max })),
    ...(m.mode && m.mode !== 'knob' ? { mode: m.mode } : {}),
    ...(m.mode === 'spring' && m.spring ? { spring: { ...m.spring } } : {}),
  }));
  return {
    name,
    instrument: rack.devices[0] === INSTRUMENT_DEVICE && track instanceof MidiTrack ? saved(track.instrument) : null,
    effects: rack.devices.filter(k => k !== INSTRUMENT_DEVICE).map(k => {
      const e = effects.find(x => x.id === k)!;
      return { ...saved(e), enabled: e.enabled };
    }),
    macros: macros(rack),
    ...(inner.length ? {
      racks: inner.map(r => ({ name: r.name, first: at.get(r.devices[0])!, count: r.devices.length, macros: macros(r) })),
    } : {}),
  };
}

/** I rack di un rack salvato messo in una catena con i dispositivi `devices` (nell'ordine del
 *  rack salvato); `id` dà gli id dei rack nuovi. Il rack, poi quelli dentro. */
export function presetRacks(preset: RackPreset, devices: readonly DeviceKey[], id: () => DeviceId): Rack[] {
  const saved = preset.racks ?? [];
  const ids = [id(), ...saved.map(() => id())];
  const macros = (list: readonly SavedMacro[]) => list.map(({ mappings, ...m }): Macro => ({
    ...m,
    mappings: mappings.map(({ device, rack, ...x }) => ({ device: rack === undefined ? devices[device] : ids[rack + 1], ...x })),
  }));
  return [
    { id: ids[0], name: preset.name, devices: [...devices], macros: macros(preset.macros) },
    ...saved.map((r, i): Rack => ({ id: ids[i + 1], name: r.name, devices: devices.slice(r.first, r.first + r.count), macros: macros(r.macros) })),
  ];
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
  const inner = (Array.isArray(raw.racks) ? raw.racks : []).filter(isObject).filter(r =>
    Number.isInteger(r.first) && Number.isInteger(r.count) && (r.first as number) >= 0 && (r.count as number) > 0
    && (r.first as number) + (r.count as number) <= size);
  const macrosOf = (list: unknown) =>
    Array.from({ length: MACRO_COUNT }, (_, i) => savedMacro(Array.isArray(list) ? list[i] : undefined, size, inner.length));
  const preset: RackPreset = {
    name, instrument: inst, effects: fx as SavedEffect[],
    macros: macrosOf(macros),
    ...(inner.length ? {
      racks: inner.map(r => ({
        name: typeof r.name === 'string' && r.name ? r.name : null, first: r.first as number, count: r.count as number, macros: macrosOf(r.macros),
      })),
    } : {}),
  };
  return validNesting(preset) ? preset : withoutInnerRacks(preset);
}

/** I rack dentro stanno nelle regole dei rack (uno dentro l'altro, ognuno prima di quelli che ha
 *  dentro, mappature solo dentro). */
function validNesting(preset: RackPreset): boolean {
  const devices = Array.from({ length: rackPresetSize(preset) }, (_, i) => `d${i}` as DeviceId);
  let n = 0;
  const racks = presetRacks(preset, devices, () => `r${n++}` as DeviceId);
  if (racks.some((r, i) => i > 0 && racks[i - 1].devices.length < r.devices.length)) return false;
  try {
    checkRacks(devices, racks);
    return true;
  } catch {
    return false;
  }
}

/** Il rack salvato senza i rack dentro (e senza le mappature sulle loro macro). */
function withoutInnerRacks({ racks: _racks, ...preset }: RackPreset): RackPreset {
  return { ...preset, macros: preset.macros.map(m => ({ ...m, mappings: m.mappings.filter(x => x.rack === undefined) })) };
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

/** `size` dispositivi e `racks` rack dentro, a cui le mappature possono andare. */
function savedMacro(raw: unknown, size: number, racks: number): SavedMacro {
  if (!isObject(raw)) return { name: null, value: 0, mappings: [] };
  const mode = MACRO_MODES.find(([m]) => m === raw.mode)?.[0];
  const index = (v: unknown, count: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < count;
  const mappings = (Array.isArray(raw.mappings) ? raw.mappings : []).filter((x): x is SavedMapping => isObject(x)
    && (x.rack === undefined ? index(x.device, size) : index(x.rack, racks))
    && typeof x.param === 'string' && !!x.param && finite(x.min) && finite(x.max));
  return {
    name: typeof raw.name === 'string' && raw.name ? raw.name : null,
    value: macroValueFor(mode ?? 'knob', finite(raw.value) ? raw.value : 0),
    mappings: mappings.map(({ device, rack, param, min, max }): SavedMapping => (rack === undefined
      ? { device, param, min, max } : { rack, param, min, max })),
    ...(mode && mode !== 'knob' ? { mode } : {}),
    ...(mode === 'spring' && isObject(raw.spring) && finite(raw.spring.rest) && finite(raw.spring.time)
      ? { spring: springFor(raw.spring.rest, raw.spring.time, raw.spring.sync === true) } : {}),
  };
}
