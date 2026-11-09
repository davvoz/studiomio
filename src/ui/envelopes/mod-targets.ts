/* What can be modulated on a clip's track, for the modulation editor's menus:
 * the mixer (volume and pan), the instrument and the effects, with their parameters (numbers and choices:
 * a choice, like a switch, snaps when the curve moves it past halfway). On the
 * master the effects and the macros of its racks, for its curves on the timeline. */
import type { DeviceId } from '../../core/id';
import { activeSections, paramSpec, resolveParams, type DeviceType } from '../../devices/device-type';
import { paramFromUnit, paramToUnit, type ChoiceParam } from '../../devices/params';
import { effectType, instrumentType } from '../../devices/registry';
import type { EffectSettings, InstrumentSettings, ParamValues } from '../../model/device';
import { CLIP_TRANSPOSE, INSTRUMENT_DEVICE, scaleKindOf, type ModScaleKind, type ModTarget } from '../../model/envelope';
import { MASTER, type Project } from '../../model/project';
import { chainItems, macroIndex, macroName, macroParam, rackName, type ChainItem, type DeviceKey, type Rack, type RackList } from '../../model/rack';
import { AudioTrack, MidiTrack, type Track } from '../../model/track';

/** A chain of devices to modulate: a track's or the master's. */
export interface ModChain {
  readonly instrument?: InstrumentSettings;
  readonly effects: readonly EffectSettings[];
  /** The devices in the order of the sound (the instrument first, if there is one). */
  readonly chainKeys: readonly DeviceKey[];
  readonly racks: RackList;
}

export const trackChain = (track: Track): ModChain => ({
  instrument: track instanceof MidiTrack ? track.instrument : undefined,
  effects: track.effects, chainKeys: track.chainKeys, racks: track.racks,
});

export const masterChain = (p: Project): ModChain => ({ effects: p.masterEffects, chainKeys: p.chainKeys(MASTER), racks: p.masterRacks });

export interface TargetParam {
  readonly target: ModTarget;
  readonly label: string;
}

/** A group of parameters (a section of the device). */
export interface TargetSection {
  readonly label: string;
  readonly params: readonly TargetParam[];
}

/** A device of the track, with the parameters that can be modulated. */
export interface TargetDevice {
  /** "mixer", "instrument", the effect's id or the rack's. */
  readonly key: string;
  readonly label: string;
  readonly sections: readonly TargetSection[];
}

const MIXER: TargetDevice = {
  key: 'mixer',
  label: 'Mixer',
  sections: [{
    label: 'Mixer',
    params: [
      { target: { kind: 'mixer', param: 'volume' }, label: 'Volume' },
      { target: { kind: 'mixer', param: 'pan' }, label: 'Pan' },
    ],
  }],
};

/** A device's parameters, section by section (not those of the graphic panel only, nor
 *  of the sections that aren't there with these values). */
function deviceTargets(key: string, label: string, type: DeviceType | undefined, values: ParamValues): TargetDevice | null {
  if (!type) return null;
  const device = key as DeviceId;
  const sections = activeSections(type, values)
    .map(s => ({
      label: s.label,
      params: s.params.filter(p => !p.hidden).map(p => ({ target: { kind: 'device', device, param: p.id } as ModTarget, label: p.label })),
    }))
    .filter(s => s.params.length);
  return { key, label, sections };
}

/** On an audio track the clip itself: its transpose, as in Live. */
const AUDIO_CLIP: TargetDevice = {
  key: 'clip',
  label: 'Clip',
  sections: [{ label: 'Clip', params: [{ target: CLIP_TRANSPOSE, label: 'Transpose' }] }],
};

/** The track's devices, in the order the sound goes through them (the audio clip and the
 *  mixer first); a rack comes before its devices, with its macros. */
export const targetDevices = (track: Track): TargetDevice[] => [
  ...(track instanceof AudioTrack ? [AUDIO_CLIP] : []), MIXER, ...chainTargets(trackChain(track)),
];

/** The master's effects and the macros of its racks (its volume isn't modulated). */
export const masterTargetDevices = (p: Project): TargetDevice[] => chainTargets(masterChain(p));

