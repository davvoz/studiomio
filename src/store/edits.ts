/* Modifiche del progetto, una per azione dell'utente. Sono funzioni pure: ricevono i
 * parametri e restituiscono un Edit che lo store applica e può annullare. */
import type { DeviceId, IdFactory, PlacementId, SampleId, SceneId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { placementEnd, type Placement } from '../model/arrangement';
import { AudioClip } from '../model/audio-clip';
import type { Clip } from '../model/clip';
import { paletteColor } from '../model/colors';
import {
  newEffect, withParam, withParams, withPreset, withSample, withSidechain, type EffectSettings, type InstrumentSettings, type ParamValues,
} from '../model/device';
import * as chain from '../model/effect-list';
import { INSTRUMENT_DEVICE, type EnvelopePoint, type ModTarget } from '../model/envelope';
import { MidiClip } from '../model/midi-clip';
import { Project, type ChainOwner, type LoopRegion } from '../model/project';
import type { SampleRef } from '../model/sample';
import { withoutParamKeysOf } from '../model/key-map';
import { withoutParamControlsOf } from '../model/midi-map';
import { withoutMappingsOf } from '../model/rack';
import { AudioTrack, BusTrack, busLetter, GroupTrack, MidiTrack, type MixerSettings, type Track } from '../model/track';
import { edit, type Edit } from './project-store';
import { reapplyMacros } from './rack-edits';

// ------------------------------------------------------------------ progetto

export const setTempo = (bpm: number): Edit => edit('Tempo', p => (p.tempo.bpm === bpm ? p : p.withTempo(bpm)));

export const renameProject = (name: string): Edit => edit('Rinomina progetto', p => p.withName(name));

export const setLoopRegion = (patch: Partial<LoopRegion>): Edit => edit('Regione di loop', p => p.withLoop(patch));

/** La curva del master su un parametro di un suo effetto o una macro di un suo rack (battiti
 *  della timeline); senza punti la toglie. */
export const setMasterAutomation = (target: ModTarget, points: readonly EnvelopePoint[]): Edit =>
  edit(points.length ? 'Curva del master' : 'Cancella la curva del master', p => p.withMasterAutomation(target, points));

export const setLaunchQuantization = (id: string): Edit =>
  edit('Quantizzazione del lancio', p => (p.launchQuantization === id ? p : p.withLaunchQuantization(id)));

/** Il progetto con cui si comincia, come in Live: una traccia MIDI, una audio e due bus. */
export function starterProject(name: string, ids: IdFactory): Project {
  const ctx = { ids };
  return [addTrack('midi'), addTrack('audio'), addBus(), addBus()].reduce((p, e) => e.apply(p, ctx), Project.empty(name, ids));
}

// ------------------------------------------------------------------ tracce

/** Fabbriche delle tracce per tipo: aggiungere un tipo di traccia è aggiungere una voce. */
const trackFactories = {
  audio: { label: 'Audio', create: AudioTrack.empty },
  midi: { label: 'MIDI', create: MidiTrack.empty },
} as const;

export type TrackKind = keyof typeof trackFactories;

/** Dove va una traccia nuova: subito dopo una traccia (e ciò che contiene), nel suo stesso
 *  gruppo, oppure in fondo a un gruppo. Senza: in fondo al progetto. */
export type TrackPlace = { readonly after: TrackId } | { readonly inGroup: TrackId };

export const addTrack = (kind: TrackKind, place?: TrackPlace): Edit =>
  edit(`Nuova traccia ${trackFactories[kind].label}`, (p, { ids }) => {
    const { label, create } = trackFactories[kind];
    const n = p.tracks.filter(t => t.kind === kind).length + 1;
    const track = create(ids.next('track'), `${n} ${label}`, paletteColor(p.tracks.length), p.scenes.length);
    if (!place) return p.addingTrack(track);
    const [at, group] = 'after' in place ? [place.after, p.track(place.after)?.group ?? null] : [place.inGroup, place.inGroup];
    return p.addingTrack(track.withGroup(group), p.blockEnd(at));
  });

export const removeTrack = (id: TrackId): Edit =>
  edit('Elimina traccia', p => p.removingTrack(id));

// ------------------------------------------------------------------ bus

/** Aggiunge un bus in fondo ai bus: "A Bus", "B Bus"… (la prima lettera libera da lì). */
export const addBus = (): Edit =>
  edit('Nuovo bus', (p, { ids }) => {
    const taken = new Set(p.buses.map(b => b.name));
    let n = p.buses.length;
    while (taken.has(`${busLetter(n)} Bus`)) n++;
    return p.addingBus(BusTrack.empty(ids.next('track'), `${busLetter(n)} Bus`, paletteColor(p.tracks.length + p.buses.length)));
  });

/** Il livello della mandata della traccia verso il bus, in dB (fino a SEND_OFF_DB: chiusa). */
export const setSend = (track: TrackId, bus: TrackId, db: number): Edit =>
  edit('Mandata', p => {
    if (!(p.track(bus) instanceof BusTrack)) throw new Error(`la traccia ${bus} non è un bus`);
    return p.updatingTrack(track, t => {
      if (t instanceof BusTrack) throw new TypeError(`il bus ${t.name} non ha mandate`);
      return t.withSend(bus, db);
    });
  });

// ------------------------------------------------------------------ gruppi

/** Raggruppa le tracce in un gruppo nuovo (Ctrl+G), che prende il posto della prima. */
export const groupTracks = (ids: Iterable<TrackId>): Edit =>
  edit('Raggruppa tracce', (p, { ids: f }) => {
    const n = p.tracks.filter(t => t instanceof GroupTrack).length + 1;
    return p.groupingTracks(ids, GroupTrack.empty(f.next('track'), `${n} Gruppo`, paletteColor(p.tracks.length), p.scenes.length));
  });

/** Toglie il gruppo, le sue tracce restano (Ctrl+Maiusc+G). */
export const ungroupTracks = (group: TrackId): Edit => edit('Separa gruppo', p => p.ungroupingTrack(group));

/** Chiude o apre un gruppo: chiuso, le sue tracce non si vedono ma suonano. */
export const setGroupFolded = (group: TrackId, folded: boolean): Edit =>
  edit(folded ? 'Chiudi gruppo' : 'Apri gruppo', p => p.updatingTrack(group, t => {
    if (!(t instanceof GroupTrack)) throw new TypeError(`la traccia ${t.name} non è un gruppo`);
    return t.withFolded(folded);
  }));

export const moveTrack = (id: TrackId, toIndex: number): Edit => edit('Sposta traccia', p => p.movingTrack(id, toIndex));

export const renameTrack = (id: TrackId, name: string): Edit =>
  edit('Rinomina traccia', p => p.updatingTrack(id, t => t.withName(name)));

export const setMixer = (id: TrackId, patch: Partial<MixerSettings>): Edit =>
  edit('Mixer', p => p.updatingTrack(id, t => t.withMixer(patch)));

/** Volume e mute del master. */
export const setMasterMixer = (patch: Partial<Pick<MixerSettings, 'volumeDb' | 'mute'>>): Edit =>
  edit('Master', p => p.withMaster(patch));

// ------------------------------------------------------------------ strumenti

const updatingInstrument = (label: string, id: TrackId, fn: (s: InstrumentSettings) => InstrumentSettings): Edit =>
  edit(label, p => p.updatingTrack(id, t => {
    if (!(t instanceof MidiTrack)) throw new TypeError(`la traccia ${t.name} non ha uno strumento`);
    return t.withInstrument(fn(t.instrument));
  }));

/** Cambia lo strumento; se è di un altro tipo, le macro che lo muovevano lo lasciano. */
export const setInstrument = (id: TrackId, settings: InstrumentSettings): Edit =>
  edit('Strumento', p => {
    const before = p.track(id);
    const next = p.updatingTrack(id, t => {
      if (!(t instanceof MidiTrack)) throw new TypeError(`la traccia ${t.name} non ha uno strumento`);
      const racks = settings.type === t.instrument.type ? t.racks : withoutMappingsOf(t.racks, INSTRUMENT_DEVICE);
      return t.withInstrument(settings).withChain(t.effects, racks);
    });
    // un altro strumento ha altri parametri: i loro tasti e controlli MIDI non valgono più
    const same = before instanceof MidiTrack && before.instrument.type === settings.type;
    return same ? next : next.updatingKeyMap(map => withoutParamKeysOf(map, id, INSTRUMENT_DEVICE))
      .updatingMidiMap(map => withoutParamControlsOf(map, id, INSTRUMENT_DEVICE));
  });

export const setInstrumentParam = (id: TrackId, param: string, value: number): Edit =>
  updatingInstrument('Parametro dello strumento', id, s => withParam(s, param, value));

/** Più parametri dello strumento insieme (es. il suono di un pad con i suoi valori). */
export const setInstrumentParams = (id: TrackId, values: ParamValues): Edit =>
  updatingInstrument('Parametri dello strumento', id, s => withParams(s, values));

/** Sample nello strumento, per posto (null: tolto), insieme ai parametri che servono a suonarli
 *  (es. il modello Sample del pad): un passo solo. Un sample nuovo entra anche nel progetto. */
export const setInstrumentSamples = (id: TrackId, changes: Readonly<Record<string, SampleRef | SampleId | null>>, values: ParamValues = {}): Edit =>
  edit('Sample dello strumento', p => {
    let next = p;
    const ids: Record<string, SampleId | null> = {};
    for (const [slot, s] of Object.entries(changes)) {
      if (s && typeof s === 'object' && !next.sample(s.id)) next = next.addingSample(s);
      ids[slot] = s && typeof s === 'object' ? s.id : s;
    }
    return next.updatingTrack(id, t => {
      if (!(t instanceof MidiTrack)) throw new TypeError(`la traccia ${t.name} non ha uno strumento`);
      const settings = Object.entries(ids).reduce((s, [slot, sample]) => withSample(s, slot, sample), withParams(t.instrument, values));
      return t.withInstrument(settings);
    });
  });

/** Carica un preset: i parametri tornano ai predefiniti del tipo più quelli del preset (quelli
 *  mappati su una macro restano dove la macro li tiene). */
export const loadPreset = (id: TrackId, name: string, params: ParamValues): Edit =>
  edit(`Preset ${name}`, (p, ctx) => reapplyMacros(updatingInstrument('', id, s => withPreset(s, name, params)).apply(p, ctx), id));

// ------------------------------------------------------------------ effetti
// Valgono per la catena di una traccia e per quella del master (`owner`).

const updatingEffect = (label: string, owner: ChainOwner, id: DeviceId, fn: (e: EffectSettings) => EffectSettings): Edit =>
  edit(label, p => p.updatingEffects(owner, list => chain.update(list, id, fn)));

/** Aggiunge un effetto di tipo `type` alla catena (in fondo, o in posizione `index`). */
export const addEffect = (owner: ChainOwner, type: string, label: string, index?: number): Edit =>
  edit(`Aggiungi ${label}`, (p, { ids }) => p.updatingEffects(owner, list => chain.add(list, newEffect(ids.next('device'), type), index)));

export const removeEffect = (owner: ChainOwner, id: DeviceId): Edit =>
  edit('Elimina effetto', p => p.updatingEffects(owner, list => chain.remove(list, id)));

export const moveEffect = (owner: ChainOwner, id: DeviceId, index: number): Edit =>
  edit('Sposta effetto', p => p.updatingEffects(owner, list => chain.move(list, id, index)));

export const setEffectEnabled = (owner: ChainOwner, id: DeviceId, enabled: boolean): Edit =>
  updatingEffect(enabled ? 'Accendi effetto' : 'Spegni effetto', owner, id, e => ({ ...e, enabled }));

export const setEffectParam = (owner: ChainOwner, id: DeviceId, param: string, value: number): Edit =>
  updatingEffect("Parametro dell'effetto", owner, id, e => withParam(e, param, value));

export const setEffectParams = (owner: ChainOwner, id: DeviceId, values: ParamValues): Edit =>
  updatingEffect("Parametri dell'effetto", owner, id, e => withParams(e, values));

/** Il rilevatore dell'effetto ascolta la traccia `source` (null: di nuovo il proprio ingresso). */
export const setEffectSidechain = (owner: ChainOwner, id: DeviceId, source: TrackId | null): Edit =>
  updatingEffect(source ? 'Sidechain' : 'Togli il sidechain', owner, id, e => withSidechain(e, source));

export const loadEffectPreset = (owner: ChainOwner, id: DeviceId, name: string, params: ParamValues): Edit =>
  edit(`Preset ${name}`, p => reapplyMacros(p.updatingEffects(owner, list => chain.update(list, id, e => withPreset(e, name, params))), owner));

// ------------------------------------------------------------------ sample e clip

export const addSample = (sample: SampleRef): Edit => edit('Importa sample', p => p.addingSample(sample));

/** Mette sulla timeline una clip con tutto il sample, a partire da `start`. */
export const placeSample = (trackId: TrackId, sampleId: SampleId, start: Beats): Edit =>
  edit('Inserisci clip audio', (p, { ids }) => {
    const sample = p.sample(sampleId);
    if (!sample) throw new Error(`sample ${sampleId} non trovato`);
    const track = p.track(trackId);
    const clip = AudioClip.fromSample(ids.next('clip'), sample, track?.color ?? paletteColor(0));
    return p.updatingTrack(trackId, t => t.placing(fullPlacement(ids.next('placement'), clip, start), ids));
  });

export const addMidiClip = (trackId: TrackId, start: Beats, length: Beats): Edit =>
  edit('Nuova clip MIDI', (p, { ids }) => p.updatingTrack(trackId, t => {
    const clip = MidiClip.empty(ids.next('clip'), 'Clip MIDI', t.color, length);
    return t.placing({ id: ids.next('placement'), clip, start, length, offset: 0 }, ids);
  }));

/** Sposta una clip sulla timeline, anche su un'altra traccia dello stesso tipo. */
export const movePlacement = (from: TrackId, id: PlacementId, start: Beats, to: TrackId = from): Edit =>
  edit('Sposta clip', (p, { ids }) => {
    const placement = requirePlacement(p.track(from), id);
    const moved = { ...placement, start: Math.max(0, start) };
    if (to === from) return p.updatingTrack(from, t => t.updatingPlacement(id, () => moved, ids));
    return p
      .updatingTrack(from, t => t.removingPlacement(id))
      .updatingTrack(to, t => t.placing(moved, ids));
  });

/** Cambia i bordi di una clip posata: spostando l'inizio cambia anche l'offset, così il
 *  contenuto resta fermo sulla timeline (come trascinare il bordo sinistro in Live). */
export const resizePlacement = (trackId: TrackId, id: PlacementId, edges: { start?: Beats; end?: Beats }): Edit =>
  edit('Ridimensiona clip', (p, { ids }) => p.updatingTrack(trackId, t => t.updatingPlacement(id, pl => {
    const start = Math.max(edges.start ?? pl.start, pl.start - pl.offset);
    const end = edges.end ?? placementEnd(pl);
    return { ...pl, start, length: end - start, offset: pl.offset + (start - pl.start) };
  }, ids)));

export const splitPlacement = (trackId: TrackId, id: PlacementId, at: Beats): Edit =>
  edit('Dividi clip', (p, { ids }) => p.updatingTrack(trackId, t => t.splitting(id, at, ids)));

export const deletePlacement = (trackId: TrackId, id: PlacementId): Edit =>
  edit('Elimina clip', p => p.updatingTrack(trackId, t => t.removingPlacement(id)));

/** Copia la clip subito dopo l'originale, con una copia indipendente del contenuto. */
export const duplicatePlacement = (trackId: TrackId, id: PlacementId): Edit =>
  edit('Duplica clip', (p, { ids }) => p.updatingTrack(trackId, t => {
    const pl = requirePlacement(t, id);
    const copy = { ...pl, id: ids.next('placement'), clip: pl.clip.withId(ids.next('clip')), start: placementEnd(pl) };
    return t.placing(copy, ids);
  }));

/** Modifica il contenuto di una clip posata (warp, note, nome…). */
export const updateClip = <C extends Clip>(label: string, trackId: TrackId, id: PlacementId, fn: (c: C) => Clip): Edit =>
  edit(label, (p, { ids }) => p.updatingTrack(trackId, t => t.updatingPlacement(id, pl => ({ ...pl, clip: fn(pl.clip as C) }), ids)));

/** Scala il tempo di una clip MIDI posata (vedi MidiClip.scaledTime) e con lei la sua durata
 *  sulla timeline: l'inizio resta fermo, la clip si allunga o si accorcia. */
export const scaleMidiPlacement = (label: string, trackId: TrackId, id: PlacementId, factor: number): Edit =>
  edit(label, (p, { ids }) => p.updatingTrack(trackId, t => t.updatingPlacement(id, pl => ({
    ...pl, clip: (pl.clip as unknown as MidiClip).scaledTime(factor), length: pl.length * factor, offset: pl.offset * factor,
  }), ids)));

/** "Dupl. Loop" su una clip MIDI posata (vedi MidiClip.duplicatingLoop). Se la clip sulla timeline
 *  finiva proprio alla fine del loop, si allunga per far sentire la copia; più lunga, resta com'è. */
export const duplicateLoopPlacement = (trackId: TrackId, id: PlacementId): Edit =>
  edit('Duplica loop', (p, { ids }) => p.updatingTrack(trackId, t => t.updatingPlacement(id, pl => {
    const clip = pl.clip as unknown as MidiClip;
    const { start, end } = clip.loop.enabled ? clip.loop : clip.region;
    const endsAtLoop = Math.abs(clip.region.start + pl.offset + pl.length - end) < 1e-9;
    return { ...pl, clip: clip.duplicatingLoop(), length: pl.length + (endsAtLoop ? end - start : 0) };
  }, ids)));

// ------------------------------------------------------------------ session

export const setSlot = (trackId: TrackId, sceneIndex: number, clip: Clip | null): Edit =>
  edit(clip ? 'Clip nella session' : 'Svuota slot', p => p.updatingTrack(trackId, t => t.withSlot(sceneIndex, clip)));

export const addScene = (index?: number): Edit =>
  edit('Nuova scena', (p, { ids }) => p.addingScene({ id: ids.next('scene'), name: String(p.scenes.length + 1) }, index));

export const removeScene = (id: SceneId): Edit => edit('Elimina scena', p => p.removingScene(id));

// ------------------------------------------------------------------ aiuti

function fullPlacement(id: PlacementId, clip: Clip, start: Beats): Placement {
  return { id, clip, start: Math.max(0, start), length: clip.region.end - clip.region.start, offset: 0 };
}

function requirePlacement(track: Track | undefined, id: PlacementId): Placement {
  const pl = track?.placement(id);
  if (!pl) throw new Error(`clip ${id} non trovata`);
  return pl;
}
