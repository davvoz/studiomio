/* A saved rack, to use in other projects (like Live's rack presets): its
 * devices with their parameters, the 8 macros with their mappings and the racks it has inside. It doesn't know the
 * project it comes from: a mapping indicates the device by position in the rack (0 the first), or
 * the inner rack by position in the list of inner racks, not by id (so also the targets of the
 * modulators, which outside the rack are lost). There
 * are no loaded samples (they're project files) nor the sidechain (it's a project track).
 * Here are the data, how they're taken from a chain and how they're read back from outside. */
import type { DeviceId } from '../core/id';
import type { DeviceSettings, ParamValues } from './device';
import { INSTRUMENT_DEVICE, type ModTarget } from './envelope';
import { MASTER, type ChainOwner, type Project } from './project';
import {
  checkRacks, findRack, innerRacks, MACRO_COUNT, MACRO_MODES, macroValueFor, springFor, type DeviceKey, type Macro, type MacroMode,
  type MacroSpring, type Rack,
} from './rack';
import { MidiTrack } from './track';

/** A device of the saved rack: type, preset it started from (for display) and parameters. */
export interface SavedDevice {
  readonly type: string;
  readonly preset: string | null;
  readonly params: ParamValues;
}

export interface SavedEffect extends SavedDevice {
  readonly enabled: boolean;
  /** For the modulators, the targets (see `savedTarget`); absent: none. */
  readonly targets?: readonly (string | null)[];
}

/** A target of a modulator in the saved rack: "d2:cutoff" (a parameter of the third
 *  device), "r0:macro1" (a macro of the rack itself; "r1:…" of the first inner rack),
 *  "mixer:volume". null: free, or outside the rack. */
function savedTarget(t: ModTarget | null, at: ReadonlyMap<DeviceKey, number>, racks: readonly DeviceId[]): string | null {
  if (!t || t.kind === 'clip') return null;
  if (t.kind === 'mixer') return `mixer:${t.param}`;
  const rack = racks.indexOf(t.device as DeviceId);
  if (rack >= 0) return `r${rack}:${t.param}`;
  const device = at.get(t.device);
  return device === undefined ? null : `d${device}:${t.param}`;
}

/** The saved target in the chain the rack arrives in: `devices` its devices,
 *  `racks` the rack and those inside (in the order of the saved rack). */
export function presetTarget(saved: string | null, devices: readonly DeviceKey[], racks: readonly Rack[]): ModTarget | null {
  const m = saved ? /^(d|r|mixer)(\d*):(.+)$/.exec(saved) : null;
  if (!m) return null;
  const [, kind, n, param] = m;
  if (kind === 'mixer') return param === 'volume' || param === 'pan' ? { kind: 'mixer', param } : null;
  const owner = kind === 'd' ? devices[Number(n)] : racks[Number(n)]?.id;
  return n && owner ? { kind: 'device', device: owner, param } : null;
}

/** A mapping moves a parameter of a device (`device`) or a macro of an inner rack (`rack`). */
export type SavedMapping = SavedMappingOf<{
  /** The device's position in the rack: the instrument, if there is one, is the first. */
  readonly device: number;
  readonly rack?: undefined;
}> | SavedMappingOf<{
  /** The rack's position in `RackPreset.racks`; `param` is its macro ("macroN"). */
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
  /** Missing: knob. */
  readonly mode?: MacroMode;
  /** Only for springs. */
  readonly spring?: MacroSpring;
}

export interface RackPreset {
  readonly name: string;
  /** The instrument (Instrument Rack), or null (Audio Effect Rack). */
  readonly instrument: SavedDevice | null;
  /** The effects in chain order, after the instrument. */
  readonly effects: readonly SavedEffect[];
  /** Always MACRO_COUNT. */
  readonly macros: readonly SavedMacro[];
  /** The inner racks, each before those it has inside; absent if there are none. */
  readonly racks?: readonly SavedInnerRack[];
}

/** A rack inside the saved rack. */
export interface SavedInnerRack {
  readonly name: string | null;
  /** The position of its first device in the saved rack, and how many it has. */
  readonly first: number;
  readonly count: number;
  /** Always MACRO_COUNT. */
  readonly macros: readonly SavedMacro[];
}

/** How many devices the saved rack has. */
export const rackPresetSize = (r: RackPreset): number => (r.instrument ? 1 : 0) + r.effects.length;

const saved = (s: DeviceSettings): SavedDevice => ({ type: s.type, preset: s.preset, params: { ...s.params } });

/** Rack `id` of `owner`'s chain, to save with the name `name`. */
export function captureRack(p: Project, owner: ChainOwner, id: DeviceId, name: string): RackPreset {
  const rack = findRack(p.racksOf(owner), id);
  if (!rack) throw new RangeError(`rack ${id} not found`);
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
      const targets = e.targets?.map(t => savedTarget(t, at, [rack.id, ...inner.map(r => r.id)]));
      return { ...saved(e), enabled: e.enabled, ...(targets?.some(t => t) ? { targets } : {}) };
    }),
    macros: macros(rack),
    ...(inner.length ? {
      racks: inner.map(r => ({ name: r.name, first: at.get(r.devices[0])!, count: r.devices.length, macros: macros(r) })),
    } : {}),
  };
}

/** The racks of a saved rack put into a chain with the devices `devices` (in the order of the
 *  saved rack); `id` gives the ids of the new racks. The rack, then those inside. */
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

/** A saved rack from data read from outside (file, local storage), or null if it isn't one. The
 *  invalid mappings are skipped; the missing macros are empty. */
export function rackPresetFrom(raw: unknown): RackPreset | null {
  if (!isObject(raw)) return null;
  const { name, instrument, effects, macros } = raw;
  if (typeof name !== 'string' || !name || !Array.isArray(effects)) return null;
  const inst = instrument === null || instrument === undefined ? null : savedDevice(instrument);
  if (inst === undefined) return null;
  const fx = effects.map(e => {
    const d = savedDevice(e);
    const targets = (e as Record<string, unknown>).targets;
    return d && {
      ...d, enabled: (e as Record<string, unknown>).enabled !== false,
      ...(Array.isArray(targets) ? { targets: targets.map(t => (typeof t === 'string' ? t : null)) } : {}),
    };
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

/** The inner racks follow the rack rules (one inside the other, each before those it has
 *  inside, mappings only inside). */
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

/** The saved rack without the inner racks (and without the mappings on their macros). */
function withoutInnerRacks({ racks: _racks, ...preset }: RackPreset): RackPreset {
  return { ...preset, macros: preset.macros.map(m => ({ ...m, mappings: m.mappings.filter(x => x.rack === undefined) })) };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** undefined: it isn't a device. */
function savedDevice(raw: unknown): SavedDevice | undefined {
  if (!isObject(raw)) return undefined;
  const { type, preset, params } = raw;
  if (typeof type !== 'string' || !type || !isObject(params)) return undefined;
  return {
    type, preset: typeof preset === 'string' ? preset : null,
    params: Object.fromEntries(Object.entries(params).filter((x): x is [string, number] => finite(x[1]))),
  };
}

/** `size` devices and `racks` inner racks, which the mappings can go to. */
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
