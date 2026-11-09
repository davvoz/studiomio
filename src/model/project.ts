import type { IdFactory, ProjectId, SampleId, SceneId, TrackId } from '../core/id';
import { Tempo, TimeSignature, type Beats } from '../core/music-time';
import { AudioClip } from './audio-clip';
import type { Color } from './clip';
import { deviceSampleIds, withSidechain, type DeviceSettings } from './device';
import { sameTarget, withEnvelope, type ClipEnvelope, type EnvelopePoint, type ModTarget } from './envelope';
import type { EffectList } from './effect-list';
import { checkKeyMap, NO_KEYS, type KeyMap, type KeyTarget } from './key-map';
import { DEFAULT_LAUNCH_QUANTUM } from './launch';
import { MidiClip } from './midi-clip';
import { checkMidiMap, NO_MIDI, type MidiMap, type MidiTarget } from './midi-map';
import { checkRacks, findRack, NO_RACKS, pruneRacks, type DeviceKey, type RackList } from './rack';
import type { SampleRef } from './sample';
import { BusTrack, DEFAULT_MIXER, GroupTrack, type MixerSettings, type Track } from './track';

export interface Scene {
  readonly id: SceneId;
  readonly name: string;
  /** Colour chosen by the user (absent: the scene has no colour). */
  readonly color?: Color;
}

/** The master, as the owner of an effect chain next to the tracks. */
export const MASTER = 'master' as const;

/** Who has an effect chain: a track or the master. */
export type ChainOwner = TrackId | typeof MASTER;

/** The timeline's loop region. */
export interface LoopRegion {
  readonly enabled: boolean;
  readonly start: Beats;
  readonly end: Beats;
}

export interface ProjectProps {
  readonly id: ProjectId;
  readonly name: string;
  readonly tempo: Tempo;
  readonly signature: TimeSignature;
  readonly tracks: readonly Track[];
  /** The buses, after the tracks (absent: none). */
  readonly buses?: readonly BusTrack[];
  readonly scenes: readonly Scene[];
  readonly samples: readonly SampleRef[];
  readonly loop: LoopRegion;
  /** The master's volume and mute (pan and solo aren't used). */
  readonly master: MixerSettings;
  /** Effects on the mix of all the tracks, before the master's volume. */
  readonly masterEffects: EffectList;
  /** The racks of the master's chain (absent: none). */
  readonly masterRacks?: RackList;
  /** The master's curves on the timeline (absent: none): like the clip modulations, but in
   *  timeline beats, on a parameter of a master effect or a macro of one of its racks. */
  readonly masterAutomation?: readonly ClipEnvelope[];
  /** Launch quantization of the session clips (an id of LAUNCH_QUANTA). */
  readonly launchQuantization: string;
  /** The computer keys on macros and parameters (absent: none). */
  readonly keyMap?: KeyMap;
  /** The MIDI controls on macros, parameters and mixer (absent: none). */
  readonly midiMap?: MidiMap;
}

const NO_BUSES: readonly BusTrack[] = [];
const NO_AUTOMATION: readonly ClipEnvelope[] = [];

/** Root of the model. Immutable: every change returns a new project that
 *  shares with the old one all the untouched parts (useful for undo/redo and to
 *  understand what changed by comparing references). It guarantees the rules that
 *  involve several parts: each track has one slot per scene, the used samples exist. */
export class Project {
  private readonly props: ProjectProps;
  /** The visible tracks, computed at the first request (the project doesn't change). */
  private visible: readonly Track[] | null = null;
  /** Tracks and buses together, computed at the first request. */
  private allChannels: readonly Track[] | null = null;
  /** The keyboard mappings that apply, computed at the first request. */
  private liveKeys: KeyMap | null = null;
  /** The MIDI mappings that apply, computed at the first request. */
  private liveMidi: MidiMap | null = null;

  private constructor(props: ProjectProps) {
    this.props = props;
  }

  static create(props: ProjectProps): Project {
    const p = new Project(props);
    p.validate();
    return p;
  }

  static empty(name: string, ids: IdFactory, sceneCount = 8): Project {
    return Project.create({
      id: ids.next('project'), name,
      tempo: new Tempo(120), signature: TimeSignature.COMMON,
      tracks: [],
      scenes: Array.from({ length: sceneCount }, (_, i) => ({ id: ids.next('scene'), name: String(i + 1) })),
      samples: [],
      loop: { enabled: false, start: 0, end: 16 },
      master: DEFAULT_MIXER,
      masterEffects: [],
      launchQuantization: DEFAULT_LAUNCH_QUANTUM,
    });
  }

