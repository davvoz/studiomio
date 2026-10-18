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
  /** L'orologio continuo (battiti che non saltano mai, per la session) vale `beat + shift`
   *  in questa corsa. */
  readonly shift: number;
  /** Orologio dell'ultima partenza da capo (play, o riprogrammazione dopo una modifica):
   *  ciò che era in corso lì riparte da lì. Ai giri di loop non cambia. */
  readonly fresh: number;
}

/** Istante del contesto audio in cui l'orologio continuo vale `clock`. */
export const timeAtClock = (w: ScheduleWindow, clock: number): number => w.timeAt(clock - w.shift);

/** Qualcosa che il trasporto fa suonare: una traccia, il metronomo, … */
export interface ScheduledSource {
  schedule(window: ScheduleWindow): void;
  /** Ferma subito tutto ciò che ha programmato. */
  stopAll(): void;
  /** Riprogrammazione dopo una modifica: dimentica ciò che ha programmato da `at` (secondi del
   *  contesto) in poi, senza interrompere ciò che sta già suonando; il trasporto gli manda
   *  subito le finestre da `at`, dove ciò che è in corso riparte. */
  retake(at: number): void;
}

export interface LoopRange {
  readonly enabled: boolean;
  readonly start: Beats;
  readonly end: Beats;
}

/** Una corsa continua del trasporto: dal battito `beat0`, suonato all'istante `time0`;
 *  l'orologio continuo vale il battito più `shift`. */
interface Run {
  readonly beat0: Beats;
  readonly time0: number;
  readonly end: Beats;
  readonly shift: number;
}

/** Programmazione "in anticipo" (lookahead): a ogni `advance(now)` fa partire, con orari
 *  esatti del contesto audio, tutto ciò che suona fino a `now + lookahead`. Gestisce il
 *  loop della timeline aprendo una nuova corsa a ogni giro. Accanto ai battiti della
 *  timeline tiene un orologio continuo, che a ogni giro va avanti invece di tornare indietro. */
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

  /** Parte dal battito `beat` all'istante `time`, con l'orologio a `clock` (di norma uguale al
   *  battito; dopo una modifica durante il play continua da dove era). Se `beat` è prima della
   *  fine del loop attivo, arrivati in fondo si torna all'inizio del loop. */
  start(beat: Beats, time: number, tempo: TempoMap, loop: LoopRange, clock: number = beat): void {
    this.tempo = tempo;
    this.loop = loop;
    const looping = loop.enabled && loop.end > loop.start && beat < loop.end;
    this.runs = [{ beat0: beat, time0: time, end: looping ? loop.end : Infinity, shift: clock - beat }];
    this.scheduledUntil = beat;
    this.fresh = clock;
  }

  /** Riparte dall'istante `time` con tempo e loop nuovi senza fermare niente: ciò che è già
   *  partito finisce come previsto, il resto ogni sorgente lo riprende da lì (vedi `retake`).
   *  `time` deve cadere entro ciò che è già programmato. */
  resumeAt(time: number, tempo: TempoMap, loop: LoopRange): void {
    const beat = this.positionAt(time), clock = this.clockAt(time);
    if (beat === null || clock === null) return;
    for (const s of this.sources()) s.retake(time);
    this.start(beat, time, tempo, loop, clock);
  }

  /** Solo `sources` riprendono dall'istante `time` (le tracce modificate): dimenticano ciò che
   *  avevano programmato da lì e ricevono di nuovo le finestre fin dove si è programmato. Le
   *  altre sorgenti e le corse restano come sono. `time` deve cadere entro ciò che è già
   *  programmato. */
  retake(time: number, sources: readonly ScheduledSource[]): void {
    const tempo = this.tempo, clock = this.clockAt(time);
    if (!tempo || clock === null || !sources.length) return;
    for (const s of sources) s.retake(time);
    this.runs.forEach((run, i) => {
      const last = i === this.runs.length - 1;
      if (!last && run.time0 + tempo.secondsAt(run.end - run.beat0) <= time) return; // giro già finito
      const from = Math.max(run.beat0, run.beat0 + tempo.beatAt(time - run.time0));
      const to = last ? this.scheduledUntil : run.end;
      // ciò che è in corso a `from` riparte da lì, anche le clip della session
      if (to > from) this.emit(run, from, to, sources, from, clock);
    });
  }

  /** L'orologio all'istante `time` (null se fermo). */
  clockAt(time: number): number | null {
    const tempo = this.tempo, run = this.runAt(time);
    return tempo && run ? run.beat0 + run.shift + tempo.beatAt(Math.max(0, time - run.time0)) : null;
  }

  /** Fin dove dell'orologio è già tutto programmato: un cambio deciso ora può valere da qui. */
  get scheduledClock(): number {
    const run = this.runs[this.runs.length - 1];
    return run ? this.scheduledUntil + run.shift : 0;
  }

  /** Orologio dell'ultima partenza da capo. */
  get freshClock(): number {
    return this.fresh;
  }

  /** Istante in cui l'orologio vale `clock` (scorre senza salti, quindi basta l'ultima corsa). */
  timeAtClock(clock: number): number {
    const run = this.runs[this.runs.length - 1];
    if (!run || !this.tempo) return 0;
    return run.time0 + this.tempo.secondsAt(clock - run.shift - run.beat0);
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
      const shift = run.end + run.shift - this.loop.start;
      this.runs = [...this.runs.slice(-2), { beat0: this.loop.start, time0, end: this.loop.end, shift }];
      this.scheduledUntil = this.loop.start;
    }
  }

  /** Tutto [from, to) in una volta, dall'istante `time` (export offline). */
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

  /** Battito della timeline che suona all'istante `time`. */
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
