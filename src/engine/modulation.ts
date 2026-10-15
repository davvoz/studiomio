/* Le modulazioni delle clip nel motore. Per ogni traccia un TrackModulator guarda, come i player,
 * quali tratti di clip suonano in ogni finestra di programmazione e per le loro curve programma
 * in anticipo scalini e rampe sui bersagli: gli AudioParam del canale (volume e pan) o i
 * parametri dei dispositivi nell'AudioWorklet. Fuori dalle clip (e dove una clip non ha la
 * curva) ogni bersaglio torna neutro. */
import type { Placement } from '../model/arrangement';
import type { Clip } from '../model/clip';
import { envelopeValueAt, scaleKindOf, scaleOf, targetKey, type ClipEnvelope, type ModScaleKind, type ModTarget } from '../model/envelope';
import type { Track } from '../model/track';
import type { AudioParamLike } from './audio-graph';
import { timeAtClock, type ScheduledSource, type ScheduleWindow } from './scheduler';
import { placementSegments, type Segment } from './segments';
import type { Program } from './session';
import { piecesInWindow, type Piece } from './track-content';

/** Dove va una modulazione: riceve scalini e rampe con l'istante (secondi del contesto). */
export interface ModSink {
  set(value: number, time: number): void;
  /** Rampa lineare dal valore dell'evento prima fino a `value` all'istante `time`. */
  ramp(value: number, time: number): void;
  /** Da `time` resta il valore che c'è; ciò che era programmato dopo si dimentica. */
  hold(time: number): void;
}

/** I parametri modulabili di un dispositivo che suona (strumento o effetto). */
export interface DeviceModulation {
  /** Lo spostamento del parametro, in frazioni della corsa della manopola (−1 … +1). */
  sink(param: string): ModSink;
}

/** Un AudioParam come destinazione delle modulazioni. */
export function audioParamSink(param: AudioParamLike): ModSink {
  return {
    set: (v, t) => param.setValueAtTime(v, t),
    ramp: (v, t) => param.linearRampToValueAtTime(v, t),
    hold: t => {
      if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
      else param.cancelScheduledValues(t);
    },
  };
}

/** Una modulazione che ne muove altre, ognuna in scala: una macro sposta i parametri mappati
 *  della parte di corsa che la macro dà a ciascuno. */
export function scaledSinks(targets: readonly { readonly sink: ModSink; readonly scale: number }[]): ModSink {
  return {
    set: (v, t) => { for (const x of targets) x.sink.set(v * x.scale, t); },
    ramp: (v, t) => { for (const x of targets) x.sink.ramp(v * x.scale, t); },
    hold: t => { for (const x of targets) x.sink.hold(t); },
  };
}

/** Come il valore di una curva arriva al bersaglio. `curved`: la mappa non è una retta, quindi
 *  le rampe si spezzano in tratti brevi per seguire la curva disegnata. */
const OUTPUT: { readonly [K in ModScaleKind]: { readonly map: (v: number) => number; readonly curved: boolean } } = {
  // il volume va al guadagno con un quadrato: metà curva ≈ −12 dB, come si sente
  volume: { map: v => v * v, curved: true },
  pan: { map: v => v, curved: false },
  param: { map: v => v, curved: false },
};

/** Lunghezza massima (in battiti) di un tratto di rampa per le mappe curve. */
const CURVE_STEP = 1 / 16;
const EPS = 1e-9;

/** Il valore neutro di un bersaglio, come arriva alla destinazione. */
const neutralOf = (t: ModTarget) => OUTPUT[scaleKindOf(t)].map(scaleOf(t).neutral);

/** Vero se qualche clip della traccia (timeline o slot) ha delle modulazioni. */
const hasEnvelopes = (t: Track) => t.arrangement.some(p => p.clip.envelopes.length) || t.slots.some(c => !!c?.envelopes.length);

/** Le modulazioni di una traccia, programmate insieme al resto (è una sorgente dello scheduler). */
export class TrackModulator implements ScheduledSource {
  private track: Track;
  private active: boolean;
  private readonly segments = new WeakMap<Placement, Segment[]>();
  /** I bersagli già toccati, per riportarli neutri. */
  private readonly touched = new Map<string, { readonly target: ModTarget; sink: ModSink }>();
  /** Dopo una riprogrammazione: bersagli che tengono il valore di prima finché la prima
   *  finestra nuova non li riprende (o, se la clip non ha più la curva, li riporta neutri). */
  private stale = false;