  private with(patch: Partial<ProjectProps>): Project {
    return new Project({ ...this.props, ...patch });
  }

  get id(): ProjectId { return this.props.id; }
  get name(): string { return this.props.name; }
  get tempo(): Tempo { return this.props.tempo; }
  get signature(): TimeSignature { return this.props.signature; }
  get tracks(): readonly Track[] { return this.props.tracks; }
  get buses(): readonly BusTrack[] { return this.props.buses ?? NO_BUSES; }
  /** The mixer channels that have a chain: the tracks and then the buses. */
  get channels(): readonly Track[] {
    return (this.allChannels ??= this.buses.length ? [...this.tracks, ...this.buses] : this.tracks);
  }
  get scenes(): readonly Scene[] { return this.props.scenes; }
  get samples(): readonly SampleRef[] { return this.props.samples; }
  get loop(): LoopRegion { return this.props.loop; }
  get master(): MixerSettings { return this.props.master; }
  get masterEffects(): EffectList { return this.props.masterEffects; }
  get masterRacks(): RackList { return this.props.masterRacks ?? NO_RACKS; }
  get masterAutomation(): readonly ClipEnvelope[] { return this.props.masterAutomation ?? NO_AUTOMATION; }
  get launchQuantization(): string { return this.props.launchQuantization; }

  /** The keyboard mappings whose racks and devices exist (the others wait for an
   *  "Undo" bringing them back). */
  get keyMap(): KeyMap {
    const all = this.props.keyMap ?? NO_KEYS;
    if (this.liveKeys) return this.liveKeys;
    const live = all.filter(m => this.hasKeyTarget(m.target));
    return (this.liveKeys = live.length === all.length ? all : live);
  }

  hasKeyTarget(t: KeyTarget): boolean {
    if (t.owner !== MASTER && !this.track(t.owner)) return false;
    return t.kind === 'macro' ? !!findRack(this.racksOf(t.owner), t.rack) : this.chainKeys(t.owner).includes(t.device);
  }

  /** The keyboard mappings (fn receives all the written ones, also those that don't apply). */
  updatingKeyMap(fn: (map: KeyMap) => KeyMap): Project {
    const before = this.props.keyMap ?? NO_KEYS;
    const keyMap = fn(before);
    if (keyMap === before) return this;
    checkKeyMap(keyMap);
    return this.with({ keyMap: keyMap.length ? keyMap : undefined });
  }

  /** The MIDI mappings whose targets exist (the others, as for the keyboard, wait for an
   *  "Undo" bringing them back). */
  get midiMap(): MidiMap {
    const all = this.props.midiMap ?? NO_MIDI;
    if (this.liveMidi) return this.liveMidi;
    const live = all.filter(m => this.hasMidiTarget(m.target));
    return (this.liveMidi = live.length === all.length ? all : live);
  }

  hasMidiTarget(t: MidiTarget): boolean {
    if (t.kind === 'macro' || t.kind === 'param') return this.hasKeyTarget(t);
    if (t.kind === 'send') {
      const track = this.track(t.owner);
      return !!track && !(track instanceof BusTrack) && this.buses.some(b => b.id === t.bus);
    }
    if (t.owner === MASTER) return t.control === 'volume' || t.control === 'mute';
    return !!this.track(t.owner);
  }

  /** The MIDI mappings (fn receives all the written ones, also those that don't apply). */
  updatingMidiMap(fn: (map: MidiMap) => MidiMap): Project {
    const before = this.props.midiMap ?? NO_MIDI;
    const midiMap = fn(before);
    if (midiMap === before) return this;
    checkMidiMap(midiMap);
    return this.with({ midiMap: midiMap.length ? midiMap : undefined });
  }

  /** The track, or the bus, with this id. */
  track(id: TrackId): Track | undefined {
    return this.tracks.find(t => t.id === id) ?? this.buses.find(b => b.id === id);
  }

  sample(id: SampleId): SampleRef | undefined {
    return this.samples.find(s => s.id === id);
  }

