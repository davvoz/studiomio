/* Un live descritto come dati e montato in un progetto: tracce (una Drum Machine con i suoi pad
 * Sample, o un Analog), effetti, scene con le loro clip e modulazioni, e l'ordine delle scene
 * per la "registrazione" sulla timeline. I live di src/demo descrivono solo la musica; il
 * montaggio è qui, uguale per tutti. */
import type { TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { COMPRESSOR } from '../devices/effects/compressor/compressor';
import { DELAY } from '../devices/effects/delay/delay';
import { DRIVE } from '../devices/effects/drive/drive';
import { bandParam, EQ } from '../devices/effects/eq/eq';
import { LIMITER } from '../devices/effects/limiter/limiter';
import { REVERB } from '../devices/effects/reverb/reverb';
import { ANALOG } from '../devices/instruments/analog/analog';
import { DRUMS, MODEL, MAX_DECAY, padParam, padSlot } from '../devices/instruments/drums/drums';
import type { EffectSettings, ParamValues } from '../model/device';
import { INSTRUMENT_DEVICE, type EnvelopePoint, type ModTarget } from '../model/envelope';
import { MidiClip, type Note } from '../model/midi-clip';
import { MASTER, type ChainOwner } from '../model/project';
import { sampleDuration, type SampleRef } from '../model/sample';
import {
  addEffect, addScene, addTrack, loadEffectPreset, renameProject, renameTrack, setInstrument, setInstrumentSamples,
  setMasterMixer, setMixer, setSlot, setTempo,
} from '../store/edits';
import { edit, type ProjectStore } from '../store/project-store';
import { renameScene } from '../store/session-edits';
import { BAR } from './patterns';

// ------------------------------------------------------------------ suoni

/** Un pad Sample: il suono (per nome) e i suoi controlli; quelli mancanti restano neutri. */
export interface PadSound<S extends string> {
  readonly sound: S;
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
  const s = sounds?.[p.sound];
  if (!s) throw new Error(`per "at" serve la durata del sample "${p.sound}"`);
  return Math.round((p.at / sampleDuration(s)) * 1e6) / 1e4;
};

/** I parametri dei pad Sample di un kit (con i sample, se qualche pad dice "at"). */
export const kitParams = <S extends string>(kit: readonly PadSound<S>[], sounds?: Readonly<Record<S, SampleRef>>): Record<string, number> =>
  Object.fromEntries(kit.flatMap((p, i) => [
    [padParam(i, 'model'), MODEL.sample], [padParam(i, 'tune'), p.tune ?? 0], [padParam(i, 'decay'), p.decay ?? MAX_DECAY],
    [padParam(i, 'start'), startOf(p, sounds)], [padParam(i, 'reverse'), p.reverse ? 1 : 0],
    [padParam(i, 'tone'), p.tone ?? 50], [padParam(i, 'snap'), p.snap ?? 0], [padParam(i, 'level'), p.level ?? 0],
    [padParam(i, 'pan'), p.pan ?? 0], [padParam(i, 'choke'), p.choke ?? 0],
  ]));

// ------------------------------------------------------------------ effetti

/** Un effetto con i suoi parametri (sopra i predefiniti del tipo). */
export interface EffectSpec {
  readonly type: string;
  readonly label: string;
  readonly name: string;
  readonly params: ParamValues;
}

const effect = (t: { type: string; label: string }) => (name: string, params: ParamValues): EffectSpec =>
  ({ type: t.type, label: t.label, name, params });

export const drive = effect(DRIVE);
export const delay = effect(DELAY);
export const compressor = effect(COMPRESSOR);
export const reverb = effect(REVERB);
export const limiter = effect(LIMITER);
export const eq = effect(EQ);

/** Un EQ che taglia sotto `freq` (lascia i bassi a chi li deve tenere). */
export const lowCut = (freq: number): EffectSpec =>
  eq(`Taglio ${freq} Hz`, { [bandParam(0, 'on')]: 1, [bandParam(0, 'freq')]: freq });

// ------------------------------------------------------------------ tracce, clip, scene

export interface TrackSpec<S extends string, K extends string = string> {
  readonly key: K;
  readonly name: string;
  readonly volumeDb: number;
  readonly pan?: number;
  /** Un kit di Drum Machine o un suono di Analog. */
  readonly kit?: readonly PadSound<S>[];
  readonly analog?: ParamValues;
  readonly effects: readonly EffectSpec[];
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

export interface LiveSpec<S extends string, K extends string = string> {
  readonly name: string;
  readonly bpm: number;
  readonly master: { readonly volumeDb: number; readonly effects: readonly EffectSpec[] };
  readonly tracks: readonly TrackSpec<S, K>[];
  readonly scenes: readonly SceneSpec<K>[];
  /** L'ordine delle scene (per indice) nella "registrazione" sulla timeline. */
  readonly arrangement: readonly number[];
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

/** Monta il live nel progetto (vuoto) dello store, con i sample già pronti per nome. */
export function buildLive<S extends string, K extends string>(store: ProjectStore, live: LiveSpec<S, K>, sounds: Readonly<Record<S, SampleRef>>): void {
  store.apply(renameProject(live.name));
  store.apply(setTempo(live.bpm));
  store.apply(setMasterMixer({ volumeDb: live.master.volumeDb }));
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
    if (spec.kit) {
      const kit = spec.kit;
      store.apply(setInstrument(track, { type: DRUMS.type, preset: null, params: { volume: 0, velocity: 60, ...kitParams(kit, sounds) } }));
      store.apply(setInstrumentSamples(track, Object.fromEntries(kit.map((p, i) => [padSlot(i), sounds[p.sound]]))));
    } else {
      store.apply(setInstrument(track, { type: ANALOG.type, preset: null, params: { ...spec.analog } }));
    }
    addEffects(store, track, spec.effects);
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
