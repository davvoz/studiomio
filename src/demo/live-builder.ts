/* Un live descritto come dati e montato in un progetto: tracce (una Drum Machine con i suoi pad
 * Sample, un Analog, un Neuro o un altro strumento), effetti, rack con le loro macro, scene con
 * le loro clip e modulazioni, e l'ordine delle scene per la "registrazione" sulla timeline. Per
 * suonarlo dal vivo: il sidechain, i tasti della tastiera sulle macro, la quantizzazione del
 * lancio. I live di src/demo descrivono solo la musica; il montaggio è qui, uguale per tutti. */
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
  addEffect, addScene, addTrack, loadEffectPreset, renameProject, renameTrack, setEffectSidechain, setInstrument, setInstrumentSamples,
  setLaunchQuantization, setMasterMixer, setMixer, setSlot, setTempo,
} from '../store/edits';
import { setKey } from '../store/key-edits';
import { edit, type ProjectStore } from '../store/project-store';
import { renameScene } from '../store/session-edits';
import { BAR } from './patterns';

// ------------------------------------------------------------------ suoni

/** Un pad: un Sample (il suono per nome) o, con `model`, un suono sintetizzato della Drum
 *  Machine ("kick", "snare"…); i controlli mancanti restano quelli del modello. */
export interface PadSound<S extends string> {
  readonly sound?: S;
  readonly model?: string;
  readonly tune?: number;
  readonly decay?: number;
  /** Inizio nel file, in percento (per affettare un loop o una frase)… */
  readonly start?: number;
  /** …o in secondi dall'inizio del file (diventa la percentuale con la durata del sample). */
  readonly at?: number;
  readonly reverse?: boolean;
  readonly tone?: number;
  readonly snap?: number;
  readonly level?: number;
  readonly pan?: number;
  readonly choke?: number;
}

/** L'Inizio di un pad in percento: dato, o dai secondi `at` con la durata del suo sample. */
const startOf = <S extends string>(p: PadSound<S>, sounds?: Readonly<Record<S, SampleRef>>): number => {
  if (p.at === undefined) return p.start ?? 0;
  const s = p.sound === undefined ? undefined : sounds?.[p.sound];
  if (!s) throw new Error(`per "at" serve la durata del sample "${p.sound}"`);
  return Math.round((p.at / sampleDuration(s)) * 1e6) / 1e4;
};

/** Il modello di un pad: quello dato o, se c'è un suono, Sample. */
const modelOf = <S extends string>(p: PadSound<S>): number => {
  const model = MODEL[p.model ?? 'sample'];
  if (model === undefined) throw new Error(`modello di pad sconosciuto: "${p.model}"`);
  if (model === MODEL.sample && p.sound === undefined) throw new Error('un pad Sample vuole il suo suono');
  return model;
};

/** I parametri dei pad di un kit (con i sample, se qualche pad dice "at"). */
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

// ------------------------------------------------------------------ effetti