  /** The names of the samples loaded in a device, by slot. */
  sampleNames(device: DeviceSettings): Map<string, string> {
    return new Map(Object.entries(device.samples ?? {}).flatMap(([slot, id]) => {
      const s = this.sample(id);
      return s ? [[slot, s.name] as const] : [];
    }));
  }

  /** End of the last clip on the timeline. */
  get arrangementEnd(): Beats {
    return this.tracks.reduce((m, t) => Math.max(m, t.arrangementEnd), 0);
  }

  /** Samples used by at least one audio clip. */
  /** The samples used by the audio clips and the devices (e.g. the Drum Machine's pads). */
  usedSampleIds(): Set<SampleId> {
    const all = this.tracks.flatMap(t => t.clips);
    const clips = all.filter(c => c instanceof AudioClip).map(c => c.sample);
    // also the sounds of the MIDI clips: their samples must stay in the project
    const sounds = all.flatMap(c => (c instanceof MidiClip && c.sound ? [c.sound] : []));
    const devices = [...this.channels.flatMap(t => t.devices), ...this.masterEffects, ...sounds].flatMap(deviceSampleIds);
    return new Set([...clips, ...devices]);
  }

  withName(name: string): Project { return this.with({ name }); }
  withTempo(bpm: number): Project { return this.with({ tempo: new Tempo(bpm) }); }
  withSignature(signature: TimeSignature): Project { return this.with({ signature }); }
  withMaster(patch: Partial<MixerSettings>): Project { return this.with({ master: { ...this.master, ...patch } }); }
  withLaunchQuantization(id: string): Project { return this.with({ launchQuantization: id }); }

  /** The master's curve on `target` (timeline beats); without points it removes it. A
   *  target that's gone stays in the file, and doesn't play, until an "Undo" brings it back. */
  withMasterAutomation(target: ModTarget, points: readonly EnvelopePoint[]): Project {
    if (target.kind !== 'device') throw new Error('the master is modulated only on the devices');
    const list = withEnvelope(this.masterAutomation, target, points);
    return this.with({ masterAutomation: list.length ? list : undefined });
  }

  /** The master's curve on `target`, if any. */
  masterCurve(target: ModTarget): ClipEnvelope | undefined {
    return this.masterAutomation.find(e => sameTarget(e.target, target));
  }

  withLoop(patch: Partial<LoopRegion>): Project {
    const loop = { ...this.loop, ...patch };
    if (!(loop.end > loop.start)) throw new RangeError('empty loop region');
    return this.with({ loop });
  }

  // ---------------------------------------------------------------- effects

  /** The chain of a track or of the master. */
  effectsOf(owner: ChainOwner): EffectList {
    return owner === MASTER ? this.masterEffects : this.requireTrack(owner).effects;
  }

  /** The racks of the chain of a track or of the master. */
  racksOf(owner: ChainOwner): RackList {
    return owner === MASTER ? this.masterRacks : this.requireTrack(owner).racks;
  }

  /** The chain's devices in the order of the sound ("instrument" for the instrument). */
  chainKeys(owner: ChainOwner): readonly DeviceKey[] {
    return owner === MASTER ? this.masterEffects.map(e => e.id) : this.requireTrack(owner).chainKeys;
  }

  /** Changes the chain of a track or of the master (the operations are in `effect-list`); the
   *  removed effects leave their racks. */
  updatingEffects(owner: ChainOwner, fn: (list: EffectList) => EffectList): Project {
    if (owner !== MASTER) return this.updatingTrack(owner, t => t.withEffects(fn(t.effects)));
    const masterEffects = fn(this.masterEffects);
    if (masterEffects === this.masterEffects) return this;
    return this.updatingChain(MASTER, () => ({ effects: masterEffects, racks: pruneRacks(masterEffects.map(e => e.id), this.masterRacks) }));
  }

  /** Changes a chain's effects and racks together (the rack operations are in `rack`). */
  updatingChain(owner: ChainOwner, fn: (chain: { effects: EffectList; racks: RackList }) => { effects: EffectList; racks: RackList }): Project {
    const { effects, racks } = fn({ effects: this.effectsOf(owner), racks: this.racksOf(owner) });
    if (owner !== MASTER) return this.updatingTrack(owner, t => t.withChain(effects, racks));
    if (effects === this.masterEffects && racks === this.masterRacks) return this;
    checkRacks(effects.map(e => e.id), racks);
    return this.with({ masterEffects: effects, masterRacks: racks.length ? racks : undefined });
  }

