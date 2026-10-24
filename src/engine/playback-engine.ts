import { Emitter, type Unsubscribe } from '../core/emitter';
import type { ClipId, DeviceId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { INSTRUMENT_DEVICE, type ModTarget } from '../model/envelope';
import { mappingSpec, mappingTravel } from '../devices/rack-params';
import { launchQuantumBeats } from '../model/launch';
import { findRack, isSwitchMacro, MACRO_MAX, macroIndex, type Rack } from '../model/rack';
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
import { audioParamSink, MasterModulator, scaledSinks, switchSink, TrackModulator, type ModSink } from './modulation';
import { NoteActivity } from './note-activity';
import type { PlayerContext, TrackPlayer } from './players/track-player';
import { Scheduler, type ScheduledSource } from './scheduler';
import { mergedState, Session, slotClip, type TrackSessionState } from './session';

/** Servizi di cui i player hanno bisogno. */
export interface EngineServices {
  readonly clips: PlayableProvider;
  readonly instruments: InstrumentHost;
  readonly effects: EffectHost;
  /** Misuratori di livello di tracce e master (solo dal vivo). */
  readonly meters?: MeterHost;
}

export type PlayerFactory = (track: Track, ctx: PlayerContext, services: EngineServices) => TrackPlayer;

/** Un player per tipo di traccia: un tipo nuovo si aggiunge qui (o passando la propria tabella). */
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
  /** Anticipo della programmazione, in secondi. */
  readonly lookahead?: number;
  /** Ritardo tra il comando play e il primo suono, in secondi. */
  readonly startLatency?: number;
  /** Ogni quanto lo scheduler programma, in millisecondi. */
  readonly tickMs?: number;
}

type EngineEvents = {
  state: [playing: boolean];
  /** Una clip lanciata o fermata, un ritorno all'arrangement. */
  session: [];
};

/** Trasporto e riproduzione del progetto. Riceve ogni nuova versione del progetto con
 *  `setProject`: aggiorna mixer e player e, se sta suonando e qualcosa che si sente è
 *  cambiato, riprogramma da un attimo dopo senza interrompere niente: solo le tracce cambiate,
 *  o tutto se cambiano tempo o loop. Suona la timeline e le clip lanciate
 *  nella session, quantizzate sull'orologio continuo del trasporto. */
