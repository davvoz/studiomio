import type { Beats, TempoMap } from '../core/music-time';

/** Finestra di programmazione: cosa deve partire tra `from` e `to` (battiti della timeline). */
export interface ScheduleWindow {
  readonly from: Beats;
  readonly to: Beats;
  /** Inizio della corsa continua (play, o inizio di un giro di loop). */
  readonly runStart: Beats;
  /** Fine della corsa: fine del loop, o Infinity. Niente suona oltre. */
  readonly runEnd: Beats;
  readonly tempo: TempoMap;
  /** Istante del contesto audio in cui suona il battito `beat` di questa corsa. */
  timeAt(beat: Beats): number;
}

/** Qualcosa che il trasporto fa suonare: una traccia, il metronomo, … */
export interface ScheduledSource {
  schedule(window: ScheduleWindow): void;
  /** Ferma subito tutto ciò che ha programmato. */
  stopAll(): void;
}

export interface LoopRange {
  readonly enabled: boolean;
  readonly start: Beats;
  readonly end: Beats;
}

/** Una corsa continua del trasporto: dal battito `beat0`, suonato all'istante `time0`. */
interface Run {
  readonly beat0: Beats;
  readonly time0: number;
  readonly end: Beats;
}

/** Programmazione "in anticipo" (lookahead): a ogni `advance(now)` fa partire, con orari
 *  esatti del contesto audio, tutto ciò che suona fino a `now + lookahead`. Gestisce il
 *  loop della timeline aprendo una nuova corsa a ogni giro. */
export class Scheduler {
  private runs: Run[] = [];
  private scheduledUntil: Beats = 0;
  private loop: LoopRange = { enabled: false, start: 0, end: 0 };
  private tempo: TempoMap | null = null;

  constructor(
    private readonly sources: () => Iterable<ScheduledSource>,
    private readonly lookahead = 0.2,
  ) {}

  get running(): boolean {
    return this.runs.length > 0;
  }

  /** Parte dal battito `beat` all'istante `time`. Se `beat` è prima della fine del loop
   *  attivo, arrivati in fondo si torna all'inizio del loop. */
  start(beat: Beats, time: number, tempo: TempoMap, loop: LoopRange): void {
    this.tempo = tempo;
    this.loop = loop;
    const looping = loop.enabled && loop.end > loop.start && beat < loop.end;
    this.runs = [{ beat0: beat, time0: time, end: looping ? loop.end : Infinity }];
    this.scheduledUntil = beat;
  }

  /** Programma fino a `now + lookahead`. */
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
      // fine del giro: la corsa successiva riparte dall'inizio del loop
      const time0 = run.time0 + tempo.secondsAt(run.end - run.beat0);
      this.runs = [...this.runs.slice(-2), { beat0: this.loop.start, time0, end: this.loop.end }];
      this.scheduledUntil = this.loop.start;
    }
  }

  /** Tutto [from, to) in una volta, dall'istante `time` (export offline). */
  scheduleRange(from: Beats, to: Beats, time: number, tempo: TempoMap): void {
    this.tempo = tempo;
    const run = { beat0: from, time0: time, end: to };
    this.runs = [run];
    this.emit(run, from, to);
    this.scheduledUntil = to;
  }

  stop(): void {
    this.runs = [];
    for (const s of this.sources()) s.stopAll();
  }

  /** Battito della timeline che suona all'istante `time`. */
  positionAt(time: number): Beats | null {
    const tempo = this.tempo;
    if (!tempo || !this.runs.length) return null;
    const run = [...this.runs].reverse().find(r => r.time0 <= time) ?? this.runs[0];
    return Math.min(run.beat0 + tempo.beatAt(Math.max(0, time - run.time0)), run.end);
  }

  private emit(run: Run, from: Beats, to: Beats): void {
    const tempo = this.tempo!;
    const window: ScheduleWindow = {
      from, to, runStart: run.beat0, runEnd: run.end, tempo,
      timeAt: beat => run.time0 + tempo.secondsAt(beat - run.beat0),
    };
    for (const s of this.sources()) s.schedule(window);
  }
}
