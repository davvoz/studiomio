/* Recording onto the timeline, as Live's Arrangement Record (● Rec, F9): with the transport stopped it
 * starts playing from the cursor, while playing it punches in where the playhead is. What's played on
 * the armed MIDI tracks (⌨ or a MIDI keyboard) goes into a take (model/arrangement-take.ts); ● again or
 * Stop ends it, and each track that got notes gets a clip over the stretch recorded, in place of what
 * was there. With the loop on it goes on recording round after round, the notes adding up; a jump of
 * the playhead (a click on the ruler) writes the take so far and starts a new one there.
 * With "Record the movements" on (Options › Recording) what's moved on an armed track (instrument,
 * effects, macros, volume, pan: on screen or from a controller) becomes the clip's curves, as Live's
 * automation recording (app/move-recorder.ts): a track that only moved controls gets a clip too, and
 * after the take the controls go back where they were, the clip moving them. With the loop the last
 * round's movement wins.
 * What's played is timed as it's heard: the latency compensation (Options › Recording) moves it back. */
import { Emitter, type Unsubscribe } from '../core/emitter';
import type { TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { playingLoop, TimelineTake, type Moment, type TakeClip, type TakeLoop } from '../model/arrangement-take';
import { MidiTrack } from '../model/track';
import { recordedTakes } from '../store/arrangement-takes';
import type { ProjectStore } from '../store/project-store';
import { MoveRecorder, type MoveSpot } from './move-recorder';

/** What the recorder needs from the engine. */
export interface ArrangementRecorderEngine {
  readonly playing: boolean;
  /** What's heard `delay` beats behind the clock (null when stopped). */
  heard(delay: Beats): Moment | null;
  /** Starts playing from the cursor. */
  play(): void;
  onStateChange(fn: (playing: boolean) => void): Unsubscribe;
}

export interface ArrangementRecorderOptions {
  /** The latency compensation, in beats. */
  readonly delay?: () => Beats;
  /** The track is recording into a session slot: its notes go there, not on the timeline. */
  readonly busy?: (track: TrackId) => boolean;
  /** The armed tracks (⌨): their movements are recorded. */
  readonly armed?: () => ReadonlySet<TrackId>;
  /** The track's movements go elsewhere (into the session: a take, or overdub). */
  readonly movesBusy?: (track: TrackId) => boolean;
}

const NO_TRACKS: ReadonlySet<TrackId> = new Set();
/** The shortest stretch that makes a clip. */
const MIN_LENGTH: Beats = 1 / 64;

/** How often the take follows the playhead while recording (ms). */
const CHECK_MS = 50;

/** The take being recorded, for the timeline to show it. */
export interface RecordingTake {
  readonly span: TakeLoop;
  readonly tracks: readonly TrackId[];
}

export class ArrangementRecorder {
  private on = false;
  private take: TimelineTake | null = null;
  /** The last moment seen: when the transport stops the take ends there. */
  private last: Moment | null = null;
  /** The clips written since ● Rec went on. */
  private written = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly events = new Emitter<{ change: [] }>();
  private readonly delay: () => Beats;
  private readonly busy: (track: TrackId) => boolean;
  private readonly armed: () => ReadonlySet<TrackId>;
  private readonly movesBusy: (track: TrackId) => boolean;
  /** The movements of the controls (Options › Recording). */
  private readonly moves: MoveRecorder;
  /** The takes written so far: each one is an undo step. */
  private count = 0;

  constructor(
    private readonly engine: ArrangementRecorderEngine,
    private readonly store: ProjectStore,
    private readonly say: (text: string) => void,
    opts: ArrangementRecorderOptions = {},
  ) {
    this.delay = opts.delay ?? (() => 0);
    this.busy = opts.busy ?? (() => false);
    this.armed = opts.armed ?? (() => NO_TRACKS);
    this.movesBusy = opts.movesBusy ?? this.busy;
    // only takes: there's no overdub on the timeline
    this.moves = new MoveRecorder(store, track => this.moveSpot(track), () => `arrangement record ${this.count}`);
    engine.onStateChange(playing => {
      if (!playing && this.on) this.finish();
    });
  }

  /** The movements of the controls are recorded too. */
  get recordMoves(): boolean {
    return this.moves.on;
  }

  set recordMoves(on: boolean) {
    this.moves.on = on;
  }

  /** ● Rec is on. */
  get recording(): boolean {
    return this.on;
  }

  onChange(fn: () => void): Unsubscribe {
    return this.events.on('change', fn);
  }

  /** The take running now, null if none. */
  get current(): RecordingTake | null {
    return this.take && { span: this.take.span, tracks: this.take.tracks };
  }

  toggle(): void {
    if (this.on) this.finish();
    else this.start();
  }

  press(track: TrackId, pitch: number, velocity: number): void {
    if (!this.records(track)) return;
    const m = this.now();
    if (m) this.take?.press(track, pitch, velocity, m);
  }

  release(track: TrackId, pitch: number): void {
    if (!this.on) return;
    const m = this.now();
    if (m) this.take?.release(track, pitch, m);
  }

  private records(track: TrackId): boolean {
    return this.on && !this.busy(track) && this.store.project.track(track) instanceof MidiTrack;
  }

  private start(): void {
    this.on = true;
    this.written = 0;
    if (!this.engine.playing) this.engine.play();
    this.begin(this.engine.heard(this.delay()));
    this.timer ??= setInterval(() => this.now(), CHECK_MS);
    this.say('Recording on the timeline: play the armed MIDI tracks (⌨ or a MIDI keyboard). ● Rec again, or Stop, ends it.');
    this.events.emit('change');
  }

  private begin(m: Moment | null): void {
    this.last = m;
    this.take = m && new TimelineTake(m, playingLoop(this.store.project.loop, m.beat));
  }

  /** Where the playhead is heard now; the take follows it (after a jump: the take so far is written,
   *  a new one starts there). */
  private now(): Moment | null {
    const m = this.engine.heard(this.delay());
    if (!m) return null;
    if (this.take?.follow(m)) {
      this.last = m;
      return m;
    }
    if (this.take) this.write(this.take, this.last ?? m);
    this.begin(m);
    return m;
  }

  /** Where a movement on `track` falls: the timeline's beat heard now, if the track is armed and
   *  recording here (not after a jump the take hasn't seen yet). */
  private moveSpot(track: TrackId): MoveSpot | null {
    if (!this.on || !this.take || !this.armed().has(track) || this.movesBusy(track)) return null;
    const m = this.engine.heard(this.delay());
    return m && this.take.follow(m) ? { kind: 'take', beat: m.beat } : null;
  }

  /** The take's clips: the tracks with notes and those with movements, over the stretch recorded; the
   *  controls moved go back where they were, in the same undo step. */
  private write(take: TimelineTake, end: Moment): void {
    const { start, end: stop } = take.span, length = stop - start;
    const key = `arrangement record ${++this.count}`, moved = this.moves.takeTracks();
    const notes = new Map(take.clips(end).map(c => [c.track, c]));
    const clips = length < MIN_LENGTH ? [] : [...new Set([...notes.keys(), ...moved])].flatMap((track): TakeClip[] => {
      const envelopes = this.moves.takeCurves(track, length, start), played = notes.get(track);
      return played || envelopes.length ? [{ track, start, length, notes: played?.notes ?? [], envelopes }] : [];
    });
    if (clips.length) {
      this.store.apply(recordedTakes(clips), { mergeKey: key });
      this.written += clips.length;
    }
    for (const track of moved) this.moves.endTake(track, key);
  }

  /** ● Rec off: the take ends where the playhead is (when the transport stopped: where it was last seen). */
  private finish(): void {
    const m = this.engine.playing ? this.now() : null;
    const take = this.take, end = m ?? this.last;
    this.on = false;
    this.take = null;
    this.last = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (take && end) this.write(take, end);
    // without a take nothing is written: the controls moved go back anyway
    else for (const track of this.moves.takeTracks()) this.moves.endTake(track, `arrangement record ${++this.count}`);
    const n = this.written;
    if (n === 0) this.say('Recording stopped: nothing was played or moved on the armed MIDI tracks (⌨).');
    else this.say(n === 1 ? 'Recorded: a new clip on the timeline.' : `Recorded: ${n} new clips on the timeline.`);
    this.events.emit('change');
  }
}
