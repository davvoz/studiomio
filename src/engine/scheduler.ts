import type { Beats, TempoMap } from '../core/music-time';

/** Scheduling window: what must start between `from` and `to` (timeline beats). */
export interface ScheduleWindow {
  readonly from: Beats;
  readonly to: Beats;
  /** Start of the continuous run (play, or start of a loop round). */
  readonly runStart: Beats;
  /** End of the run: end of the loop, or Infinity. Nothing plays beyond. */
  readonly runEnd: Beats;
  readonly tempo: TempoMap;
  /** Audio context instant at which beat `beat` of this run plays. */
  timeAt(beat: Beats): number;
  /** The continuous clock (beats that never jump, for the session) is `beat + shift`
   *  in this run. */
  readonly shift: number;
  /** Clock of the last start from the top (play, or rescheduling after a change):
   *  what was running there restarts from there. At loop rounds it doesn't change. */
  readonly fresh: number;
}

/** Audio context instant at which the continuous clock is `clock`. */
export const timeAtClock = (w: ScheduleWindow, clock: number): number => w.timeAt(clock - w.shift);

/** Something the transport makes play: a track, the metronome, … */
export interface ScheduledSource {
  schedule(window: ScheduleWindow): void;
  /** Stops right away everything it has scheduled. */
  stopAll(): void;
  /** Rescheduling after a change: forgets what it scheduled from `at` (context
   *  seconds) on, without interrupting what's already playing; the transport sends it
   *  right away the windows from `at`, where what's running restarts. */
  retake(at: number): void;
}

export interface LoopRange {
  readonly enabled: boolean;
  readonly start: Beats;
  readonly end: Beats;
}

/** A continuous run of the transport: from beat `beat0`, played at instant `time0`;
 *  the continuous clock is the beat plus `shift`. */
interface Run {
  readonly beat0: Beats;
  readonly time0: number;
  readonly end: Beats;
  readonly shift: number;
}

/** "Lookahead" scheduling: at every `advance(now)` it starts, with exact
 *  audio context times, everything that plays up to `now + lookahead`. It handles the
 *  timeline loop by opening a new run at each round. Next to the timeline's
 *  beats it keeps a continuous clock, which at each round goes forward instead of back. */
export class Scheduler {
  private runs: Run[] = [];
  private scheduledUntil: Beats = 0;
  private fresh = 0;
  private loop: LoopRange = { enabled: false, start: 0, end: 0 };
  private tempo: TempoMap | null = null;

  constructor(
    private readonly sources: () => Iterable<ScheduledSource>,
    private readonly lookahead = 0.2,
  ) {}

  get running(): boolean {
    return this.runs.length > 0;
  }

  /** Starts from beat `beat` at instant `time`, with the clock at `clock` (normally equal to the
   *  beat; after a change during play it continues from where it was). If `beat` is before the
   *  end of the active loop, on reaching the end it goes back to the start of the loop. */
  start(beat: Beats, time: number, tempo: TempoMap, loop: LoopRange, clock: number = beat): void {
    this.tempo = tempo;
    this.loop = loop;
    const looping = loop.enabled && loop.end > loop.start && beat < loop.end;
    this.runs = [{ beat0: beat, time0: time, end: looping ? loop.end : Infinity, shift: clock - beat }];
    this.scheduledUntil = beat;
    this.fresh = clock;
  }

  /** Restarts from instant `time` with new tempo and loop without stopping anything: what has already
   *  started ends as planned, the rest each source picks up from there (see `retake`).
   *  `time` must fall within what's already scheduled. */
  resumeAt(time: number, tempo: TempoMap, loop: LoopRange): void {
    const beat = this.positionAt(time), clock = this.clockAt(time);
    if (beat === null || clock === null) return;
    for (const s of this.sources()) s.retake(time);
    this.start(beat, time, tempo, loop, clock);
  }