  updatingRacks(owner: ChainOwner, fn: (racks: RackList) => RackList): Project {
    return this.updatingChain(owner, c => ({ effects: c.effects, racks: fn(c.racks) }));
  }

  // ---------------------------------------------------------------- tracks

  /** Adds a track (at the end, or at `index`), adapting its slots to the scenes. */
  addingTrack(track: Track, index = this.tracks.length): Project {
    if (this.track(track.id)) throw new Error(`track ${track.id} already present`);
    const tracks = [...this.tracks];
    tracks.splice(index, 0, this.fitted(track));
    return this.with({ tracks }).validated();
  }

  /** Removes the track; a group goes away with all its tracks. The effects that
   *  listened to them (sidechain) go back to listening to their own input; the sends to a removed bus
   *  are closed. */
  removingTrack(id: TrackId): Project {
    const track = this.requireTrack(id);
    const gone = new Set(track instanceof BusTrack ? [id] : this.trackBlock(id).map(t => t.id));
    const unkeyed = (list: EffectList): EffectList => (list.some(e => e.sidechain && gone.has(e.sidechain))
      ? list.map(e => (e.sidechain && gone.has(e.sidechain) ? withSidechain(e, null) : e)) : list);
    const kept = <T extends Track>(t: T): T => {
      const effects = unkeyed(t.effects);
      const next = effects === t.effects ? t : t.withEffects(effects);
      return track instanceof BusTrack ? next.withSend(id, -Infinity) : next;
    };
    return this.with({
      tracks: this.tracks.filter(t => !gone.has(t.id)).map(kept),
      buses: this.buses.filter(b => !gone.has(b.id)).map(kept),
      masterEffects: unkeyed(this.masterEffects),
    });
  }

  /** Moves the track (a group with its tracks) to `toIndex` among the remaining tracks,
   *  inside `group` (null: outside the groups; absent: the group containing it doesn't change). */
  movingTrack(id: TrackId, toIndex: number, group?: TrackId | null): Project {
    const track = this.requireTrack(id);
    if (track instanceof BusTrack) throw new Error(`the bus "${track.name}" doesn't belong among the tracks`);
    const block = this.trackBlock(id), moved = new Set(block.map(t => t.id));
    if (group && moved.has(group)) throw new Error(`the group "${track.name}" can't be inside itself`);
    const rest = this.tracks.filter(x => !moved.has(x.id));
    const root = group === undefined ? track : track.withGroup(group);
    rest.splice(Math.max(0, Math.min(rest.length, toIndex)), 0, root, ...block.slice(1));
    if (root === track && rest.every((t, i) => t === this.tracks[i])) return this;
    return this.with({ tracks: rest }).validated();
  }

  /** Changes a track (or a bus); the track's kind stays the one `fn` receives. */
  updatingTrack<T extends Track>(id: TrackId, fn: (t: T) => T): Project {
    const old = this.requireTrack(id) as T;
    const updated = fn(old);
    if (updated === old) return this;
    if (old instanceof BusTrack) return this.with({ buses: this.buses.map(b => (b.id === id ? updated as unknown as BusTrack : b)) }).validated();
    return this.with({ tracks: this.tracks.map(t => (t.id === id ? updated : t)) }).validated();
  }

  // ---------------------------------------------------------------- bus

  /** Adds a bus (at the end, or at `index` among the buses). */
  addingBus(bus: BusTrack, index = this.buses.length): Project {
    if (this.track(bus.id)) throw new Error(`track ${bus.id} already present`);
    const buses = [...this.buses];
    buses.splice(index, 0, bus);
    return this.with({ buses }).validated();
  }

  /** Moves the bus to `toIndex` among the remaining buses. */
  movingBus(id: TrackId, toIndex: number): Project {
    const bus = this.buses.find(b => b.id === id);
    if (!bus) throw new Error(`bus ${id} not found`);
    const buses = this.buses.filter(b => b !== bus);
    buses.splice(Math.max(0, Math.min(buses.length, toIndex)), 0, bus);
    return buses.every((b, i) => b === this.buses[i]) ? this : this.with({ buses });
  }

  // ---------------------------------------------------------------- groups
  // As in Live the tracks are a single list: a group comes right before its tracks,
  // which follow it (also other groups, with theirs).