  constructor(
    track: Track,
    private readonly programs: () => readonly Program[],
    private readonly sinkOf: (target: ModTarget) => ModSink | null,
    private readonly now: () => number,
  ) {
    this.track = track;
    this.active = hasEnvelopes(track);
  }

  update(track: Track): void {
    if (track === this.track) return;
    this.track = track;
    this.active = hasEnvelopes(track);
  }

  schedule(w: ScheduleWindow): void {
    if (this.stale) {
      // prima tutti neutri dall'inizio della finestra: le curve che ci sono ancora, programmate
      // subito dopo allo stesso istante, prendono il loro posto
      this.stale = false;
      const t = w.timeAt(w.from);
      for (const { target, sink } of this.touched.values()) sink.set(neutralOf(target), t);
    }
    if (!this.active) return;
    for (const piece of piecesInWindow(this.track as Track<Clip>, this.programs(), w, p => this.segmentsOf(p))) {
      for (const env of piece.clip.envelopes) this.play(env, piece, w);
    }
  }

  /** Riprogrammazione: ciò che era programmato si dimentica, il valore di adesso resta finché
   *  le finestre nuove non lo riprendono (niente salti mentre suona). */
  stopAll(): void {
    const t = this.now();
    for (const { sink } of this.touched.values()) sink.hold(t);
    this.stale = this.touched.size > 0;
  }

  /** Da `at` (secondi) tutti i bersagli toccati tornano neutri: una clip lanciata al posto di
   *  quella che suonava porta le sue curve, o nessuna. */
  cut(at: number): void {
    for (const { target, sink } of this.touched.values()) {
      sink.hold(at);
      sink.set(neutralOf(target), at);
    }
  }

  /** Trasporto fermo: tutto neutro da subito. */
  reset(): void {
    this.cut(this.now());
    this.touched.clear();
    this.stale = false;
  }

  /** La parte della curva che cade nella finestra: uno scalino all'inizio (lo stesso valore della
   *  rampa che arriva lì, quindi nessun salto), le rampe verso i punti, la rampa fino alla fine
   *  della finestra; dove il tratto finisce, il bersaglio torna neutro. */
  private play(env: ClipEnvelope, piece: Piece, w: ScheduleWindow): void {
    const from = Math.max(w.from + w.shift, piece.start), to = Math.min(w.to + w.shift, piece.end);
    if (to - from <= EPS || !env.points.length) return;
    const sink = this.sinkFor(env.target);
    if (!sink) return;
    const out = OUTPUT[scaleKindOf(env.target)];
    const time = (c: number) => timeAtClock(w, piece.start + (c - piece.contentStart));
    const c0 = piece.contentStart + (from - piece.start), c1 = piece.contentStart + (to - piece.start);
    let prevC = c0, prevV = envelopeValueAt(env.points, c0);
    sink.set(out.map(prevV), time(c0));
    const rampTo = (c: number, v: number) => {
      if (out.curved) {
        const steps = Math.max(1, Math.min(64, Math.ceil((c - prevC) / CURVE_STEP)));
        for (let k = 1; k < steps; k++) sink.ramp(out.map(prevV + ((v - prevV) * k) / steps), time(prevC + ((c - prevC) * k) / steps));
      }
      sink.ramp(out.map(v), time(c));
      prevC = c;
      prevV = v;
    };
    for (const p of env.points) if (p.beat > c0 && p.beat < c1) rampTo(p.beat, p.value);
    rampTo(c1, envelopeValueAt(env.points, c1));
    if (Math.abs(to - piece.end) <= EPS) sink.set(neutralOf(env.target), time(c1));
  }

  private sinkFor(target: ModTarget): ModSink | null {
    const sink = this.sinkOf(target);
    if (sink) this.touched.set(targetKey(target), { target, sink });
    return sink;
  }

  private segmentsOf(p: Placement): Segment[] {
    let s = this.segments.get(p);
    if (!s) this.segments.set(p, (s = placementSegments(p)));
    return s;
  }
}