  /** Only `sources` resume from instant `time` (the changed tracks): they forget what
   *  they had scheduled from there and receive again the windows as far as it was scheduled. The
   *  other sources and the runs stay as they are. `time` must fall within what's already
   *  scheduled. */
  retake(time: number, sources: readonly ScheduledSource[]): void {
    const tempo = this.tempo, clock = this.clockAt(time);
    if (!tempo || clock === null || !sources.length) return;
    for (const s of sources) s.retake(time);
    this.runs.forEach((run, i) => {
      const last = i === this.runs.length - 1;
      if (!last && run.time0 + tempo.secondsAt(run.end - run.beat0) <= time) return; // round already finished
      const from = Math.max(run.beat0, run.beat0 + tempo.beatAt(time - run.time0));
      const to = last ? this.scheduledUntil : run.end;
      // what's running at `from` restarts from there, also the session clips
      if (to > from) this.emit(run, from, to, sources, from, clock);
    });
  }

  /** The clock at instant `time` (null if stopped). */
  clockAt(time: number): number | null {
    const tempo = this.tempo, run = this.runAt(time);
    return tempo && run ? run.beat0 + run.shift + tempo.beatAt(Math.max(0, time - run.time0)) : null;
  }

  /** How far on the clock everything is already scheduled: a change decided now can apply from here. */
  get scheduledClock(): number {
    const run = this.runs[this.runs.length - 1];
    return run ? this.scheduledUntil + run.shift : 0;
  }

  /** Clock of the last start from the top. */
  get freshClock(): number {
    return this.fresh;
  }

  /** Instant at which the clock is `clock` (it flows without jumps, so the last run is enough). */
  timeAtClock(clock: number): number {
    const run = this.runs[this.runs.length - 1];
    if (!run || !this.tempo) return 0;
    return run.time0 + this.tempo.secondsAt(clock - run.shift - run.beat0);
  }

  /** Schedules up to `now + lookahead`. */
  advance(now: number): void {
    const tempo = this.tempo;
    if (!tempo || !this.runs.length) return;
    const horizon = now + this.lookahead;
    for (;;) {
      const run = this.runs[this.runs.length - 1];
      const target = Math.min(run.beat0 + tempo.beatAt(horizon - run.time0), run.end);
      if (target > this.scheduledUntil) {
        this.emit(run, this.scheduledUntil, target);
        this.scheduledUntil = target;
      }
      if (this.scheduledUntil < run.end) break;
      // end of the round: the next run restarts from the start of the loop
      const time0 = run.time0 + tempo.secondsAt(run.end - run.beat0);
      const shift = run.end + run.shift - this.loop.start;
      this.runs = [...this.runs.slice(-2), { beat0: this.loop.start, time0, end: this.loop.end, shift }];
      this.scheduledUntil = this.loop.start;
    }
  }

  /** All of [from, to) at once, from instant `time` (offline export). */
  scheduleRange(from: Beats, to: Beats, time: number, tempo: TempoMap): void {
    this.tempo = tempo;
    const run = { beat0: from, time0: time, end: to, shift: 0 };
    this.runs = [run];
    this.fresh = from;
    this.emit(run, from, to);
    this.scheduledUntil = to;
  }

  stop(): void {
    this.runs = [];
    for (const s of this.sources()) s.stopAll();
  }

  /** Timeline beat playing at instant `time`. */
  positionAt(time: number): Beats | null {
    const tempo = this.tempo, run = this.runAt(time);
    if (!tempo || !run) return null;
    return Math.min(run.beat0 + tempo.beatAt(Math.max(0, time - run.time0)), run.end);
  }

  private runAt(time: number): Run | undefined {
    return [...this.runs].reverse().find(r => r.time0 <= time) ?? this.runs[0];
  }

  private emit(
    run: Run, from: Beats, to: Beats, sources: Iterable<ScheduledSource> = this.sources(), runStart = run.beat0, fresh = this.fresh,
  ): void {
    const tempo = this.tempo!;
    const window: ScheduleWindow = {
      from, to, runStart, runEnd: run.end, tempo,
      timeAt: beat => run.time0 + tempo.secondsAt(beat - run.beat0),
      shift: run.shift, fresh,
    };
    for (const s of sources) s.schedule(window);
  }
}
