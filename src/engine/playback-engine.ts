import { Emitter, type Unsubscribe } from '../core/emitter';
import type { ClipId, DeviceId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { INSTRUMENT_DEVICE, scaleOf, targetKey, type ModTarget } from '../model/envelope';
import { mappingSpec, mappingTravel } from '../devices/rack-params';
import { launchQuantumBeats } from '../model/launch';
import { findRack, isSwitchMacro, MACRO_MAX, macroIndex, type Rack } from '../model/rack';
import { isArpType } from '../devices/arp/arp';
import { isModulatorType } from '../devices/modulators/modulators';
import type { EffectSettings, InstrumentSettings } from '../model/device';
import { MASTER, type ChainOwner, type Project } from '../model/project';
import { GroupTrack, type AudioTrack, type MidiTrack, type Track } from '../model/track';
import type { AudioGraph } from './audio-graph';
import type { EffectHost, EffectMonitor } from './effect-chain';
import type { MeterHost, MeterReading } from './meters';
import type { PlayableProvider } from './clip-audio';
import { MixerGraph } from './mixer-graph';
import { AudioTrackPlayer } from './players/audio-track-player';
import type { InstrumentHost } from './players/instrument';
import { Metronome } from './players/metronome';
import { MidiTrackPlayer } from './players/midi-track-player';
import { TransportAnchors } from './players/transport-anchors';
import { ChainModulators } from './device-modulators';
import { ModTraces } from './mod-trace';
import { audioParamSink, MasterModulator, scaledSinks, switchSink, TrackModulator, type ModSink } from './modulation';
import { NoteActivity } from './note-activity';
import type { PlayerContext, TrackPlayer } from './players/track-player';
import { Scheduler, type ScheduledSource } from './scheduler';
import { mergedState, Session, slotClip, type TrackSessionState } from './session';

/** Services the players need. */
export interface EngineServices {
  readonly clips: PlayableProvider;
  readonly instruments: InstrumentHost;
  readonly effects: EffectHost;
  /** Level meters of tracks and master (live only). */
  readonly meters?: MeterHost;
}

export type PlayerFactory = (track: Track, ctx: PlayerContext, services: EngineServices) => TrackPlayer;

/** One player per track kind: a new kind is added here (or by passing your own table). */
export const defaultPlayers: Readonly<Record<string, PlayerFactory>> = {
  audio: (t, ctx, s) => new AudioTrackPlayer(t as AudioTrack, ctx, s.clips),
  midi: (t, ctx, s) => new MidiTrackPlayer(t as MidiTrack, ctx, s.instruments),
};

export interface Timer {
  every(ms: number, fn: () => void): () => void;
}

export const intervalTimer: Timer = {
  every: (ms, fn) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
};

export interface EngineOptions {
  readonly timer?: Timer;
  readonly players?: Readonly<Record<string, PlayerFactory>>;
  /** Scheduling lookahead, in seconds. */
  readonly lookahead?: number;
  /** Delay between the play command and the first sound, in seconds. */
  readonly startLatency?: number;
  /** How often the scheduler schedules, in milliseconds. */
  readonly tickMs?: number;
}

type EngineEvents = {
  state: [playing: boolean];
  /** A clip launched or stopped, a return to the arrangement. */
  session: [];
  /** The track's instrument took the sound of a starting clip. */
  sound: [track: TrackId, sound: InstrumentSettings];
};

/** Transport and playback of the project. It receives each new version of the project with
 *  `setProject`: updates mixer and players and, if it's playing and something audible
 *  changed, reschedules from a moment later without interrupting anything: only the changed tracks,
 *  or everything if tempo or loop change. It plays the timeline and the clips launched
 *  in the session, quantized on the transport's continuous clock. */
export class PlaybackEngine {
  private project: Project | null = null;
  private readonly mixer: MixerGraph;
  private readonly players = new Map<TrackId, { kind: string; player: TrackPlayer }>();
  /** The tracks of the previous version, to understand what changed. */
  private previousTracks = new Map<TrackId, Track>();
  private readonly metronome: Metronome;
  /** Where the transport is, for the effects that follow the bar. */
  private readonly anchors: TransportAnchors;
  private readonly scheduler: Scheduler;
  private readonly events = new Emitter<EngineEvents>();
  private readonly timer: Timer;
  private readonly factories: Readonly<Record<string, PlayerFactory>>;
  private readonly startLatency: number;
  private readonly tickMs: number;
  private cancelTimer: (() => void) | null = null;
  private cursor: Beats = 0;
  /** The tracks with a stretch not started (or started with the provisional audio) because its
   *  audio wasn't ready. */
  private readonly missed = new Set<TrackId>();
  private readonly session = new Session();
  /** Each track's scheduled notes, for the interface. */
  private readonly activity = new Map<TrackId, NoteActivity>();
  /** The clip modulations, one source per track. */
  private readonly modulators = new Map<TrackId, TrackModulator>();
  /** The master's curves on the timeline. */
  private readonly masterModulator: MasterModulator;
  /** What the curves scheduled on each target, for the knobs following them. */
  private readonly traces: ModTraces;
  /** The modulators (LFO, Envelope) of each chain with at least one. */
  private readonly chainMods = new Map<ChainOwner, ChainModulators>();

  constructor(private readonly graph: AudioGraph, private readonly services: EngineServices, opts: EngineOptions = {}) {
    this.timer = opts.timer ?? intervalTimer;
    this.factories = opts.players ?? defaultPlayers;
    this.startLatency = opts.startLatency ?? 0.05;
    this.tickMs = opts.tickMs ?? 25;
    this.mixer = new MixerGraph(graph, services.effects, graph.destination, services.meters ?? null);
    this.metronome = new Metronome(graph, this.mixer.master, () => this.project!.signature);
    this.anchors = new TransportAnchors(a => {
      services.effects.transport?.(graph, a);
      services.instruments.transport?.(graph, a);
    }, () => this.project?.signature.beatsPerBar ?? 4);
    this.scheduler = new Scheduler(() => this.sources(), opts.lookahead ?? 0.2);
    this.masterModulator = new MasterModulator([], target => this.modSink(MASTER, target), () => this.graph.currentTime);
    this.traces = new ModTraces(() => this.graph.currentTime);
  }

  get playing(): boolean {
    return this.scheduler.running;
  }

  /** The beat heard now (or where play will start from). */
  get position(): Beats {
    return (this.playing ? this.scheduler.positionAt(this.graph.currentTime) : null) ?? this.cursor;
  }

  get metronomeOn(): boolean {
    return this.metronome.enabled;
  }

  set metronomeOn(on: boolean) {
    this.metronome.enabled = on;
  }

  /** Levels of a track or the master since the last read (null without meters). */
  levels(owner: ChainOwner): MeterReading | null {
    return this.mixer.levels(owner);
  }

  /** Where to listen to a playing effect from (for the spectrum). */
  effectMonitor(owner: ChainOwner, id: DeviceId): EffectMonitor | null {
    return this.mixer.effect(owner, id)?.monitor ?? null;
  }

  onStateChange(fn: (playing: boolean) => void): Unsubscribe {
    return this.events.on('state', fn);
  }

  onSessionChange(fn: () => void): Unsubscribe {
    return this.events.on('session', fn);
  }

  /** When a track's instrument takes the sound of a starting clip: the project
   *  follows it (it arrives after the scheduling, never during). */
  onClipSound(fn: (track: TrackId, sound: InstrumentSettings) => void): Unsubscribe {
    return this.events.on('sound', fn);
  }

  // ---------------------------------------------------------------- session

  /** Launches the slot's clip (empty slot: stops the track) at the next quantization
   *  boundary; with the transport stopped it starts it, and the clip with it. A group's slot
   *  launches the row of its tracks, like a scene restricted to the group. */
  launchSlot(track: TrackId, slot: number): void {
    this.launch([[track, slot]]);
  }

  /** Launches a scene: in each track the row's clip, and where the slot is empty the stop. */
  launchScene(index: number): void {
    this.launch(this.project?.tracks.filter(t => !(t instanceof GroupTrack)).map(t => [t.id, index] as const) ?? []);
  }

  /** Stops the track's clip (of a group: of its tracks) at the next boundary (the
   *  track stays silent, as in Live); with the transport stopped, the clip playing at the stop won't
   *  restart with play. */
  stopTrack(track: TrackId): void {
    const tracks = this.project?.soundingTracks(track).map(t => t.id) ?? [track];
    if (!this.playing) {
      if (this.session.forget(tracks)) this.events.emit('session');
      return;
    }
    this.switchTracks(tracks, (at, id) => this.session.stop(id, at));
  }

  /** Stops all the session's clips (the tracks following the timeline continue); with the
   *  transport stopped, no clip will restart with play. */
  stopAllClips(): void {
    if (!this.playing) {
      if (this.session.forget()) this.events.emit('session');
      return;
    }
    if (!this.project) return;
    const clock = this.clock;
    const busy = this.project.tracks.filter(t => {
      const s = this.session.state(t, clock);
      return s.playing || (s.queued && s.queued !== 'stop');
    }).map(t => t.id);
    this.switchTracks(busy, (at, id) => this.session.stop(id, at));
  }

  /** The tracks taken by the session go back to their timeline right away. */
  backToArrangement(): void {
    const at = this.playing ? this.scheduler.scheduledClock : -Infinity;
    for (const id of this.session.backToArrangement(at)) if (this.playing) this.cutTrack(id, this.scheduler.timeAtClock(at));
    this.events.emit('session');
  }

  /** What the track plays in the session; for a group, its tracks together (see `mergedState`). */
  sessionState(track: Track): TrackSessionState {
    const clock = this.clock;
    if (track instanceof GroupTrack && this.project) return mergedState(this.project.soundingTracks(track.id).map(t => this.session.state(t, clock)));
    return this.session.state(track, clock);
  }

  /** The session clips playing now, track by track ("Capture and insert scene"). */
  playingClips(): Map<TrackId, ClipId> {
    const clock = this.clock, playing = new Map<TrackId, ClipId>();
    for (const t of this.project?.tracks ?? []) {
      const slot = t instanceof GroupTrack ? undefined : this.session.state(t, clock).playing?.slot;
      if (slot !== undefined) playing.set(t.id, t.slots[slot]!.id);
    }
    return playing;
  }

  /** True if some track isn't following the timeline ("Back to arrangement" lights up). */
  get arrangementOverridden(): boolean {
    return this.session.taken.size > 0;
  }

  /** The tracks taken by the session (in the arrangement they show as off). */
  get takenTracks(): ReadonlySet<TrackId> {
    return this.session.taken;
  }

  /** The continuous clock now. */
  private get clock(): number {
    return (this.playing ? this.scheduler.clockAt(this.graph.currentTime) : null) ?? this.cursor;
  }

  /** The next quantization boundary not yet scheduled. */
  private boundary(): number {
    const p = this.project!, q = launchQuantumBeats(p.launchQuantization, p.signature);
    const earliest = this.scheduler.scheduledClock;
    return q > 0 ? Math.ceil(earliest / q - 1e-9) * q : earliest;
  }

  private launch(items: readonly (readonly [TrackId, number])[]): void {
    const p = this.project;
    if (!p) return;
    // a group's slot applies to its tracks
    const clips = items.flatMap(([id, slot]) => p.soundingTracks(id).map(t => [t.id, t.slots[slot] ?? null] as const));
    if (this.playing) {
      this.switchTracks(clips.map(([id]) => id), (at, id) => {
        const clip = clips.find(([t]) => t === id)![1];
        if (clip) this.session.launch(id, clip.id, at);
        else this.session.stop(id, at);
      });
      return;
    }
    // when stopped: the clips start with the transport, from the cursor
    if (!clips.some(([, c]) => c)) return;
    for (const [id, clip] of clips) {
      if (clip) this.session.launch(id, clip.id, this.cursor);
      else this.session.stop(id, this.cursor);
    }
    this.play();
    this.events.emit('session');
  }

  /** Changes the tracks' schedule at the next boundary and cuts there what was already scheduled. */
  private switchTracks(tracks: readonly TrackId[], change: (at: number, track: TrackId) => void): void {
    if (!tracks.length) return;
    const at = this.boundary();
    this.session.prune(this.clock);
    for (const id of tracks) {
      change(at, id);
      this.cutTrack(id, this.scheduler.timeAtClock(at));
    }
    this.events.emit('session');
  }

  setProject(next: Project): void {
    const prev = this.project;
    this.project = next;
    this.mixer.sync(next);
    const changed = this.syncPlayers(next);
    const mods = this.syncChainModulators(next, changed);
    // the master's curves are picked up again even if its chain changes (the targets are there)
    const curves = this.masterModulator.update(next.playingMasterAutomation);
    const master = curves || (!!prev && (prev.masterEffects !== next.masterEffects || prev.masterRacks !== next.masterRacks) && next.playingMasterAutomation.length > 0);
    if (!this.playing) return;
    if (prev && prev.signature !== next.signature) this.anchors.resend();
    if (!prev || prev.tempo !== next.tempo || prev.loop !== next.loop) this.resume();
    else if (changed.size || master || mods.length) this.retake(changed, master, mods);
  }

  play(from: Beats = this.cursor): void {
    if (!this.project) return;
    this.cursor = Math.max(0, from);
    // when stopped: the clips playing at the stop restart with the transport
    if (!this.playing) this.session.start(this.cursor);
    this.restart(this.cursor);
    this.cancelTimer ??= this.timer.every(this.tickMs, () => this.scheduler.advance(this.graph.currentTime));
    this.events.emit('state', true);
  }

  stop(): void {
    if (!this.playing) return;
    this.session.reset(this.project?.tracks ?? [], this.clock);
    this.scheduler.stop();
    this.anchors.stopped();
    for (const m of this.modulators.values()) m.reset();
    this.masterModulator.reset();
    for (const m of this.chainMods.values()) m.reset();
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.events.emit('state', false);
    this.events.emit('session');
  }

  /** Moves the playhead; if it's playing it continues from there. */
  seek(beat: Beats): void {
    this.cursor = Math.max(0, beat);
    if (this.playing) this.restart(this.cursor);
  }

  /** To be called when missing audio arrives: the tracks waiting for it
   *  are rescheduled from a moment later, so it's heard. */
  refresh(): void {
    if (this.playing && this.missed.size) this.retake([...this.missed]);
  }

  /** The audio context's time, in seconds. */
  get audioTime(): number {
    return this.graph.currentTime;
  }

  /** The pitches of the track's notes started in [from, to) (audio context seconds):
   *  to light up the pads while it plays. The notes before `from` are forgotten. */
  notesStarted(track: TrackId, from: number, to: number): number[] {
    return this.activity.get(track)?.between(from, to) ?? [];
  }

  /** Where the voices of the track's instrument read now, if it plays a sample (fractions
   *  of the sample): the cursors on the Sampler's waveform. */
  playheads(track: TrackId): readonly number[] {
    return this.players.get(track)?.player.playheads?.() ?? [];
  }

  /** Where a curve takes a track's or the master's target now, in the scale of its
   *  type (for a parameter: the knob offset, −1 … +1); null if no curve ever
   *  touched it. A macro gives its curve, the parameters it moves their offset. */
  modulationAt(owner: ChainOwner, target: ModTarget): number | null {
    return this.traces.current(`${owner}|${targetKey(target)}`, target.kind === 'mixer' && target.param === 'volume');
  }

  /** Plays a note right away with the track's instrument (piano roll, keyboard). */
  audition(track: TrackId, pitch: number, velocity = 100, seconds = 0.3): void {
    this.players.get(track)?.player.audition?.(pitch, velocity, seconds);
  }

  /** A note played by hand with the track's instrument: it starts right away and plays until
   *  `releaseNote` arrives, with the transport stopped or while the clips run. */
  pressNote(track: TrackId, pitch: number, velocity: number): void {
    this.players.get(track)?.player.press?.(pitch, velocity);
  }

  releaseNote(track: TrackId, pitch: number): void {
    this.players.get(track)?.player.release?.(pitch);
  }

  /** Schedules all of [from, to) starting from instant `at` (offline export). */
  scheduleRange(from: Beats, to: Beats, at = 0): void {
    if (!this.project) throw new Error('no project');
    this.scheduler.scheduleRange(from, to, at, this.project.tempo);
  }

  dispose(): void {
    this.stop();
    for (const { player } of this.players.values()) player.dispose();
    this.players.clear();
  }

  /** Reschedules from `beat` (play, cursor jump). If it was already playing the clock
   *  continues (the session clips stay in phase), otherwise it starts from the beat. */
  private restart(beat: Beats): void {
    this.restartAt(beat, this.playing ? this.clock : beat, this.graph.currentTime + this.startLatency);
  }

  /** New tempo or loop while playing: everything resumes from where the transport will be when the new
   *  sound arrives (so nothing slips), without stopping what's already playing. */
  private resume(): void {
    const p = this.project!, now = this.graph.currentTime;
    // everything scheduled beyond the resume instant: from there the sources restart
    this.scheduler.advance(now);
    this.missed.clear();
    this.scheduler.resumeAt(now + this.startLatency, p.tempo, p.loop);
    this.scheduler.advance(now);
  }

  /** Only the tracks `ids` (changed, or with the audio just arrived) and, with `master`, the master's
   *  curves resume from a moment later; the others continue without noticing. */
  private retake(ids: Iterable<TrackId>, master = false, mods: readonly ChainModulators[] = []): void {
    const now = this.graph.currentTime;
    this.scheduler.advance(now);
    const sources: ScheduledSource[] = master ? [this.masterModulator] : [];
    for (const id of ids) {
      this.missed.delete(id);
      const player = this.players.get(id)?.player, mod = this.modulators.get(id);
      if (player) sources.push(player);
      if (mod) sources.push(mod);
    }
    // the modulators after the curves: they also hear the curves moving their parameters
    sources.push(...mods);
    this.scheduler.retake(now + this.startLatency, sources);
  }

  private restartAt(beat: Beats, clock: number, time: number): void {
    const p = this.project!;
    this.scheduler.stop();
    this.missed.clear();
    this.scheduler.start(beat, time, p.tempo, p.loop, clock);
    this.scheduler.advance(this.graph.currentTime);
  }

  /** Cuts at instant `time` what the track had scheduled (sound and modulations). */
  private cutTrack(id: TrackId, time: number): void {
    this.players.get(id)?.player.cut(time);
    this.modulators.get(id)?.cut(time);
  }

  /** Where a modulation of a track or of the master goes: the mixer channel (tracks only), the
   *  instrument, an effect or a rack's macro (which moves the mapped parameters). What it receives
   *  also stays in its trace, for the interface. */
  private modSink(owner: ChainOwner, target: ModTarget, channel?: string): ModSink | null {
    const sink = this.destination(owner, target, channel);
    return sink && this.traces.wrap(`${owner}|${targetKey(target)}`, scaleOf(target).neutral, sink, channel);
  }

  /** `channel`: the source, if it isn't the clip curves (a modulator): it adds to them. */
  private destination(owner: ChainOwner, target: ModTarget, channel?: string): ModSink | null {
    if (target.kind === 'mixer') return owner === MASTER ? null : audioParamSink(this.mixer.modulation(owner, target.param, channel));
    // the transpose is played by the audio clip itself
    if (target.kind === 'clip') return null;
    const racks = owner === MASTER ? this.project?.masterRacks : this.project?.track(owner)?.racks;
    const rack = findRack(racks ?? [], target.device as DeviceId);
    if (rack) return this.macroSink(owner, rack, macroIndex(target.param), channel);
    if (target.device === INSTRUMENT_DEVICE && owner === MASTER) return null;
    // the arpeggiator lives in the instrument and its parameters travel with its own
    const inInstrument = target.device === INSTRUMENT_DEVICE
      || this.project?.effectsOf(owner).some(e => e.id === target.device && isArpType(e.type));
    const device = inInstrument
      ? this.players.get(owner as TrackId)?.player.instrumentModulation?.()
      : this.mixer.effect(owner, target.device)?.modulation ?? this.chainMods.get(owner)?.modulation(target.device);
    return device?.sink(target.param, channel) ?? null;
  }

  private macroSink(owner: ChainOwner, rack: Rack, index: number, channel?: string): ModSink | null {
    const macro = rack.macros[index], project = this.project;
    if (!macro || !project) return null;
    const sink = scaledSinks(macro.mappings.flatMap(m => {
      const spec = mappingSpec(project, owner, m);
      const sink = spec && this.modSink(owner, { kind: 'device', device: m.device, param: m.param }, channel);
      return sink ? [{ sink, scale: mappingTravel(spec, m) }] : [];
    }));
    // a toggle or a button snaps, as when it's pressed
    return isSwitchMacro(macro) ? switchSink(sink, macro.value >= MACRO_MAX / 2) : sink;
  }

  private *sources(): Iterable<ScheduledSource> {
    for (const { player } of this.players.values()) yield player;
    yield* this.modulators.values();
    yield this.masterModulator;
    // after the curves: the modulators also hear the curves moving their parameters
    yield* this.chainMods.values();
    yield this.metronome;
    yield this.anchors;
  }

  /** Aligns the players with the tracks; returns those in which something audible changed. */
  private syncPlayers(project: Project): Set<TrackId> {
    const changed = new Set<TrackId>();
    const present = new Set<TrackId>();
    const prevTracks = this.previousTracks;
    for (const t of project.tracks) {
      // a group plays no clips: it's only a mixer channel
      if (t instanceof GroupTrack) continue;
      present.add(t.id);
      const entry = this.players.get(t.id);
      const mod = this.modulators.get(t.id);
      if (mod) mod.update(t);
      else this.modulators.set(t.id, new TrackModulator(t, () => this.session.programs(t.id), target => this.modSink(t.id, target), () => this.graph.currentTime));
      if (entry && entry.kind === t.kind) {
        const prev = prevTracks.get(t.id);
        if (prev?.arrangement !== t.arrangement || (prev && this.playingClipChanged(prev, t))) changed.add(t.id);
        entry.player.update(t);
        continue;
      }
      entry?.player.dispose();
      const factory = this.factories[t.kind];
      if (!factory) {
        console.warn(`no player for "${t.kind}" tracks`);
        this.players.delete(t.id);
        continue;
      }
      const id = t.id;
      const notes = new NoteActivity();
      this.activity.set(id, notes);
      const ctx: PlayerContext = {
        graph: this.graph, output: this.mixer.input(id), missing: () => { this.missed.add(id); },
        programs: () => this.session.programs(id), notes, tempo: () => this.project?.tempo.bpm ?? 120,
        sound: sound => queueMicrotask(() => this.events.emit('sound', id, sound)),
      };
      this.players.set(t.id, { kind: t.kind, player: factory(t, ctx, this.services) });
      changed.add(id);
    }
    for (const [id, { player }] of this.players) {
      if (!present.has(id)) {
        player.dispose();
        this.players.delete(id);
        this.activity.delete(id);
        this.modulators.get(id)?.reset();
        this.modulators.delete(id);
        this.session.remove(id);
        this.missed.delete(id);
      }
    }
    this.previousTracks = new Map(project.tracks.map(t => [t.id, t]));
    return changed;
  }

  /** Aligns the chains' modulators (tracks, buses, master); returns those to resume:
   *  the changed modulators and those of the changed tracks (the notes that start them). */
  private syncChainModulators(project: Project, changed: ReadonlySet<TrackId>): ChainModulators[] {
    const out: ChainModulators[] = [];
    const present = new Set<ChainOwner>();
    const sync = (owner: ChainOwner, effects: readonly EffectSettings[], track: Track | null) => {
      let mods = this.chainMods.get(owner);
      if (!mods && !effects.some(e => isModulatorType(e.type))) return;
      present.add(owner);
      if (!mods) {
        const programs = owner === MASTER ? () => [] : () => this.session.programs(owner as TrackId);
        mods = new ChainModulators((target, channel) => this.modSink(owner, target, channel), () => this.graph.currentTime, programs);
        this.chainMods.set(owner, mods);
      }
      if (mods.update(effects, track) || (owner !== MASTER && changed.has(owner as TrackId))) out.push(mods);
    };
    for (const t of project.channels) sync(t.id, t.effects, t);
    sync(MASTER, project.masterEffects, null);
    for (const [owner, mods] of this.chainMods) {
      if (present.has(owner)) continue;
      mods.reset();
      this.chainMods.delete(owner);
    }
    return out;
  }

  /** True if a session clip the track plays or will play changed. */
  private playingClipChanged(prev: Track, next: Track): boolean {
    if (prev.slots === next.slots) return false;
    return this.session.programs(next.id).some(p => p.source.kind === 'clip' && slotClip(prev, p.source.clip) !== slotClip(next, p.source.clip));
  }
}