/** Un effetto con i suoi parametri (sopra i predefiniti del tipo). */
export interface EffectSpec {
  readonly type: string;
  readonly label: string;
  readonly name: string;
  readonly params: ParamValues;
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

/** Un EQ che taglia sotto `freq` (lascia i bassi a chi li deve tenere). */
export const lowCut = (freq: number): EffectSpec =>
  eq(`Taglio ${freq} Hz`, { [bandParam(0, 'on')]: 1, [bandParam(0, 'freq')]: freq });

// ------------------------------------------------------------------ rack

/** Un parametro mosso da una macro: il dispositivo per posto nel rack (0 il primo: lo strumento,
 *  se è un Instrument Rack), il parametro, il suo valore con la macro a 0 e a 127. */
export type Move = readonly [device: number, param: string, min: number, max: number];

export interface MacroSpec {
  readonly name: string;
  /** Assente: manopola. */
  readonly mode?: MacroMode;
  /** Dove parte (0 … 127); assente: 0. I parametri mappati partono dove la macro li porta. */
  readonly value?: number;
  readonly moves: readonly Move[];
}

/** Un rack: i suoi effetti (dopo lo strumento, se è l'Instrument Rack della traccia) e le macro. */
export interface RackSpec {
  readonly name: string;
  readonly effects: readonly EffectSpec[];
  readonly macros: readonly MacroSpec[];
}

/** Il rack come quelli salvati, pronto per loadRack (con lo strumento, se c'è). Controlla che le
 *  macro muovano parametri che esistono: un errore di battitura si vede subito. */
export function rackPreset(spec: RackSpec, instrument: SavedDevice | null): RackPreset {
  if (spec.macros.length > MACRO_COUNT) throw new RangeError(`${spec.name}: più di ${MACRO_COUNT} macro`);
  const devices = [...(instrument ? [instrument] : []), ...spec.effects];
  const typeOf = (i: number) => (instrument && i === 0 ? instrumentType(instrument.type) : effectType(devices[i].type));
  return {
    name: spec.name,
    instrument,
    effects: spec.effects.map(e => ({ type: e.type, preset: e.name, params: { ...e.params }, enabled: true })),
    macros: Array.from({ length: MACRO_COUNT }, (_, i): SavedMacro => {
      const m = spec.macros[i];
      if (!m) return { name: null, value: 0, mappings: [] };
      for (const [device, param] of m.moves) {
        const type = devices[device] && typeOf(device);
        if (!type || !paramSpec(type, param)) throw new RangeError(`${spec.name}, macro «${m.name}»: il dispositivo ${device} non ha «${param}»`);
      }
      const value = m.value ?? 0;
      if (value < 0 || value > MACRO_MAX) throw new RangeError(`${spec.name}, macro «${m.name}»: valore ${value}`);
      return {
        name: m.name, value,
        mappings: m.moves.map(([device, param, min, max]) => ({ device, param, min, max })),
        ...(m.mode ? { mode: m.mode } : {}),
      };
    }),
  };
}

// ------------------------------------------------------------------ tracce, clip, scene

export interface TrackSpec<S extends string, K extends string = string> {
  readonly key: K;
  readonly name: string;
  readonly volumeDb: number;
  readonly pan?: number;
  /** Un kit di Drum Machine, un suono di Neuro, uno strumento qualunque o (se mancano) di Analog. */
  readonly kit?: readonly PadSound<S>[];
  readonly neuro?: ParamValues;
  readonly analog?: ParamValues;
  readonly instrument?: { readonly type: string; readonly params: ParamValues };
  /** L'Instrument Rack: lo strumento qui sopra, i suoi effetti e le macro. */
  readonly rack?: RackSpec;
  /** Audio Effect Rack dopo l'Instrument Rack, in fila. */
  readonly fxRacks?: readonly RackSpec[];
  /** I sample dello strumento per posto ("sample", "z2"… del Sampler), oltre a quelli del kit. */
  readonly samples?: Readonly<Record<string, S>>;
  /** Gli effetti fuori dai rack, dopo i rack. */
  readonly effects: readonly EffectSpec[];
  /** Effetti che ascoltano un'altra traccia (il compressore in sidechain sulla cassa): il posto
   *  dell'effetto nella catena finita (rack compresi) e la traccia. */
  readonly sidechain?: readonly (readonly [effect: number, source: K])[];
}

/** Cosa muove una modulazione: come nel modello, o un effetto della traccia per posizione
 *  nella catena (l'id lo riceve quando la traccia nasce). */
export type ModSpecTarget = ModTarget | { readonly kind: 'effect'; readonly index: number; readonly param: string };

export interface ModSpec {
  readonly target: ModSpecTarget;
  readonly points: readonly EnvelopePoint[];
}

/** Una clip della session: note, lunghezza del giro e (a scelta) modulazioni. */
export interface ClipSpec {
  readonly name: string;
  readonly notes: readonly Note[];
  readonly length: Beats;
  readonly mods?: readonly ModSpec[];
  /** Suona una volta e si ferma (senza loop): salite, rulli, impatti. */
  readonly once?: boolean;
}

export const clip = (name: string, notes: readonly Note[], length: Beats, mods: readonly ModSpec[] = []): ClipSpec =>
  ({ name, notes, length, mods });

export const instrumentParam = (param: string): ModTarget => ({ kind: 'device', device: INSTRUMENT_DEVICE, param });
export const effectParam = (index: number, param: string): ModSpecTarget => ({ kind: 'effect', index, param });
export const VOLUME: ModTarget = { kind: 'mixer', param: 'volume' };

export interface SceneSpec<K extends string = string> {
  readonly name: string;
  /** Quante battute dura la sezione nella "registrazione" sulla timeline. */
  readonly bars: number;
  readonly clips: Partial<Record<K, ClipSpec>>;
}

/** Un tasto della tastiera su una macro: il rack per posto tra quelli della catena (0 il primo). */
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
  /** Gli Audio Effect Rack del master vanno prima dei suoi effetti. */
  readonly master: { readonly volumeDb: number; readonly effects: readonly EffectSpec[]; readonly racks?: readonly RackSpec[] };
  readonly tracks: readonly TrackSpec<S, K>[];
  readonly scenes: readonly SceneSpec<K>[];
  /** L'ordine delle scene (per indice) nella "registrazione" sulla timeline. */
  readonly arrangement: readonly number[];
  /** La quantizzazione del lancio (vedi model/launch.ts); assente: quella predefinita. */
  readonly launch?: string;
  readonly keys?: readonly KeySpec<K>[];
}

