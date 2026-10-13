/* Modifiche del progetto, una per azione dell'utente. Sono funzioni pure: ricevono i
 * parametri e restituiscono un Edit che lo store applica e può annullare. */
import type { DeviceId, PlacementId, SampleId, SceneId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { placementEnd, type Placement } from '../model/arrangement';
import { AudioClip } from '../model/audio-clip';
import type { Clip } from '../model/clip';
import { paletteColor } from '../model/colors';
import { newEffect, withParam, withPreset, type InstrumentSettings, type ParamValues } from '../model/device';
import { MidiClip } from '../model/midi-clip';
import type { LoopRegion } from '../model/project';
import type { SampleRef } from '../model/sample';
import { AudioTrack, MidiTrack, type MixerSettings, type Track } from '../model/track';
import { edit, type Edit } from './project-store';

// ------------------------------------------------------------------ progetto

export const setTempo = (bpm: number): Edit => edit('Tempo', p => (p.tempo.bpm === bpm ? p : p.withTempo(bpm)));

export const renameProject = (name: string): Edit => edit('Rinomina progetto', p => p.withName(name));

export const setLoopRegion = (patch: Partial<LoopRegion>): Edit => edit('Regione di loop', p => p.withLoop(patch));

// ------------------------------------------------------------------ tracce

/** Fabbriche delle tracce per tipo: aggiungere un tipo di traccia è aggiungere una voce. */
const trackFactories = {
  audio: { label: 'Audio', create: AudioTrack.empty },
  midi: { label: 'MIDI', create: MidiTrack.empty },
} as const;

export type TrackKind = keyof typeof trackFactories;

export const addTrack = (kind: TrackKind, index?: number): Edit =>
  edit(`Nuova traccia ${trackFactories[kind].label}`, (p, { ids }) => {
    const { label, create } = trackFactories[kind];
    const n = p.tracks.filter(t => t.kind === kind).length + 1;
    const track = create(ids.next('track'), `${n} ${label}`, paletteColor(p.tracks.length), p.scenes.length);
    return p.addingTrack(track, index);
  });

export const removeTrack = (id: TrackId): Edit => edit('Elimina traccia', p => p.removingTrack(id));

export const moveTrack = (id: TrackId, toIndex: number): Edit => edit('Sposta traccia', p => p.movingTrack(id, toIndex));

export const renameTrack = (id: TrackId, name: string): Edit =>
  edit('Rinomina traccia', p => p.updatingTrack(id, t => t.withName(name)));

export const setMixer = (id: TrackId, patch: Partial<MixerSettings>): Edit =>
  edit('Mixer', p => p.updatingTrack(id, t => t.withMixer(patch)));

// ------------------------------------------------------------------ strumenti

const updatingInstrument = (label: string, id: TrackId, fn: (s: InstrumentSettings) => InstrumentSettings): Edit =>
  edit(label, p => p.updatingTrack(id, t => {
    if (!(t instanceof MidiTrack)) throw new TypeError(`la traccia ${t.name} non ha uno strumento`);
    return t.withInstrument(fn(t.instrument));
  }));

export const setInstrument = (id: TrackId, settings: InstrumentSettings): Edit =>
  updatingInstrument('Strumento', id, () => settings);

export const setInstrumentParam = (id: TrackId, param: string, value: number): Edit =>
  updatingInstrument('Parametro dello strumento', id, s => withParam(s, param, value));

/** Carica un preset: i parametri tornano ai predefiniti del tipo più quelli del preset. */
export const loadPreset = (id: TrackId, name: string, params: ParamValues): Edit =>
  updatingInstrument(`Preset ${name}`, id, s => withPreset(s, name, params));

// ------------------------------------------------------------------ effetti

/** Aggiunge un effetto di tipo `type` alla catena (in fondo, o in posizione `index`). */
export const addEffect = (track: TrackId, type: string, label: string, index?: number): Edit =>
  edit(`Aggiungi ${label}`, (p, { ids }) => p.updatingTrack(track, t => t.addingEffect(newEffect(ids.next('device'), type), index)));

export const removeEffect = (track: TrackId, id: DeviceId): Edit =>
  edit('Elimina effetto', p => p.updatingTrack(track, t => t.removingEffect(id)));

export const moveEffect = (track: TrackId, id: DeviceId, index: number): Edit =>
  edit('Sposta effetto', p => p.updatingTrack(track, t => t.movingEffect(id, index)));

export const setEffectEnabled = (track: TrackId, id: DeviceId, enabled: boolean): Edit =>
  edit(enabled ? 'Accendi effetto' : 'Spegni effetto', p => p.updatingTrack(track, t => t.updatingEffect(id, e => ({ ...e, enabled }))));

export const setEffectParam = (track: TrackId, id: DeviceId, param: string, value: number): Edit =>
  edit("Parametro dell'effetto", p => p.updatingTrack(track, t => t.updatingEffect(id, e => withParam(e, param, value))));

export const loadEffectPreset = (track: TrackId, id: DeviceId, name: string, params: ParamValues): Edit =>
  edit(`Preset ${name}`, p => p.updatingTrack(track, t => t.updatingEffect(id, e => withPreset(e, name, params))));

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
