import { Emitter, type Unsubscribe } from '../core/emitter';
import type { TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import type { Project } from '../model/project';
import type { AudioTrack, MidiTrack, Track } from '../model/track';
import type { AudioGraph } from './audio-graph';
import type { PlayableProvider } from './clip-audio';
import { MixerGraph } from './mixer-graph';
import { AudioTrackPlayer } from './players/audio-track-player';
import type { InstrumentHost } from './players/instrument';
import { Metronome } from './players/metronome';
import { MidiTrackPlayer } from './players/midi-track-player';
import type { PlayerContext, TrackPlayer } from './players/track-player';
import { Scheduler, type ScheduledSource } from './scheduler';

/** Servizi di cui i player hanno bisogno. */
export interface EngineServices {
  readonly clips: PlayableProvider;
  readonly instruments: InstrumentHost;
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
};

/** Trasporto e riproduzione del progetto. Riceve ogni nuova versione del progetto con
 *  `setProject`: aggiorna mixer e player e, se sta suonando e qualcosa che si sente è
 *  cambiato, riprogramma dalla posizione corrente. */
export class PlaybackEngine {
  private project: Project | null = null;
  private readonly mixer: MixerGraph;
  private readonly players = new Map<TrackId, { kind: string; player: TrackPlayer }>();
  /** Le tracce della versione precedente, per capire cosa è cambiato. */
  private previousTracks = new Map<TrackId, Track>();
  private readonly metronome: Metronome;
  private readonly scheduler: Scheduler;
  private readonly events = new Emitter<EngineEvents>();
  private readonly timer: Timer;
  private readonly factories: Readonly<Record<string, PlayerFactory>>;
  private readonly startLatency: number;
  private readonly tickMs: number;
  private cancelTimer: (() => void) | null = null;
  private cursor: Beats = 0;
  /** Qualche tratto non è partito perché il suo audio non era pronto. */
  private missed = false;

  constructor(private readonly graph: AudioGraph, private readonly services: EngineServices, opts: EngineOptions = {}) {
    this.timer = opts.timer ?? intervalTimer;
    this.factories = opts.players ?? defaultPlayers;
    this.startLatency = opts.startLatency ?? 0.05;
    this.tickMs = opts.tickMs ?? 25;
    this.mixer = new MixerGraph(graph);
    this.metronome = new Metronome(graph, this.mixer.master, () => this.project!.signature);
    this.scheduler = new Scheduler(() => this.sources(), opts.lookahead ?? 0.2);
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

  onStateChange(fn: (playing: boolean) => void): Unsubscribe {
    return this.events.on('state', fn);
  }

  setProject(next: Project): void {
    const prev = this.project;
    this.project = next;
    this.mixer.sync(next);
    const changed = this.syncPlayers(next);
    const audible = changed || !prev || prev.tempo !== next.tempo || prev.loop !== next.loop;
    if (this.playing && audible) this.restart(this.position);
  }

  play(from: Beats = this.cursor): void {
    if (!this.project) return;
    this.cursor = Math.max(0, from);
    this.restart(this.cursor);
    this.cancelTimer ??= this.timer.every(this.tickMs, () => this.scheduler.advance(this.graph.currentTime));
    this.events.emit('state', true);
  }

  stop(): void {
    if (!this.playing) return;
    this.scheduler.stop();
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.events.emit('state', false);
  }

  /** Sposta la testina; se sta suonando continua da lì. */
  seek(beat: Beats): void {
    this.cursor = Math.max(0, beat);
    if (this.playing) this.restart(this.cursor);
  }

  /** Da chiamare quando arriva dell'audio che mancava: se qualcosa è stato saltato,
   *  riprogramma dalla posizione corrente così si sente. */
  refresh(): void {
    if (this.playing && this.missed) this.restart(this.position);
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

  private restart(beat: Beats): void {
    const p = this.project!;
    this.scheduler.stop();
    this.missed = false;
    this.scheduler.start(beat, this.graph.currentTime + this.startLatency, p.tempo, p.loop);
    this.scheduler.advance(this.graph.currentTime);
  }

  private *sources(): Iterable<ScheduledSource> {
    for (const { player } of this.players.values()) yield player;
    yield this.metronome;
  }

  /** Allinea i player alle tracce; vero se è cambiato qualcosa che si sente. */
  private syncPlayers(project: Project): boolean {
    let changed = false;
    const present = new Set<TrackId>();
    const prevTracks = this.previousTracks;
    for (const t of project.tracks) {
      present.add(t.id);
      const entry = this.players.get(t.id);
      if (entry && entry.kind === t.kind) {
        if (prevTracks.get(t.id)?.arrangement !== t.arrangement) changed = true;
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
      const ctx: PlayerContext = { graph: this.graph, output: this.mixer.input(t.id), missing: () => { this.missed = true; } };
      this.players.set(t.id, { kind: t.kind, player: factory(t, ctx, this.services) });
      changed = true;
    }
    for (const [id, { player }] of this.players) {
      if (!present.has(id)) {
        player.dispose();
        this.players.delete(id);
        changed = true;
      }
    }
    this.previousTracks = new Map(project.tracks.map(t => [t.id, t]));
    return changed;
  }
}
