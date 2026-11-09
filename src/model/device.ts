/* A track's devices as project data: the instrument (MIDI tracks) and the effects
 * chain (all tracks). Each has a type (a registered name, e.g. "analog",
 * "delay") and the parameter values. The model doesn't know the types: the unsaved parameters
 * take the type's default value when the device plays, so a parameter
 * added in the future doesn't change the sound of existing projects. */
import type { DeviceId, SampleId, TrackId } from '../core/id';
import type { ModTarget } from './envelope';

export type ParamValues = Readonly<Record<string, number>>;

/** The samples a device plays, by slot (e.g. "p1" the Drum Machine's first pad). */
export type DeviceSamples = Readonly<Record<string, SampleId>>;

/** What instruments and effects have in common. */
export interface DeviceSettings {
  readonly type: string;
  /** Name of the preset it started from (just for display), or null. */
  readonly preset: string | null;
  readonly params: ParamValues;
  /** The samples loaded in the device, if it uses any (project files, as for audio clips). */
  readonly samples?: DeviceSamples;
}

export type InstrumentSettings = DeviceSettings;

/** An effect in a track's chain. */
export interface EffectSettings extends DeviceSettings {
  readonly id: DeviceId;
  /** Off = the sound passes without effect (bypass). */
  readonly enabled: boolean;
  /** The track the detector listens to instead of the passing sound (sidechain), for the
   *  effects accepting it. Absent: it listens to its own input. */
  readonly sidechain?: TrackId;
  /** For the modulators (LFO, Envelope): what each target moves (null: free). The amount
   *  of each is a parameter (see devices/modulators). Absent: none. */
  readonly targets?: readonly (ModTarget | null)[];
}

export const DEFAULT_INSTRUMENT: InstrumentSettings = { type: 'analog', preset: 'Init', params: {} };

export const newEffect = (id: DeviceId, type: string): EffectSettings => ({ id, type, enabled: true, preset: null, params: {} });

export const withParam = <S extends DeviceSettings>(s: S, id: string, value: number): S =>
  ({ ...s, params: { ...s.params, [id]: value } });

/** Several parameters together (e.g. frequency and gain of a dragged EQ point). */
export const withParams = <S extends DeviceSettings>(s: S, values: ParamValues): S =>
  ({ ...s, params: { ...s.params, ...values } });

export const withPreset = <S extends DeviceSettings>(s: S, name: string, params: ParamValues): S =>
  ({ ...s, preset: name, params: { ...params } });

/** The detector listens to track `source` (null: its own input again). */
export function withSidechain(e: EffectSettings, source: TrackId | null): EffectSettings {
  const { sidechain: _old, ...rest } = e;
  return source ? { ...rest, sidechain: source } : rest;
}

/** The target of slot `slot` (from 0) of a modulator, or null (also null: removes it);
 *  the free ones at the end disappear. */
export function withTarget(e: EffectSettings, slot: number, target: ModTarget | null): EffectSettings {
  const targets = [...(e.targets ?? [])];
  while (targets.length <= slot) targets.push(null);
  targets[slot] = target;
  while (targets.length && targets[targets.length - 1] === null) targets.pop();
  const { targets: _old, ...rest } = e;
  return targets.length ? { ...rest, targets } : rest;
}

/** The chain with the modulators' targets that moved device `device` freed (the
 *  device changed type). If none moved it, the same list. */
export function withoutTargetsOf(effects: readonly EffectSettings[], device: string): readonly EffectSettings[] {
  const hits = (t: ModTarget | null) => t?.kind === 'device' && t.device === device;
  if (!effects.some(e => e.targets?.some(hits))) return effects;
  return effects.map(e => (e.targets?.some(hits) ? e.targets.reduce((x, t, i) => (hits(t) ? withTarget(x, i, null) : x), e) : e));
}

/** The sample in slot `slot`, or null if empty. */
export const sampleAt = (s: DeviceSettings, slot: string): SampleId | null => s.samples?.[slot] ?? null;

/** Puts (or with null removes) the sample in slot `slot`. */
export function withSample<S extends DeviceSettings>(s: S, slot: string, id: SampleId | null): S {
  const { [slot]: _old, ...rest } = s.samples ?? {};
  const samples = id ? { ...rest, [slot]: id } : rest;
  return { ...s, samples: Object.keys(samples).length ? samples : undefined };
}

/** The samples used by a device. */
export const deviceSampleIds = (s: DeviceSettings): SampleId[] => Object.values(s.samples ?? {});