export class PlaybackEngine {
  private project: Project | null = null;
  private readonly mixer: MixerGraph;
  private readonly players = new Map<TrackId, { kind: string; player: TrackPlayer }>();
  /** Le tracce della versione precedente, per capire cosa è cambiato. */
  private previousTracks = new Map<TrackId, Track>();
  private readonly metronome: Metronome;
  /** Dove si trova il trasporto, per gli effetti che seguono la battuta. */
  private readonly anchors: TransportAnchors;
  private readonly scheduler: Scheduler;
  private readonly events = new Emitter<EngineEvents>();
  private readonly timer: Timer;
  private readonly factories: Readonly<Record<string, PlayerFactory>>;
  private readonly startLatency: number;
  private readonly tickMs: number;
  private cancelTimer: (() => void) | null = null;
  private cursor: Beats = 0;
  /** Le tracce con un tratto non partito (o partito con l'audio provvisorio) perché il suo
   *  audio non era pronto. */
  private readonly missed = new Set<TrackId>();
  private readonly session = new Session();
  /** Le note programmate di ogni traccia, per l'interfaccia. */
  private readonly activity = new Map<TrackId, NoteActivity>();
  /** Le modulazioni delle clip, una sorgente per traccia. */
  private readonly modulators = new Map<TrackId, TrackModulator>();
  /** Le curve del master sulla timeline. */
  private readonly masterModulator: MasterModulator;

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
  }

  get playing(): boolean {
    return this.scheduler.running;
  }

  /** Battito che si sente adesso (o da cui partirà il play). */
  get position(): Beats {
    return (this.playing ? this.scheduler.positionAt(this.graph.currentTime) : null) ?? this.cursor;
  }

  get metronomeOn(): boolean {
    return this.metronome.enabled;
  }

  set metronomeOn(on: boolean) {
    this.metronome.enabled = on;
  }

  /** Livelli di una traccia o del master dall'ultima lettura (null senza misuratori). */
  levels(owner: ChainOwner): MeterReading | null {
    return this.mixer.levels(owner);
  }

  /** Da dove ascoltare un effetto che suona (per lo spettro). */
  effectMonitor(owner: ChainOwner, id: DeviceId): EffectMonitor | null {
    return this.mixer.effect(owner, id)?.monitor ?? null;
  }

  onStateChange(fn: (playing: boolean) => void): Unsubscribe {
    return this.events.on('state', fn);
  }

  onSessionChange(fn: () => void): Unsubscribe {
    return this.events.on('session', fn);
  }

  // ---------------------------------------------------------------- session

  /** Lancia la clip dello slot (slot vuoto: ferma la traccia) al prossimo confine della
   *  quantizzazione; a trasporto fermo lo fa partire, e la clip con lui. Lo slot di un gruppo
   *  lancia la riga delle sue tracce, come una scena ristretta al gruppo. */
  launchSlot(track: TrackId, slot: number): void {
    this.launch([[track, slot]]);
  }

  /** Lancia una scena: in ogni traccia la clip della riga, e dove lo slot è vuoto lo stop. */
  launchScene(index: number): void {
    this.launch(this.project?.tracks.filter(t => !(t instanceof GroupTrack)).map(t => [t.id, index] as const) ?? []);
  }

  /** Ferma la clip della traccia (di un gruppo: delle sue tracce) al prossimo confine (la
   *  traccia resta muta, come in Live); a trasporto fermo, la clip che suonava allo stop non
   *  ripartirà con il play. */
  stopTrack(track: TrackId): void {
    const tracks = this.project?.soundingTracks(track).map(t => t.id) ?? [track];
    if (!this.playing) {
      if (this.session.forget(tracks)) this.events.emit('session');
      return;
    }
    this.switchTracks(tracks, (at, id) => this.session.stop(id, at));
  }

  /** Ferma tutte le clip della session (le tracce che seguono la timeline continuano); a
   *  trasporto fermo, nessuna clip ripartirà con il play. */
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

  /** Le tracce prese dalla session tornano subito alla loro timeline. */
  backToArrangement(): void {
    const at = this.playing ? this.scheduler.scheduledClock : -Infinity;
    for (const id of this.session.backToArrangement(at)) if (this.playing) this.cutTrack(id, this.scheduler.timeAtClock(at));
    this.events.emit('session');
  }

  /** Cosa suona la traccia nella session; per un gruppo, le sue tracce insieme (vedi `mergedState`). */
  sessionState(track: Track): TrackSessionState {
    const clock = this.clock;
    if (track instanceof GroupTrack && this.project) return mergedState(this.project.soundingTracks(track.id).map(t => this.session.state(t, clock)));
    return this.session.state(track, clock);
  }

  /** Le clip della session che suonano adesso, traccia per traccia ("Cattura e inserisci scena"). */
  playingClips(): Map<TrackId, ClipId> {
    const clock = this.clock, playing = new Map<TrackId, ClipId>();
    for (const t of this.project?.tracks ?? []) {
      const slot = t instanceof GroupTrack ? undefined : this.session.state(t, clock).playing?.slot;
      if (slot !== undefined) playing.set(t.id, t.slots[slot]!.id);
    }
    return playing;
  }

  /** Vero se qualche traccia non segue la timeline (si accende "Torna all'arrangement"). */
  get arrangementOverridden(): boolean {
    return this.session.taken.size > 0;
  }

  /** Le tracce prese dalla session (nell'arrangement si mostrano spente). */
  get takenTracks(): ReadonlySet<TrackId> {
    return this.session.taken;
  }

  /** L'orologio continuo adesso. */
  private get clock(): number {
    return (this.playing ? this.scheduler.clockAt(this.graph.currentTime) : null) ?? this.cursor;
  }

  /** Il prossimo confine della quantizzazione non ancora programmato. */
  private boundary(): number {
    const p = this.project!, q = launchQuantumBeats(p.launchQuantization, p.signature);
    const earliest = this.scheduler.scheduledClock;
    return q > 0 ? Math.ceil(earliest / q - 1e-9) * q : earliest;
  }

  private launch(items: readonly (readonly [TrackId, number])[]): void {
    const p = this.project;
    if (!p) return;
    // lo slot di un gruppo vale per le sue tracce
    const clips = items.flatMap(([id, slot]) => p.soundingTracks(id).map(t => [t.id, t.slots[slot] ?? null] as const));
    if (this.playing) {
      this.switchTracks(clips.map(([id]) => id), (at, id) => {
        const clip = clips.find(([t]) => t === id)![1];
        if (clip) this.session.launch(id, clip.id, at);
        else this.session.stop(id, at);
      });
      return;
    }
    // da fermo: le clip partono con il trasporto, dal cursore
    if (!clips.some(([, c]) => c)) return;
    for (const [id, clip] of clips) {
      if (clip) this.session.launch(id, clip.id, this.cursor);
      else this.session.stop(id, this.cursor);
    }
    this.play();
    this.events.emit('session');
  }

  /** Cambia la scaletta delle tracce al prossimo confine e taglia lì ciò che era già programmato. */
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
    // le curve del master si riprendono anche se cambia la sua catena (i bersagli sono lì)
    const curves = this.masterModulator.update(next.masterAutomation);
    const master = curves || (!!prev && (prev.masterEffects !== next.masterEffects || prev.masterRacks !== next.masterRacks) && next.masterAutomation.length > 0);
    if (!this.playing) return;
    if (prev && prev.signature !== next.signature) this.anchors.resend();
    if (!prev || prev.tempo !== next.tempo || prev.loop !== next.loop) this.resume();
    else if (changed.size || master) this.retake(changed, master);
  }

  play(from: Beats = this.cursor): void {
    if (!this.project) return;
    this.cursor = Math.max(0, from);
    // da fermo: le clip che suonavano allo stop ripartono con il trasporto
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
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.events.emit('state', false);
    this.events.emit('session');
  }

  /** Sposta la testina; se sta suonando continua da lì. */
  seek(beat: Beats): void {
    this.cursor = Math.max(0, beat);
    if (this.playing) this.restart(this.cursor);
  }

  /** Da chiamare quando arriva dell'audio che mancava: le tracce che l'aspettavano si
   *  riprogrammano da un attimo dopo, così si sente. */
  refresh(): void {
    if (this.playing && this.missed.size) this.retake([...this.missed]);
  }

  /** L'ora del contesto audio, in secondi. */
  get audioTime(): number {
    return this.graph.currentTime;
  }

  /** Le altezze delle note della traccia partite in [from, to) (secondi del contesto audio):
   *  per accendere i pad mentre suona. Le note prima di `from` si dimenticano. */
  notesStarted(track: TrackId, from: number, to: number): number[] {
    return this.activity.get(track)?.between(from, to) ?? [];
  }

  /** Dove leggono adesso le voci dello strumento della traccia, se suona un sample (frazioni
   *  del sample): i cursori sulla forma d'onda del Sampler. */
  playheads(track: TrackId): readonly number[] {
    return this.players.get(track)?.player.playheads?.() ?? [];
  }

  /** Fa sentire subito una nota con lo strumento della traccia (piano roll, tastiera). */
  audition(track: TrackId, pitch: number, velocity = 100, seconds = 0.3): void {
    this.players.get(track)?.player.audition?.(pitch, velocity, seconds);
  }

  /** Programma tutto [from, to) a partire dall'istante `at` (export offline). */
  scheduleRange(from: Beats, to: Beats, at = 0): void {
    if (!this.project) throw new Error('nessun progetto');
    this.scheduler.scheduleRange(from, to, at, this.project.tempo);
  }

  dispose(): void {
    this.stop();
    for (const { player } of this.players.values()) player.dispose();
    this.players.clear();
  }

  /** Riprogramma da `beat` (play, salto del cursore). Se stava già suonando l'orologio
   *  continua (le clip della session restano in fase), altrimenti parte dal battito. */
  private restart(beat: Beats): void {
    this.restartAt(beat, this.playing ? this.clock : beat, this.graph.currentTime + this.startLatency);
  }

  /** Tempo o loop nuovi mentre suona: tutto riprende da dove il trasporto sarà quando il nuovo
   *  suono arriva (così niente slitta), senza fermare ciò che suona già. */
  private resume(): void {
    const p = this.project!, now = this.graph.currentTime;
    // tutto programmato oltre l'istante della ripresa: da lì le sorgenti ripartono
    this.scheduler.advance(now);
    this.missed.clear();
    this.scheduler.resumeAt(now + this.startLatency, p.tempo, p.loop);
    this.scheduler.advance(now);
  }

  /** Solo le tracce `ids` (modificate, o con l'audio appena arrivato) e, con `master`, le curve
   *  del master riprendono da un attimo dopo; le altre continuano senza accorgersene. */
  private retake(ids: Iterable<TrackId>, master = false): void {
    const now = this.graph.currentTime;
    this.scheduler.advance(now);
    const sources: ScheduledSource[] = master ? [this.masterModulator] : [];
    for (const id of ids) {
      this.missed.delete(id);
      const player = this.players.get(id)?.player, mod = this.modulators.get(id);
      if (player) sources.push(player);
      if (mod) sources.push(mod);
    }
    this.scheduler.retake(now + this.startLatency, sources);
  }

  private restartAt(beat: Beats, clock: number, time: number): void {
    const p = this.project!;
    this.scheduler.stop();
    this.missed.clear();
    this.scheduler.start(beat, time, p.tempo, p.loop, clock);
    this.scheduler.advance(this.graph.currentTime);
  }

  /** Taglia all'istante `time` ciò che la traccia aveva programmato (suono e modulazioni). */
  private cutTrack(id: TrackId, time: number): void {
    this.players.get(id)?.player.cut(time);
    this.modulators.get(id)?.cut(time);
  }

  /** Dove va una modulazione di una traccia o del master: il canale del mixer (solo le tracce), lo
   *  strumento, un effetto o la macro di un rack (che muove i parametri mappati). */
  private modSink(owner: ChainOwner, target: ModTarget): ModSink | null {
    if (target.kind === 'mixer') return owner === MASTER ? null : audioParamSink(this.mixer.modulation(owner, target.param));
    const racks = owner === MASTER ? this.project?.masterRacks : this.project?.track(owner)?.racks;
    const rack = findRack(racks ?? [], target.device as DeviceId);
    if (rack) return this.macroSink(owner, rack, macroIndex(target.param));
    if (target.device === INSTRUMENT_DEVICE && owner === MASTER) return null;
    const device = target.device === INSTRUMENT_DEVICE
      ? this.players.get(owner as TrackId)?.player.instrumentModulation?.()
      : this.mixer.effect(owner, target.device)?.modulation;
    return device?.sink(target.param) ?? null;
  }

  private macroSink(owner: ChainOwner, rack: Rack, index: number): ModSink | null {
    const macro = rack.macros[index], project = this.project;
    if (!macro || !project) return null;
    const sink = scaledSinks(macro.mappings.flatMap(m => {
      const spec = mappingSpec(project, owner, m);
      const sink = spec && this.modSink(owner, { kind: 'device', device: m.device, param: m.param });
      return sink ? [{ sink, scale: mappingTravel(spec, m) }] : [];
    }));
    // un interruttore o un pulsante scatta, come quando lo si preme
    return isSwitchMacro(macro) ? switchSink(sink, macro.value >= MACRO_MAX / 2) : sink;
  }

  private *sources(): Iterable<ScheduledSource> {
    for (const { player } of this.players.values()) yield player;
    yield* this.modulators.values();
    yield this.masterModulator;
    yield this.metronome;
    yield this.anchors;
  }

  /** Allinea i player alle tracce; restituisce quelle in cui è cambiato qualcosa che si sente. */
  private syncPlayers(project: Project): Set<TrackId> {
    const changed = new Set<TrackId>();
    const present = new Set<TrackId>();
    const prevTracks = this.previousTracks;
    for (const t of project.tracks) {
      // un gruppo non suona clip: è solo un canale del mixer
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
        console.warn(`nessun player per le tracce "${t.kind}"`);
        this.players.delete(t.id);
        continue;
      }
      const id = t.id;
      const notes = new NoteActivity();
      this.activity.set(id, notes);
      const ctx: PlayerContext = {
        graph: this.graph, output: this.mixer.input(id), missing: () => { this.missed.add(id); },
        programs: () => this.session.programs(id), notes, tempo: () => this.project?.tempo.bpm ?? 120,
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

  /** Vero se è cambiata una clip della session che la traccia suona o suonerà. */
  private playingClipChanged(prev: Track, next: Track): boolean {
    if (prev.slots === next.slots) return false;
    return this.session.programs(next.id).some(p => p.source.kind === 'clip' && slotClip(prev, p.source.clip) !== slotClip(next, p.source.clip));
  }
}