// ------------------------------------------------------------------ montaggio

/** Il bersaglio vero di una modulazione: l'effetto per posizione diventa il suo id. */
function resolveTarget(target: ModSpecTarget, effects: readonly EffectSettings[]): ModTarget {
  if (target.kind !== 'effect') return target;
  const fx = effects[target.index];
  if (!fx) throw new Error(`la traccia non ha l'effetto ${target.index + 1}`);
  return { kind: 'device', device: fx.id, param: target.param };
}

function addEffects(store: ProjectStore, owner: ChainOwner, effects: readonly EffectSpec[]): void {
  for (const fx of effects) {
    store.apply(addEffect(owner, fx.type, fx.label));
    const list = owner === MASTER ? store.project.masterEffects : store.project.track(owner)!.effects;
    store.apply(loadEffectPreset(owner, list.at(-1)!.id, fx.name, fx.params));
  }
}

/** Lo strumento di una traccia: il kit della Drum Machine, Neuro, quello dato o Analog. */
function instrumentOf<S extends string, K extends string>(spec: TrackSpec<S, K>, sounds: Readonly<Record<S, SampleRef>>): { type: string; params: ParamValues } {
  if (spec.kit) return { type: DRUMS.type, params: { volume: 0, velocity: 60, ...kitParams(spec.kit, sounds) } };
  if (spec.neuro) return { type: NEURO.type, params: { ...spec.neuro } };
  if (spec.instrument) return { type: spec.instrument.type, params: { ...spec.instrument.params } };
  return { type: ANALOG.type, params: { ...spec.analog } };
}

/** Monta il live nel progetto (vuoto) dello store, con i sample già pronti per nome. */
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
  // il sidechain quando tutte le tracce ci sono (anche verso una traccia che viene dopo)
  for (const spec of live.tracks) {
    for (const [index, source] of spec.sidechain ?? []) {
      const track = ids.get(spec.key)!, fx = store.project.track(track)!.effects[index], from = ids.get(source);
      if (!fx || !from) throw new Error(`${spec.name}: sidechain sull'effetto ${index + 1} da «${source}» impossibile`);
      store.apply(setEffectSidechain(track, fx.id, from));
    }
  }
  for (const k of live.keys ?? []) {
    const owner: ChainOwner = k.owner === 'master' ? MASTER : ids.get(k.owner)!;
    const rack = store.project.racksOf(owner)[k.rack];
    if (!rack) throw new Error(`tasto ${k.key}: il rack ${k.rack + 1} di «${k.owner}» non c'è`);
    store.apply(setKey({ kind: 'macro', owner, rack: rack.id, index: k.macro }, k.key));
  }

  // le clip della session, e la stessa clip riusata nella "registrazione"
  const trackOf = (key: K) => {
    const id = ids.get(key);
    if (!id) throw new Error(`traccia "${key}" inesistente`);
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
    store.apply(edit(`Sezione ${scene.name}`, (p, { ids: idf }) => clipsOf(scene).reduce((next, [key, spec]) => {
      const c = clipOf(key, spec);
      return next.updatingTrack(trackOf(key).id, t => t.placing({ id: idf.next('placement'), clip: c, start, length, offset: 0 }, idf));
    }, p)));
    at += length;
  }
}