  /** The visible tracks (timeline, session, controllers): not those inside a closed group. */
  get visibleTracks(): readonly Track[] {
    return (this.visible ??= this.tracks.filter(t => !this.groupsOf(t.id).some(g => g.folded)));
  }

  /** The groups containing the track, from the nearest to the outermost. */
  groupsOf(id: TrackId): GroupTrack[] {
    const out: GroupTrack[] = [];
    for (let g = this.track(id)?.group; g; ) {
      const group = this.track(g);
      if (!(group instanceof GroupTrack)) break;
      out.push(group);
      g = group.group;
    }
    return out;
  }

  /** True if the track is in the group, also inside a group of the group. */
  isInGroup(id: TrackId, group: TrackId): boolean {
    return this.groupsOf(id).some(g => g.id === group);
  }

  /** The track and, if it's a group, all those it contains: a contiguous stretch of the list. */
  trackBlock(id: TrackId): Track[] {
    const i = this.tracks.findIndex(t => t.id === id);
    if (i < 0) return [];
    let end = i + 1;
    while (end < this.tracks.length && this.isInGroup(this.tracks[end].id, id)) end++;
    return this.tracks.slice(i, end);
  }

  /** Where the track's block ends: the index of the first track not part of it. */
  blockEnd(id: TrackId): number {
    return this.tracks.findIndex(t => t.id === id) + this.trackBlock(id).length;
  }

  /** The tracks playing clips for `id`: the track itself or, for a group, its tracks
   *  that aren't groups (launching a group's slot launches the row of these). */
  soundingTracks(id: TrackId): Track[] {
    return this.trackBlock(id).filter(t => !(t instanceof GroupTrack));
  }

  /** Groups the tracks (with what they contain) into the new group `group`, like Ctrl+G in Live:
   *  the group takes the place of the first and sits where it was; the tracks follow it in order. */
  groupingTracks(ids: Iterable<TrackId>, group: GroupTrack): Project {
    if (this.track(group.id)) throw new Error(`track ${group.id} already present`);
    const chosen = new Set(ids);
    // a chosen track inside a chosen group goes with its group
    const roots = this.tracks.filter(t => chosen.has(t.id) && !this.groupsOf(t.id).some(g => chosen.has(g.id)));
    if (!roots.length) throw new Error('no tracks to group');
    const rootIds = new Set(roots.map(t => t.id));
    const moved = new Set(roots.flatMap(t => this.trackBlock(t.id)).map(t => t.id));
    const block = this.tracks.filter(t => moved.has(t.id)).map(t => (rootIds.has(t.id) ? t.withGroup(group.id) : t));
    const tracks = this.tracks.flatMap(t =>
      (t.id === roots[0].id ? [this.fitted(group.withGroup(roots[0].group)), ...block] : moved.has(t.id) ? [] : [t]));
    return this.with({ tracks }).validated();
  }

  /** Removes the group but not its tracks: they stay where they are, in the group that contained it. */
  ungroupingTrack(id: TrackId): Project {
    const g = this.requireTrack(id);
    if (!(g instanceof GroupTrack)) throw new TypeError(`the track ${g.name} isn't a group`);
    return this.with({ tracks: this.tracks.filter(t => t.id !== id).map(t => (t.group === id ? t.withGroup(g.group) : t)) }).validated();
  }

  // ---------------------------------------------------------------- scene

  addingScene(scene: Scene, index = this.scenes.length): Project {
    const scenes = [...this.scenes];
    scenes.splice(index, 0, scene);
    return this.with({ scenes, tracks: this.tracks.map(t => t.insertingSlot(index)) });
  }

  removingScene(id: SceneId): Project {
    const index = this.scenes.findIndex(s => s.id === id);
    if (index < 0) throw new Error(`scene ${id} not found`);
    return this.with({
      scenes: this.scenes.filter(s => s.id !== id),
      tracks: this.tracks.map(t => t.removingSlot(index)),
    });
  }

  /** Scene `id` at position `toIndex` (counted without it), with each track's slots. */
  movingScene(id: SceneId, toIndex: number): Project {
    const from = this.scenes.findIndex(s => s.id === id);
    if (from < 0) throw new Error(`scene ${id} not found`);
    const to = Math.max(0, Math.min(this.scenes.length - 1, toIndex));
    if (to === from) return this;
    const scenes = [...this.scenes];
    scenes.splice(to, 0, ...scenes.splice(from, 1));
    return this.with({ scenes, tracks: this.tracks.map(t => t.movingSlot(from, to)) });
  }

