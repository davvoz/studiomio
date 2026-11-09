import type { ParamValues } from '../model/device';
import { clampParam, type ParamCondition, type ParamSection, type ParamSpec } from './params';

export interface Preset {
  readonly name: string;
  /** Only the values different from the defaults. */
  readonly params: ParamValues;
}

/** A device type (instrument or effect), interface side: name, grouped parameters
 *  and presets. The sound is made by its DSP engine in the AudioWorklet, registered with the same
 *  `type` in worklet/cores.ts. */
export interface DeviceType {
  readonly type: string;
  readonly label: string;
  readonly sections: readonly ParamSection[];
  readonly presets: readonly Preset[];
  /** For effects that can listen to another track (sidechain): the engine receives that
   *  sound as a second input, for the detector. */
  readonly sidechain?: boolean;
  /** For instruments whose presets are drum kits (the Drum Machine): they also end up in
   *  Drums, in the browser. */
  readonly kit?: boolean;
  /** For instruments that give notes a name (the drum machine: one pad per note): with
   *  these parameter values (and these names of the loaded samples, by slot), the name of
   *  each note that plays something. */
  readonly noteNames?: (values: Readonly<Record<string, number>>, samples?: ReadonlyMap<string, string>) => ReadonlyMap<number, string>;
  /** The parameters that stay as they are when a preset is chosen (e.g. the Sampler's zone
   *  map, which depends on the loaded samples and not on the sound). */
  readonly keepsOnPreset?: (param: string) => boolean;
  /** For modulators (LFO, Envelope): they don't touch the sound, they move the parameters of their
   *  targets (see devices/modulators). */
  readonly modulator?: boolean;
  /** For whoever works on notes and not on sound (the Arpeggiator): only makes sense on a MIDI track. */
  readonly notes?: boolean;
}

/** The parameter values a preset of `t` doesn't change, among `params`. */
export const keptOnPreset = (t: DeviceType, params: ParamValues): ParamValues =>
  t.keepsOnPreset ? Object.fromEntries(Object.entries(params).filter(([id]) => t.keepsOnPreset!(id))) : {};

export const paramsOf = (t: DeviceType): ParamSpec[] => t.sections.flatMap(s => s.params);

/** True if the condition holds with these values. */
const holds = ({ param, is }: ParamCondition, values: Readonly<Record<string, number>>): boolean =>
  typeof is === 'number' ? values[param] === is : is.includes(values[param]);

/** The sections present with these values (those with a condition only if it holds). */
export const activeSections = (t: DeviceType, values: ParamValues): ParamSection[] => {
  const all = t.sections.some(s => s.when) ? resolveParams(t, values) : values;
  return t.sections.filter(s => !s.when || holds(s.when, all));
};

/** The parameters shown outside the device panel (menus, controllers); with the
 *  values, only those of the present sections. */
export const visibleParamsOf = (t: DeviceType, values?: ParamValues): ParamSpec[] =>
  (values ? activeSections(t, values) : t.sections).flatMap(s => s.params).filter(p => !p.hidden);

/** The parameters by id, by type (the Drum Machine has thousands: the pads' instruments). */
const specsByType = new WeakMap<DeviceType, ReadonlyMap<string, ParamSpec>>();

export const paramSpec = (t: DeviceType, id: string): ParamSpec | undefined => {
  let specs = specsByType.get(t);
  if (!specs) specsByType.set(t, (specs = new Map(paramsOf(t).map(p => [p.id, p]))));
  return specs.get(id);
};

/** All the type's parameters: the given ones (validated) and, for the others, the defaults. */
export function resolveParams(t: DeviceType, values: ParamValues): Record<string, number> {
  return Object.fromEntries(paramsOf(t).map(p => [p.id, p.id in values ? clampParam(p, values[p.id]) : p.default]));
}

/** Like resolveParams, without the parameters of the sections that aren't there with these values: it's what
 *  reaches the engine. */
export function resolveActiveParams(t: DeviceType, values: ParamValues): Record<string, number> {
  const all = resolveParams(t, values);
  if (!t.sections.some(s => s.when)) return all;
  const out: Record<string, number> = {};
  for (const s of t.sections) if (!s.when || holds(s.when, all)) for (const p of s.params) out[p.id] = all[p.id];
  return out;
}

/** True if the parameter counts with these values (e.g. the time in ms only without sync). */
export function paramActive(p: ParamSpec, values: Readonly<Record<string, number>>): boolean {
  return !p.when || holds(p.when, values);
}
