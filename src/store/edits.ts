/* Project edits, one per user action. They're pure functions: they receive the
 * parameters and return an Edit that the store applies and can undo. */
import type { DeviceId, IdFactory, PlacementId, SampleId, SceneId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { placementEnd, type Placement } from '../model/arrangement';
import { AudioClip } from '../model/audio-clip';
import type { Clip } from '../model/clip';
import { paletteColor } from '../model/colors';
import {
  newEffect, withParam, withParams, withPreset, withSample, withSidechain, withTarget, withoutTargetsOf, type EffectSettings, type InstrumentSettings, type ParamValues,
} from '../model/device';
import { linkAmount } from '../devices/modulators/modulators';
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

export const renameProject = (name: string): Edit => edit('Rename project', p => p.withName(name));

export const setLoopRegion = (patch: Partial<LoopRegion>): Edit => edit('Loop region', p => p.withLoop(patch));

/** The master's curve on a parameter of one of its effects or a macro of one of its racks (timeline
 *  beats); without points it removes it. */
export const setMasterAutomation = (target: ModTarget, points: readonly EnvelopePoint[]): Edit =>
  edit(points.length ? 'Master curve' : 'Delete the master curve', p => p.withMasterAutomation(target, points));

/** Switches the master's curves on or off: switched off they stay, but don't play. */
export const setMasterAutomationOn = (on: boolean): Edit =>
  edit(on ? 'Master automation on' : 'Master automation off', p => (p.masterAutomationOn === on ? p : p.withMasterAutomationOn(on)));

export const setLaunchQuantization = (id: string): Edit =>
  edit('Launch quantization', p => (p.launchQuantization === id ? p : p.withLaunchQuantization(id)));

/** The project you start with, as in Live: a MIDI track, an audio one and two buses. */
export function starterProject(name: string, ids: IdFactory): Project {
  const ctx = { ids };
  return [addTrack('midi'), addTrack('audio'), addBus(), addBus()].reduce((p, e) => e.apply(p, ctx), Project.empty(name, ids));
}

// ------------------------------------------------------------------ tracks

/** Track factories by kind: adding a track kind is adding an entry. */
const trackFactories = {
  audio: { label: 'Audio', create: AudioTrack.empty },
  midi: { label: 'MIDI', create: MidiTrack.empty },
} as const;

export type TrackKind = keyof typeof trackFactories;

/** Where a new track goes: right after a track (and what it contains), in its same
 *  group, or at the end of a group. Without: at the end of the project. */
export type TrackPlace = { readonly after: TrackId } | { readonly inGroup: TrackId };

export const addTrack = (kind: TrackKind, place?: TrackPlace): Edit =>
  edit(`New ${trackFactories[kind].label} track`, (p, { ids }) => {
    const { label, create } = trackFactories[kind];
    const n = p.tracks.filter(t => t.kind === kind).length + 1;
    const track = create(ids.next('track'), `${n} ${label}`, paletteColor(p.tracks.length), p.scenes.length);
    if (!place) return p.addingTrack(track);
    const [at, group] = 'after' in place ? [place.after, p.track(place.after)?.group ?? null] : [place.inGroup, place.inGroup];
    return p.addingTrack(track.withGroup(group), p.blockEnd(at));
  });

export const removeTrack = (id: TrackId): Edit =>
  edit('Delete track', p => p.removingTrack(id));

// ------------------------------------------------------------------ bus

/** Adds a bus at the end of the buses: "A Bus", "B Bus"… (the first free letter from there). */
export const addBus = (): Edit =>
  edit('New bus', (p, { ids }) => {
    const taken = new Set(p.buses.map(b => b.name));
    let n = p.buses.length;
    while (taken.has(`${busLetter(n)} Bus`)) n++;
    return p.addingBus(BusTrack.empty(ids.next('track'), `${busLetter(n)} Bus`, paletteColor(p.tracks.length + p.buses.length)));
  });

/** The level of the track's send to the bus, in dB (down to SEND_OFF_DB: closed). */
export const setSend = (track: TrackId, bus: TrackId, db: number): Edit =>
  edit('Send', p => {
    if (!(p.track(bus) instanceof BusTrack)) throw new Error(`the track ${bus} isn't a bus`);
    return p.updatingTrack(track, t => {
      if (t instanceof BusTrack) throw new TypeError(`the bus ${t.name} has no sends`);
      return t.withSend(bus, db);
    });
  });

// ------------------------------------------------------------------ groups

/** Groups the tracks into a new group (Ctrl+G), which takes the place of the first. */
export const groupTracks = (ids: Iterable<TrackId>): Edit =>
  edit('Group tracks', (p, { ids: f }) => {
    const n = p.tracks.filter(t => t instanceof GroupTrack).length + 1;
    return p.groupingTracks(ids, GroupTrack.empty(f.next('track'), `${n} Group`, paletteColor(p.tracks.length), p.scenes.length));
  });

/** Removes the group, its tracks stay (Ctrl+Shift+G). */
export const ungroupTracks = (group: TrackId): Edit => edit('Ungroup', p => p.ungroupingTrack(group));

/** Closes or opens a group: closed, its tracks aren't visible but they play. */
export const setGroupFolded = (group: TrackId, folded: boolean): Edit =>
  edit(folded ? 'Close group' : 'Open group', p => p.updatingTrack(group, t => {
    if (!(t instanceof GroupTrack)) throw new TypeError(`the track ${t.name} isn't a group`);
    return t.withFolded(folded);
  }));

/** Where to drop a dragged track: before a track or after a track (and what it
 *  contains), in that one's group; at the top of a group's tracks; at the end, outside the groups. */
export type TrackDrop =
  | { readonly before: TrackId } | { readonly after: TrackId } | { readonly first: TrackId } | { readonly end: true };

/** Moves the track (a group with its tracks) where it was dropped. */
export const moveTrack = (id: TrackId, drop: TrackDrop): Edit => edit('Move track', p => {
  const moved = new Set(p.trackBlock(id).map(t => t.id));
  const rest = p.tracks.filter(t => !moved.has(t.id));
  const at = (anchor: TrackId) => {
    if (moved.has(anchor)) throw new Error('a track doesn\'t go inside itself');
    return rest.findIndex(t => t.id === anchor);
  };
  if ('end' in drop) return p.movingTrack(id, rest.length, null);
  if ('first' in drop) return p.movingTrack(id, at(drop.first) + 1, drop.first);
  if ('before' in drop) return p.movingTrack(id, at(drop.before), p.track(drop.before)!.group);
  // after the track and all those of its group, in the group containing it
  let end = at(drop.after) + 1;
  while (end < rest.length && p.isInGroup(rest[end].id, drop.after)) end++;
  return p.movingTrack(id, end, p.track(drop.after)!.group);
});

/** Moves the bus to `toIndex` among the other buses. */
export const moveBus = (id: TrackId, toIndex: number): Edit => edit('Move bus', p => p.movingBus(id, toIndex));

/** Collapses or expands a bus's column in the session. */
export const setBusFolded = (bus: TrackId, folded: boolean): Edit =>
  edit(folded ? 'Collapse bus' : 'Expand bus', p => p.updatingTrack(bus, t => {
    if (!(t instanceof BusTrack)) throw new TypeError(`the track ${t.name} isn't a bus`);
    return t.withFolded(folded);
  }));

export const renameTrack = (id: TrackId, name: string): Edit =>
  edit('Rename track', p => p.updatingTrack(id, t => t.withName(name)));

export const setMixer = (id: TrackId, patch: Partial<MixerSettings>): Edit =>
  edit('Mixer', p => p.updatingTrack(id, t => t.withMixer(patch)));

/** The master's volume and mute. */
export const setMasterMixer = (patch: Partial<Pick<MixerSettings, 'volumeDb' | 'mute'>>): Edit =>
  edit('Master', p => p.withMaster(patch));

// ------------------------------------------------------------------ strumenti

const updatingInstrument = (label: string, id: TrackId, fn: (s: InstrumentSettings) => InstrumentSettings): Edit =>
  edit(label, p => p.updatingTrack(id, t => {
    if (!(t instanceof MidiTrack)) throw new TypeError(`the track ${t.name} has no instrument`);
    return t.withInstrument(fn(t.instrument));
  }));

/** Changes the instrument; if it's of another type, the macros that moved it let it go. */
export const setInstrument = (id: TrackId, settings: InstrumentSettings): Edit =>
  edit('Instrument', p => {
    const before = p.track(id);
    const next = p.updatingTrack(id, t => {
      if (!(t instanceof MidiTrack)) throw new TypeError(`the track ${t.name} has no instrument`);
      const same = settings.type === t.instrument.type;
      const racks = same ? t.racks : withoutMappingsOf(t.racks, INSTRUMENT_DEVICE);
      return t.withInstrument(settings).withChain(same ? t.effects : withoutTargetsOf(t.effects, INSTRUMENT_DEVICE), racks);
    });
    // another instrument has other parameters: their keys and MIDI controls no longer apply
    const same = before instanceof MidiTrack && before.instrument.type === settings.type;
    return same ? next : next.updatingKeyMap(map => withoutParamKeysOf(map, id, INSTRUMENT_DEVICE))
      .updatingMidiMap(map => withoutParamControlsOf(map, id, INSTRUMENT_DEVICE));
  });

export const setInstrumentParam = (id: TrackId, param: string, value: number): Edit =>
  updatingInstrument('Instrument parameter', id, s => withParam(s, param, value));

/** Several instrument parameters together (e.g. a pad's sound with its values). */
export const setInstrumentParams = (id: TrackId, values: ParamValues): Edit =>
  updatingInstrument('Instrument parameters', id, s => withParams(s, values));

/** The instrument takes the sound of a clip that started (only of the same type: the engine
 *  ignores the others). It's applied as a change that isn't undone, like a program change. */
export const followClipSound = (id: TrackId, sound: InstrumentSettings): Edit =>
  edit('Clip sound', p => {
    const t = p.track(id);
    if (!(t instanceof MidiTrack) || t.instrument === sound || t.instrument.type !== sound.type) return p;
    return p.updatingTrack(id, () => t.withInstrument(sound));
  });

/** Samples in the instrument, by slot (null: removed), together with the parameters needed to play them
 *  (e.g. the pad's Sample model): a single step. A new sample also enters the project. */
export const setInstrumentSamples = (id: TrackId, changes: Readonly<Record<string, SampleRef | SampleId | null>>, values: ParamValues = {}): Edit =>
  edit('Instrument samples', p => {
    let next = p;
    const ids: Record<string, SampleId | null> = {};
    for (const [slot, s] of Object.entries(changes)) {
      if (s && typeof s === 'object' && !next.sample(s.id)) next = next.addingSample(s);
      ids[slot] = s && typeof s === 'object' ? s.id : s;
    }
    return next.updatingTrack(id, t => {
      if (!(t instanceof MidiTrack)) throw new TypeError(`the track ${t.name} has no instrument`);
      const settings = Object.entries(ids).reduce((s, [slot, sample]) => withSample(s, slot, sample), withParams(t.instrument, values));
      return t.withInstrument(settings);
    });
  });

/** Loads a preset: the parameters go back to the type's defaults plus the preset's (those
 *  mapped to a macro stay where the macro holds them). */
export const loadPreset = (id: TrackId, name: string, params: ParamValues): Edit =>
  edit(`Preset ${name}`, (p, ctx) => reapplyMacros(updatingInstrument('', id, s => withPreset(s, name, params)).apply(p, ctx), id));

// ------------------------------------------------------------------ effects
// They apply to a track's chain and to the master's (`owner`).

const updatingEffect = (label: string, owner: ChainOwner, id: DeviceId, fn: (e: EffectSettings) => EffectSettings): Edit =>
  edit(label, p => p.updatingEffects(owner, list => chain.update(list, id, fn)));

/** Adds an effect of type `type` to the chain (at the end, or at position `index`). */
export const addEffect = (owner: ChainOwner, type: string, label: string, index?: number): Edit =>
  edit(`Add ${label}`, (p, { ids }) => p.updatingEffects(owner, list => chain.add(list, newEffect(ids.next('device'), type), index)));

export const removeEffect = (owner: ChainOwner, id: DeviceId): Edit =>
  edit('Delete effect', p => p.updatingEffects(owner, list => chain.remove(list, id)));

export const moveEffect = (owner: ChainOwner, id: DeviceId, index: number): Edit =>
  edit('Move effect', p => p.updatingEffects(owner, list => chain.move(list, id, index)));

export const setEffectEnabled = (owner: ChainOwner, id: DeviceId, enabled: boolean): Edit =>
  updatingEffect(enabled ? 'Turn the effect on' : 'Turn the effect off', owner, id, e => ({ ...e, enabled }));

export const setEffectParam = (owner: ChainOwner, id: DeviceId, param: string, value: number): Edit =>
  updatingEffect('Effect parameter', owner, id, e => withParam(e, param, value));

export const setEffectParams = (owner: ChainOwner, id: DeviceId, values: ParamValues): Edit =>
  updatingEffect('Effect parameters', owner, id, e => withParams(e, values));

/** The effect's detector listens to track `source` (null: its own input again). */
export const setEffectSidechain = (owner: ChainOwner, id: DeviceId, source: TrackId | null): Edit =>
  updatingEffect(source ? 'Sidechain' : 'Remove the sidechain', owner, id, e => withSidechain(e, source));

/** Target `slot` (from 0) of a modulator moves `target` (null: frees it); with
 *  `amount` also its amount (in %). */
export const setModTarget = (owner: ChainOwner, id: DeviceId, slot: number, target: ModTarget | null, amount?: number): Edit =>
  updatingEffect(target ? 'Modulator target' : 'Remove the target', owner, id, e => {
    const next = withTarget(e, slot, target);
    return amount === undefined ? next : withParam(next, linkAmount(slot + 1), amount);
  });

export const loadEffectPreset = (owner: ChainOwner, id: DeviceId, name: string, params: ParamValues): Edit =>
  edit(`Preset ${name}`, p => reapplyMacros(p.updatingEffects(owner, list => chain.update(list, id, e => withPreset(e, name, params))), owner));

// ------------------------------------------------------------------ sample e clip

export const addSample = (sample: SampleRef): Edit => edit('Import sample', p => p.addingSample(sample));

/** Puts on the timeline a clip with the whole sample, starting from `start`. */
export const placeSample = (trackId: TrackId, sampleId: SampleId, start: Beats): Edit =>
  edit('Insert audio clip', (p, { ids }) => {
    const sample = p.sample(sampleId);
    if (!sample) throw new Error(`sample ${sampleId} not found`);
    const track = p.track(trackId);
    const clip = AudioClip.fromSample(ids.next('clip'), sample, track?.color ?? paletteColor(0));
    return p.updatingTrack(trackId, t => t.placing(fullPlacement(ids.next('placement'), clip, start), ids));
  });

export const addMidiClip = (trackId: TrackId, start: Beats, length: Beats): Edit =>
  edit('New MIDI clip', (p, { ids }) => p.updatingTrack(trackId, t => {
    const clip = MidiClip.empty(ids.next('clip'), 'Clip MIDI', t.color, length);
    return t.placing({ id: ids.next('placement'), clip, start, length, offset: 0 }, ids);
  }));

/** Moves a clip on the timeline, also onto another track of the same kind. */
export const movePlacement = (from: TrackId, id: PlacementId, start: Beats, to: TrackId = from): Edit =>
  edit('Move clip', (p, { ids }) => {
    const placement = requirePlacement(p.track(from), id);
    const moved = { ...placement, start: Math.max(0, start) };
    if (to === from) return p.updatingTrack(from, t => t.updatingPlacement(id, () => moved, ids));
    return p
      .updatingTrack(from, t => t.removingPlacement(id))
      .updatingTrack(to, t => t.placing(moved, ids));
  });

/** Changes a placed clip's edges: moving the start also changes the offset, so the
 *  content stays still on the timeline (like dragging the left edge in Live). */
export const resizePlacement = (trackId: TrackId, id: PlacementId, edges: { start?: Beats; end?: Beats }): Edit =>
  edit('Resize clip', (p, { ids }) => p.updatingTrack(trackId, t => t.updatingPlacement(id, pl => {
    const start = Math.max(edges.start ?? pl.start, pl.start - pl.offset);
    const end = edges.end ?? placementEnd(pl);
    return { ...pl, start, length: end - start, offset: pl.offset + (start - pl.start) };
  }, ids)));

/** The fades of a placed audio clip (0 removes one). */
export const setFades = (trackId: TrackId, id: PlacementId, fades: { fadeIn?: Beats; fadeOut?: Beats }): Edit =>
  edit('Fade', (p, { ids }) => p.updatingTrack(trackId, t => t.updatingPlacement(id, pl => ({ ...pl, ...fades }), ids)));

export const splitPlacement = (trackId: TrackId, id: PlacementId, at: Beats): Edit =>
  edit('Split clip', (p, { ids }) => p.updatingTrack(trackId, t => t.splitting(id, at, ids)));

export const deletePlacement = (trackId: TrackId, id: PlacementId): Edit =>
  edit('Delete clip', p => p.updatingTrack(trackId, t => t.removingPlacement(id)));

/** Copies the clip right after the original, with an independent copy of the content. */
export const duplicatePlacement = (trackId: TrackId, id: PlacementId): Edit =>
  edit('Duplicate clip', (p, { ids }) => p.updatingTrack(trackId, t => {
    const pl = requirePlacement(t, id);
    const copy = { ...pl, id: ids.next('placement'), clip: pl.clip.withId(ids.next('clip')), start: placementEnd(pl) };
    return t.placing(copy, ids);
  }));

/** Changes the content of a placed clip (warp, notes, name…). */
export const updateClip = <C extends Clip>(label: string, trackId: TrackId, id: PlacementId, fn: (c: C) => Clip): Edit =>
  edit(label, (p, { ids }) => p.updatingTrack(trackId, t => t.updatingPlacement(id, pl => ({ ...pl, clip: fn(pl.clip as C) }), ids)));

/** Scales the time of a placed MIDI clip (see MidiClip.scaledTime) and with it its length
 *  on the timeline: the start stays still, the clip lengthens or shortens. */
export const scaleMidiPlacement = (label: string, trackId: TrackId, id: PlacementId, factor: number): Edit =>
  edit(label, (p, { ids }) => p.updatingTrack(trackId, t => t.updatingPlacement(id, pl => ({
    ...pl, clip: (pl.clip as unknown as MidiClip).scaledTime(factor), length: pl.length * factor, offset: pl.offset * factor,
  }), ids)));

/** "Dupl. Loop" on a placed MIDI clip (see MidiClip.duplicatingLoop). If the clip on the timeline
 *  ended right at the end of the loop, it lengthens to let the copy be heard; longer, it stays as it is. */
export const duplicateLoopPlacement = (trackId: TrackId, id: PlacementId): Edit =>
  edit('Duplicate loop', (p, { ids }) => p.updatingTrack(trackId, t => t.updatingPlacement(id, pl => {
    const clip = pl.clip as unknown as MidiClip;
    const { start, end } = clip.loop.enabled ? clip.loop : clip.region;
    const endsAtLoop = Math.abs(clip.region.start + pl.offset + pl.length - end) < 1e-9;
    return { ...pl, clip: clip.duplicatingLoop(), length: pl.length + (endsAtLoop ? end - start : 0) };
  }, ids)));

// ------------------------------------------------------------------ session

export const setSlot = (trackId: TrackId, sceneIndex: number, clip: Clip | null): Edit =>
  edit(clip ? 'Clip in the session' : 'Clear slot', p => p.updatingTrack(trackId, t => t.withSlot(sceneIndex, clip)));

export const addScene = (index?: number): Edit =>
  edit('New scene', (p, { ids }) => p.addingScene({ id: ids.next('scene'), name: String(p.scenes.length + 1) }, index));

export const removeScene = (id: SceneId): Edit => edit('Delete scene', p => p.removingScene(id));

// ------------------------------------------------------------------ helpers

function fullPlacement(id: PlacementId, clip: Clip, start: Beats): Placement {
  return { id, clip, start: Math.max(0, start), length: clip.region.end - clip.region.start, offset: 0 };
}

function requirePlacement(track: Track | undefined, id: PlacementId): Placement {
  const pl = track?.placement(id);
  if (!pl) throw new Error(`clip ${id} not found`);
  return pl;
}