  renamingScene(id: SceneId, name: string): Project {
    return this.with({ scenes: this.scenes.map(s => (s.id === id ? { ...s, name } : s)) });
  }

  /** Colours the scene; without `color` it removes its colour. */
  recoloringScene(id: SceneId, color?: Color): Project {
    return this.with({
      scenes: this.scenes.map(s => {
        if (s.id !== id) return s;
        const { color: _, ...rest } = s;
        return color ? { ...rest, color } : rest;
      }),
    });
  }

  // ---------------------------------------------------------------- sample

  addingSample(sample: SampleRef): Project {
    if (this.sample(sample.id)) throw new Error(`sample ${sample.id} already present`);
    return this.with({ samples: [...this.samples, sample] });
  }

  updatingSample(id: SampleId, fn: (s: SampleRef) => SampleRef): Project {
    if (!this.sample(id)) throw new Error(`sample ${id} not found`);
    return this.with({ samples: this.samples.map(s => (s.id === id ? { ...fn(s), id } : s)) });
  }

  /** A sample can be removed only if no clip (or device) uses it. */
  removingSample(id: SampleId): Project {
    if (this.usedSampleIds().has(id)) throw new Error('the sample is used by at least one clip or device');
    return this.with({ samples: this.samples.filter(s => s.id !== id) });
  }

  /** Removes the samples no clip uses any more. */
  withoutUnusedSamples(): Project {
    const used = this.usedSampleIds();
    const samples = this.samples.filter(s => used.has(s.id));
    return samples.length === this.samples.length ? this : this.with({ samples });
  }

  // ---------------------------------------------------------------- rules

  private requireTrack(id: TrackId): Track {
    const t = this.track(id);
    if (!t) throw new Error(`track ${id} not found`);
    return t;
  }

  /** The track with one slot per scene. */
  private fitted(track: Track): Track {
    let t = track;
    while (t.slots.length < this.scenes.length) t = t.insertingSlot(t.slots.length);
    while (t.slots.length > this.scenes.length) t = t.removingSlot(t.slots.length - 1);
    return t;
  }

  private validated(): Project {
    this.validate();
    return this;
  }

  private validate(): void {
    const ids = new Set<string>();
    let previous: Track | null = null;
    for (const t of this.tracks) {
      if (ids.has(t.id)) throw new Error(`track ${t.id} duplicated`);
      if (t instanceof BusTrack) throw new Error(`the bus "${t.name}" is among the tracks`);
      if (t.group) {
        // the group comes first and its tracks follow it: before there's the group or another of its tracks
        if (!ids.has(t.group) || !(this.track(t.group) instanceof GroupTrack)) throw new Error(`the track "${t.name}" is in a group that doesn't exist`);
        if (previous!.id !== t.group && !this.isInGroup(previous!.id, t.group)) {
          throw new Error(`the track "${t.name}" doesn't follow the others of its group`);
        }
      }
      ids.add(t.id);
      previous = t;
      if (t.slots.length !== this.scenes.length) {
        throw new Error(`the track "${t.name}" has ${t.slots.length} slots but there are ${this.scenes.length} scenes`);
      }
      checkRacks(t.chainKeys, t.racks);
    }
    for (const b of this.buses) {
      if (!((b as Track) instanceof BusTrack)) throw new Error(`the track "${(b as Track).name}" is among the buses but isn't a bus`);
      if (ids.has(b.id)) throw new Error(`track ${b.id} duplicated`);
      if (b.group) throw new Error(`the bus "${b.name}" can't be in a group`);
      if (Object.keys(b.sends).length) throw new Error(`the bus "${b.name}" can't send to other buses`);
      ids.add(b.id);
      checkRacks(b.chainKeys, b.racks);
    }
    const buses = new Set(this.buses.map(b => b.id));
    for (const t of this.tracks) {
      for (const bus of Object.keys(t.sends)) if (!buses.has(bus as TrackId)) throw new Error(`the track "${t.name}" sends to a bus that doesn't exist`);
    }
    checkRacks(this.masterEffects.map(e => e.id), this.masterRacks);
    const known = new Set(this.samples.map(s => s.id));
    for (const id of this.usedSampleIds()) {
      if (!known.has(id)) throw new Error(`a clip or a device uses sample ${id}, which isn't in the project`);
    }
  }
}
