/* A live described as data and assembled into a project: tracks (a Drum Machine with its Sample
 * pads, an Analog, a Neuro or another instrument), effects, racks with their macros, scenes with
 * their clips and modulations, and the order of the scenes for the "recording" on the timeline. To
 * play it live: the sidechain, the keyboard keys on the macros, the launch
 * quantization. The lives in src/demo describe only the music; the assembly is here, the same for all. */
import type { TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { paramSpec } from '../devices/device-type';
import { CLIPPER } from '../devices/effects/clipper/clipper';
import { COMPRESSOR } from '../devices/effects/compressor/compressor';
import { DELAY } from '../devices/effects/delay/delay';
import { DRIVE } from '../devices/effects/drive/drive';
import { bandParam, EQ } from '../devices/effects/eq/eq';
import { LIMITER } from '../devices/effects/limiter/limiter';
import { MULTIBAND } from '../devices/effects/multiband/multiband';
import { PHASER } from '../devices/effects/phaser/phaser';
import { REVERB } from '../devices/effects/reverb/reverb';
import { STEREO } from '../devices/effects/stereo/stereo';
import { ENVELOPE_DEVICE, LFO_DEVICE } from '../devices/modulators/modulators';
import { ANALOG } from '../devices/instruments/analog/analog';
import { DRUM_MODELS, DRUMS, MODEL, padParam, padSlot } from '../devices/instruments/drums/drums';
import { NEURO } from '../devices/instruments/neuro/neuro';
import { effectType, instrumentType } from '../devices/registry';
import type { EffectSettings, ParamValues } from '../model/device';
import { INSTRUMENT_DEVICE, type EnvelopePoint, type ModTarget } from '../model/envelope';
import { MidiClip, type Note } from '../model/midi-clip';
import { MASTER, type ChainOwner } from '../model/project';
import { MACRO_COUNT, MACRO_MAX, type MacroMode } from '../model/rack';
import type { RackPreset, SavedDevice, SavedMacro } from '../model/rack-preset';
import { sampleDuration, type SampleRef } from '../model/sample';
import { loadRack } from '../store/browser-edits';
import {
  addEffect, addScene, addTrack, loadEffectPreset, renameProject, renameTrack, setEffectSidechain, setInstrument, setInstrumentSamples, setModTarget,
  setLaunchQuantization, setMasterMixer, setMixer, setSlot, setTempo,
} from '../store/edits';
import { setKey } from '../store/key-edits';
import { edit, type ProjectStore } from '../store/project-store';
import { renameScene } from '../store/session-edits';
import { BAR } from './patterns';

// ------------------------------------------------------------------ sounds

/** A pad: a Sample (the sound by name) or, with `model`, a synthesized Drum
 *  Machine sound ("kick", "snare"…); the missing controls stay the model's. */
export interface PadSound<S extends string> {
  readonly sound?: S;
  readonly model?: string;
  readonly tune?: number;
  readonly decay?: number;
  /** Start in the file, in percent (to slice a loop or a phrase)… */
  readonly start?: number;
  /** …or in seconds from the start of the file (becomes the percentage with the sample's duration). */
  readonly at?: number;
  readonly reverse?: boolean;
  readonly tone?: number;
  readonly snap?: number;
  readonly level?: number;
  readonly pan?: number;
  readonly choke?: number;
}

/** A pad's Start in percent: given, or from the seconds `at` with its sample's duration. */
const startOf = <S extends string>(p: PadSound<S>, sounds?: Readonly<Record<S, SampleRef>>): number => {
  if (p.at === undefined) return p.start ?? 0;
  const s = p.sound === undefined ? undefined : sounds?.[p.sound];
  if (!s) throw new Error(`"at" needs the duration of sample "${p.sound}"`);
  return Math.round((p.at / sampleDuration(s)) * 1e6) / 1e4;
};

/** A pad's model: the given one or, if there's a sound, Sample. */
const modelOf = <S extends string>(p: PadSound<S>): number => {
  const model = MODEL[p.model ?? 'sample'];
  if (model === undefined) throw new Error(`unknown pad model: "${p.model}"`);
  if (model === MODEL.sample && p.sound === undefined) throw new Error('a Sample pad needs its sound');
  return model;
};

/** The parameters of a kit's pads (with the samples, if some pad says "at"). */
export const kitParams = <S extends string>(kit: readonly PadSound<S>[], sounds?: Readonly<Record<S, SampleRef>>): Record<string, number> =>
  Object.fromEntries(kit.flatMap((p, i) => {
    const model = modelOf(p), d = DRUM_MODELS[model];
    return [
      [padParam(i, 'model'), model], [padParam(i, 'tune'), p.tune ?? 0], [padParam(i, 'decay'), p.decay ?? d.decay],
      [padParam(i, 'start'), startOf(p, sounds)], [padParam(i, 'reverse'), p.reverse ? 1 : 0],
      [padParam(i, 'tone'), p.tone ?? d.tone], [padParam(i, 'snap'), p.snap ?? d.snap], [padParam(i, 'level'), p.level ?? 0],
      [padParam(i, 'pan'), p.pan ?? 0], [padParam(i, 'choke'), p.choke ?? 0],
    ];
  }));

// ------------------------------------------------------------------ effects

/** An effect with its parameters (over the type's defaults). */
export interface EffectSpec {
  readonly type: string;
  readonly label: string;
  readonly name: string;
  readonly params: ParamValues;
  /** For modulators (LFO, Envelope): what each target moves, in order (the amount is the
   *  parameter `a1`, `a2`…). An effect by position belongs to the same chain (in a rack: the rack's). */
  readonly targets?: readonly (ModSpecTarget | null)[];
}

export const effect = (t: { type: string; label: string }) => (name: string, params: ParamValues): EffectSpec =>
  ({ type: t.type, label: t.label, name, params });

export const drive = effect(DRIVE);
export const delay = effect(DELAY);
export const compressor = effect(COMPRESSOR);
export const reverb = effect(REVERB);
export const limiter = effect(LIMITER);
export const multiband = effect(MULTIBAND);
export const phaser = effect(PHASER);
export const eq = effect(EQ);
export const clipper = effect(CLIPPER);
export const stereo = effect(STEREO);

/** An LFO or an Envelope with its targets. */
export const lfo = (name: string, params: ParamValues, targets: readonly (ModSpecTarget | null)[]): EffectSpec =>
  ({ ...effect(LFO_DEVICE)(name, params), targets });
export const envelope = (name: string, params: ParamValues, targets: readonly (ModSpecTarget | null)[]): EffectSpec =>
  ({ ...effect(ENVELOPE_DEVICE)(name, params), targets });

/** An EQ cutting below `freq` (leaves the lows to whoever must hold them). */
export const lowCut = (freq: number): EffectSpec =>
  eq(`Cut ${freq} Hz`, { [bandParam(0, 'on')]: 1, [bandParam(0, 'freq')]: freq });

// ------------------------------------------------------------------ rack

/** A parameter moved by a macro: the device by position in the rack (0 the first: the instrument,
 *  if it's an Instrument Rack), the parameter, its value with the macro at 0 and at 127. */
export type Move = readonly [device: number, param: string, min: number, max: number];

export interface MacroSpec {
  readonly name: string;
  /** Missing: knob. */
  readonly mode?: MacroMode;
  /** Where it starts (0 … 127); absent: 0. The mapped parameters start where the macro takes them. */
  readonly value?: number;
  readonly moves: readonly Move[];
}

/** A rack: its effects (after the instrument, if it's the track's Instrument Rack) and the macros. */
export interface RackSpec {
  readonly name: string;
  readonly effects: readonly EffectSpec[];
  readonly macros: readonly MacroSpec[];
}

/** The rack like the saved ones, ready for loadRack (with the instrument, if there is one). Checks that the
 *  macros move parameters that exist: a typo shows up right away. */
export function rackPreset(spec: RackSpec, instrument: SavedDevice | null): RackPreset {
  if (spec.macros.length > MACRO_COUNT) throw new RangeError(`${spec.name}: more than ${MACRO_COUNT} macros`);
  const devices = [...(instrument ? [instrument] : []), ...spec.effects];
  const typeOf = (i: number) => (instrument && i === 0 ? instrumentType(instrument.type) : effectType(devices[i].type));
  return {
    name: spec.name,
    instrument,
    effects: spec.effects.map(e => ({
      type: e.type, preset: e.name, params: { ...e.params }, enabled: true,
      ...(e.targets ? { targets: e.targets.map(t => savedSpecTarget(t, !!instrument)) } : {}),
    })),
    macros: Array.from({ length: MACRO_COUNT }, (_, i): SavedMacro => {
      const m = spec.macros[i];
      if (!m) return { name: null, value: 0, mappings: [] };
      for (const [device, param] of m.moves) {
        const type = devices[device] && typeOf(device);
        if (!type || !paramSpec(type, param)) throw new RangeError(`${spec.name}, macro «${m.name}»: device ${device} has no «${param}»`);
      }
      const value = m.value ?? 0;
      if (value < 0 || value > MACRO_MAX) throw new RangeError(`${spec.name}, macro «${m.name}»: value ${value}`);
      return {
        name: m.name, value,
        mappings: m.moves.map(([device, param, min, max]) => ({ device, param, min, max })),
        ...(m.mode ? { mode: m.mode } : {}),
      };
    }),
  };
}

// ------------------------------------------------------------------ tracks, clips, scenes

export interface TrackSpec<S extends string, K extends string = string> {
  readonly key: K;
  readonly name: string;
  readonly volumeDb: number;
  readonly pan?: number;
  /** A Drum Machine kit, a Neuro sound, any instrument or (if they're missing) Analog. */
  readonly kit?: readonly PadSound<S>[];
  readonly neuro?: ParamValues;
  readonly analog?: ParamValues;
  readonly instrument?: { readonly type: string; readonly params: ParamValues };
  /** The Instrument Rack: the instrument above, its effects and the macros. */
  readonly rack?: RackSpec;
  /** Audio Effect Racks after the Instrument Rack, in a row. */
  readonly fxRacks?: readonly RackSpec[];
  /** The instrument's samples by slot ("sample", "z2"… of the Sampler), besides those of the kit. */
  readonly samples?: Readonly<Record<string, S>>;
  /** The effects outside the racks, after the racks. */
  readonly effects: readonly EffectSpec[];
  /** Effects listening to another track (the sidechain compressor on the kick): the position
   *  of the effect in the finished chain (racks included) and the track. */
  readonly sidechain?: readonly (readonly [effect: number, source: K])[];
}

/** What a modulation moves: as in the model, or a track effect by position
 *  in the chain (it gets the id when the track is created). */
export type ModSpecTarget = ModTarget | { readonly kind: 'effect'; readonly index: number; readonly param: string };

export interface ModSpec {
  readonly target: ModSpecTarget;
  readonly points: readonly EnvelopePoint[];
}

/** A session clip: notes, loop length and (optionally) modulations. */
export interface ClipSpec {
  readonly name: string;
  readonly notes: readonly Note[];
  readonly length: Beats;
  readonly mods?: readonly ModSpec[];
  /** Plays once and stops (no loop): risers, rolls, impacts. */
  readonly once?: boolean;
}

export const clip = (name: string, notes: readonly Note[], length: Beats, mods: readonly ModSpec[] = []): ClipSpec =>
  ({ name, notes, length, mods });

export const instrumentParam = (param: string): ModTarget => ({ kind: 'device', device: INSTRUMENT_DEVICE, param });
export const effectParam = (index: number, param: string): ModSpecTarget => ({ kind: 'effect', index, param });
export const VOLUME: ModTarget = { kind: 'mixer', param: 'volume' };

export interface SceneSpec<K extends string = string> {
  readonly name: string;
  /** How many bars the section lasts in the "recording" on the timeline. */
  readonly bars: number;
  readonly clips: Partial<Record<K, ClipSpec>>;
}

/** A keyboard key on a macro: the rack by position among the chain's (0 the first). */
export interface KeySpec<K extends string = string> {
  /** KeyboardEvent.code: "KeyQ", "Digit1"… */
  readonly key: string;
  readonly owner: K | 'master';
  readonly rack: number;
  readonly macro: number;
}

export interface LiveSpec<S extends string, K extends string = string> {
  readonly name: string;
  readonly bpm: number;
  /** The master's Audio Effect Racks go before its effects. */
  readonly master: { readonly volumeDb: number; readonly effects: readonly EffectSpec[]; readonly racks?: readonly RackSpec[] };
  readonly tracks: readonly TrackSpec<S, K>[];
  readonly scenes: readonly SceneSpec<K>[];
  /** The order of the scenes (by index) in the "recording" on the timeline. */
  readonly arrangement: readonly number[];
  /** The launch quantization (see model/launch.ts); absent: the default one. */
  readonly launch?: string;
  readonly keys?: readonly KeySpec<K>[];
}

// ------------------------------------------------------------------ assembly

/** The real target of a modulation: the effect by position becomes its id. */
function resolveTarget(target: ModSpecTarget, effects: readonly EffectSettings[]): ModTarget {
  if (target.kind !== 'effect') return target;
  const fx = effects[target.index];
  if (!fx) throw new Error(`the track doesn't have effect ${target.index + 1}`);
  return { kind: 'device', device: fx.id, param: target.param };
}

function addEffects(store: ProjectStore, owner: ChainOwner, effects: readonly EffectSpec[]): void {
  const list = () => (owner === MASTER ? store.project.masterEffects : store.project.track(owner)!.effects);
  const first = list().length;
  for (const fx of effects) {
    store.apply(addEffect(owner, fx.type, fx.label));
    store.apply(loadEffectPreset(owner, list().at(-1)!.id, fx.name, fx.params));
  }
  // the modulators' targets at the end: they can also move the effects that come after
  effects.forEach((fx, i) => fx.targets?.forEach((t, slot) => {
    if (t) store.apply(setModTarget(owner, list()[first + i].id, slot, resolveTarget(t, list())));
  }));
}

/** The target of a modulator of a hand-written rack, as in the saved racks. */
function savedSpecTarget(t: ModSpecTarget | null, instrument: boolean): string | null {
  if (!t) return null;
  if (t.kind === 'effect') return `d${t.index + (instrument ? 1 : 0)}:${t.param}`;
  if (t.kind === 'mixer') return `mixer:${t.param}`;
  if (t.kind === 'device' && t.device === INSTRUMENT_DEVICE && instrument) return `d0:${t.param}`;
  throw new RangeError('in a rack a modulator moves only the rack\'s devices, the volume and the pan');
}

/** A track's instrument: the Drum Machine kit, Neuro, the given one or Analog. */
function instrumentOf<S extends string, K extends string>(spec: TrackSpec<S, K>, sounds: Readonly<Record<S, SampleRef>>): { type: string; params: ParamValues } {
  if (spec.kit) return { type: DRUMS.type, params: { volume: 0, velocity: 60, ...kitParams(spec.kit, sounds) } };
  if (spec.neuro) return { type: NEURO.type, params: { ...spec.neuro } };
  if (spec.instrument) return { type: spec.instrument.type, params: { ...spec.instrument.params } };
  return { type: ANALOG.type, params: { ...spec.analog } };
}

/** Assembles the live in the store's (empty) project, with the samples already ready by name. */
export function buildLive<S extends string, K extends string>(store: ProjectStore, live: LiveSpec<S, K>, sounds: Readonly<Record<S, SampleRef>>): void {
  store.apply(renameProject(live.name));
  store.apply(setTempo(live.bpm));
  store.apply(setMasterMixer({ volumeDb: live.master.volumeDb }));
  if (live.launch) store.apply(setLaunchQuantization(live.launch));
  for (const r of live.master.racks ?? []) store.apply(loadRack(MASTER, rackPreset(r, null)));
  addEffects(store, MASTER, live.master.effects);
  while (store.project.scenes.length < live.scenes.length) store.apply(addScene());
  live.scenes.forEach((s, i) => store.apply(renameScene(store.project.scenes[i].id, s.name)));

  const ids = new Map<K, TrackId>();
  for (const spec of live.tracks) {
    store.apply(addTrack('midi'));
    const track = store.project.tracks.at(-1)!.id;
    ids.set(spec.key, track);
    store.apply(renameTrack(track, spec.name));
    store.apply(setMixer(track, { volumeDb: spec.volumeDb, ...(spec.pan ? { pan: spec.pan } : {}) }));
    const instrument = instrumentOf(spec, sounds);
    if (spec.rack) store.apply(loadRack(track, rackPreset(spec.rack, { ...instrument, preset: null })));
    else store.apply(setInstrument(track, { ...instrument, preset: null }));
    for (const r of spec.fxRacks ?? []) store.apply(loadRack(track, rackPreset(r, null)));
    if (spec.kit) {
      const kit = spec.kit;
      store.apply(setInstrumentSamples(track, Object.fromEntries(kit.flatMap((p, i) => (p.sound === undefined ? [] : [[padSlot(i), sounds[p.sound]]])))));
    }
    if (spec.samples) store.apply(setInstrumentSamples(track, Object.fromEntries(Object.entries<S>(spec.samples).map(([slot, s]) => [slot, sounds[s]]))));
    addEffects(store, track, spec.effects);
  }
  // the sidechain when all the tracks are there (also towards a track that comes after)
  for (const spec of live.tracks) {
    for (const [index, source] of spec.sidechain ?? []) {
      const track = ids.get(spec.key)!, fx = store.project.track(track)!.effects[index], from = ids.get(source);
      if (!fx || !from) throw new Error(`${spec.name}: sidechain on effect ${index + 1} from «${source}» impossible`);
      store.apply(setEffectSidechain(track, fx.id, from));
    }
  }
  for (const k of live.keys ?? []) {
    const owner: ChainOwner = k.owner === 'master' ? MASTER : ids.get(k.owner)!;
    const rack = store.project.racksOf(owner)[k.rack];
    if (!rack) throw new Error(`key ${k.key}: rack ${k.rack + 1} of «${k.owner}» doesn't exist`);
    store.apply(setKey({ kind: 'macro', owner, rack: rack.id, index: k.macro }, k.key));
  }

  // the session clips, and the same clip reused in the "recording"
  const trackOf = (key: K) => {
    const id = ids.get(key);
    if (!id) throw new Error(`track "${key}" doesn't exist`);
    return store.project.track(id)!;
  };
  const clipOf = (key: K, spec: ClipSpec): MidiClip => {
    const track = trackOf(key);
    let c = MidiClip.empty(store.ids.next('clip'), spec.name, track.color, spec.length).withNotes(spec.notes);
    if (spec.once) c = c.withLoop({ ...c.loop, enabled: false });
    for (const m of spec.mods ?? []) c = c.withEnvelope(resolveTarget(m.target, track.effects), m.points);
    return c;
  };
  const clipsOf = (scene: SceneSpec<K>) => Object.entries(scene.clips) as [K, ClipSpec][];
  live.scenes.forEach((scene, i) => {
    for (const [key, spec] of clipsOf(scene)) store.apply(setSlot(trackOf(key).id, i, clipOf(key, spec)));
  });

  let at = 0;
  for (const index of live.arrangement) {
    const scene = live.scenes[index], length = scene.bars * BAR, start = at;
    store.apply(edit(`Section ${scene.name}`, (p, { ids: idf }) => clipsOf(scene).reduce((next, [key, spec]) => {
      const c = clipOf(key, spec);
      return next.updatingTrack(trackOf(key).id, t => t.placing({ id: idf.next('placement'), clip: c, start, length, offset: 0 }, idf));
    }, p)));
    at += length;
  }
}