/** A chain's devices, in the order of the sound; a rack before its devices (and the racks it has inside). */
function chainTargets(chain: ModChain): TargetDevice[] {
  const types = new Map<DeviceKey, { type: DeviceType | undefined; name: string; values: ParamValues }>();
  if (chain.instrument) {
    types.set(INSTRUMENT_DEVICE, { type: instrumentType(chain.instrument.type), name: chain.instrument.type, values: chain.instrument.params });
  }
  for (const e of chain.effects) types.set(e.id, { type: effectType(e.type), name: e.type, values: e.params });
  const out: TargetDevice[] = [];
  const seen = new Map<string, number>();
  const device = (key: DeviceKey) => {
    const { type, name, values } = types.get(key)!;
    // two effects of the same type: "Delay", "Delay 2"
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    const d = deviceTargets(key, `${type?.label ?? name}${n > 1 ? ` ${n}` : ''}`, type, values);
    if (d) out.push(d);
  };
  const label = (k: DeviceKey, param: string): string | undefined => {
    const t = types.get(k)?.type;
    if (t) return paramSpec(t, param)?.label;
    // the macro of an inner rack
    const rack = chain.racks.find(r => r.id === k), i = macroIndex(param);
    return rack?.macros[i] && macroName(rack.macros[i], i, x => label(x.device, x.param));
  };
  const visit = (item: ChainItem) => {
    if (item.kind === 'device') return device(item.key);
    out.push(rackTargets(item.rack, label));
    chainItems(chain.chainKeys, chain.racks, item.rack).forEach(visit);
  };
  chainItems(chain.chainKeys, chain.racks).forEach(visit);
  return out;
}

/** A rack's macros (they're modulated like the parameters: they move all the mapped ones). */
const rackTargets = (rack: Rack, label: (device: DeviceKey, param: string) => string | undefined): TargetDevice => ({
  key: rack.id,
  label: rackName(rack),
  sections: [{
    label: 'Macro',
    params: rack.macros.map((m, i) => ({
      target: { kind: 'device', device: rack.id, param: macroParam(i) } as ModTarget,
      label: macroName(m, i, x => label(x.device, x.param)),
    })),
  }],
});

/** The device containing the target. */
export const deviceKeyOf = (t: ModTarget): string => (t.kind === 'device' ? t.device : t.kind);

/** How a value of the curve is written, by target type. */
const FORMATS: { readonly [K in ModScaleKind]: (v: number) => string } = {
  volume: v => (v <= 0.0001 ? '0 % (−∞ dB)' : `${Math.round(v * 100)} % (${(40 * Math.log10(v)).toFixed(1)} dB)`),
  pan: v => (Math.abs(v) < 0.005 ? 'centre' : `${Math.round(Math.abs(v) * 100)} ${v < 0 ? 'L' : 'R'}`),
  param: v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.round(Math.abs(v) * 100)} %`,
  // the clip plays the nearest semitone
  transpose: v => { const st = Math.round(v); return `${st > 0 ? '+' : st < 0 ? '−' : ''}${Math.abs(st)} st`; },
};

/** How a value of the curve is written; for a choice (with its chain) also the option
 *  heard with that modulation: "On · +60 %". */
export function formatModValue(target: ModTarget, value: number, chain?: ModChain | null): string {
  const text = FORMATS[scaleKindOf(target)](value);
  const choice = chain ? choiceTarget(chain, target) : null;
  return choice ? `${choice.spec.options[choice.heard(value)]} · ${text}` : text;
}

/** A choice modulated by the curve: its description, where the knob is (0..1) and the option
 *  heard with the offset `offset` (as the engine computes it). */
export interface ChoiceTarget {
  readonly spec: ChoiceParam;
  readonly baseUnit: number;
  heard(offset: number): number;
}

/** The target as a choice, if it's a choice of a device of the chain (null for the mixer,
 *  the macros and the numeric parameters). */
export function choiceTarget(chain: ModChain, target: ModTarget): ChoiceTarget | null {
  if (target.kind !== 'device') return null;
  const settings = target.device === INSTRUMENT_DEVICE ? chain.instrument : chain.effects.find(e => e.id === target.device);
  if (!settings) return null;
  const type = target.device === INSTRUMENT_DEVICE ? instrumentType(settings.type) : effectType(settings.type);
  const spec = type && paramSpec(type, target.param);
  if (!type || spec?.kind !== 'choice') return null;
  const baseUnit = paramToUnit(spec, resolveParams(type, settings.params)[spec.id]);
  return { spec, baseUnit, heard: offset => paramFromUnit(spec, baseUnit + offset) };
}
