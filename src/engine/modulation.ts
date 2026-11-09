/* The clip modulations in the engine. For each track a TrackModulator watches, like the players,
 * which clip stretches play in each scheduling window and for their curves schedules
 * steps and ramps in advance on the targets: the channel's AudioParams (volume and pan) or the
 * device parameters in the AudioWorklet. Outside the clips (and where a clip doesn't have the
 * curve) each target goes back to neutral. A MasterModulator does the same with the master's curves
 * on the timeline. */
import type { Placement } from '../model/arrangement';
import type { Clip } from '../model/clip';
import { envelopeValueAt, scaleKindOf, scaleOf, targetKey, type ClipEnvelope, type ModScaleKind, type ModTarget } from '../model/envelope';
import type { Track } from '../model/track';
import type { AudioParamLike } from './audio-graph';
import { timeAtClock, type ScheduledSource, type ScheduleWindow } from './scheduler';
import { placementSegments, type Segment } from './segments';
import type { Program } from './session';
import { piecesInWindow } from './track-content';

/** Where a modulation goes: it receives steps and ramps with the instant (context seconds). */
export interface ModSink {
  set(value: number, time: number): void;
  /** Linear ramp from the previous event's value up to `value` at instant `time`. */
  ramp(value: number, time: number): void;
  /** From `time` the current value stays; what was scheduled after is forgotten. */
  hold(time: number): void;
}

/** The modulatable parameters of a playing device (instrument or effect). */
export interface DeviceModulation {
  /** The parameter's offset, in fractions of the knob's travel (−1 … +1), in channel
   *  `channel` (absent: the clip curves' one). A parameter's channels add up. */
  sink(param: string, channel?: string): ModSink;
}

/** An AudioParam as a modulation destination. */
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

/** A modulation moving others, each scaled: a macro moves the mapped parameters
 *  by the part of the travel the macro gives each one. */
export function scaledSinks(targets: readonly { readonly sink: ModSink; readonly scale: number }[]): ModSink {
  return {
    set: (v, t) => { for (const x of targets) x.sink.set(v * x.scale, t); },
    ramp: (v, t) => { for (const x of targets) x.sink.ramp(v * x.scale, t); },
    hold: t => { for (const x of targets) x.sink.hold(t); },
  };
}

/** A snapping modulation: for a switch (a toggle or button macro), the curve
 *  past halfway takes it to the other end, before that nothing. Off (`on` false) it snaps up at
 *  +½ and goes to +1; on it snaps down at −½ and goes to −1. The ramps become a step
 *  at the exact instant the curve crosses the half. */
export function switchSink(inner: ModSink, on: boolean): ModSink {
  const threshold = on ? -0.5 : 0.5, full = on ? -1 : 1;
  const crossed = (v: number) => (on ? v <= threshold : v >= threshold);
  const step = (v: number) => (crossed(v) ? full : 0);
  let last = { value: 0, time: -Infinity };
  return {
    set: (v, t) => {
      inner.set(step(v), t);
      last = { value: v, time: t };
    },
    ramp: (v, t) => {
      const from = step(last.value), to = step(v);
      if (from !== to) {
        const at = Number.isFinite(last.time) ? last.time + ((t - last.time) * (threshold - last.value)) / (v - last.value) : t;
        inner.set(to, at);
      }
      last = { value: v, time: t };
    },
    hold: t => inner.hold(t),
  };
}

/** How a curve's value reaches the target. `curved`: the map isn't a straight line, so
 *  the ramps are broken into short stretches to follow the drawn curve. */
const OUTPUT: { readonly [K in ModScaleKind]: { readonly map: (v: number) => number; readonly curved: boolean } } = {
  // the volume goes to the gain with a square: half curve ≈ −12 dB, as it's heard
  volume: { map: v => v * v, curved: true },
  pan: { map: v => v, curved: false },
  param: { map: v => v, curved: false },
  // the transpose is played by the audio clip itself (see AudioTrackPlayer): it doesn't arrive here
  transpose: { map: v => v, curved: false },
};

/** Maximum length (in beats) of a ramp stretch for the curved maps. */
const CURVE_STEP = 1 / 16;
const EPS = 1e-9;

/** A target's neutral value, as it reaches the destination. */
const neutralOf = (t: ModTarget) => OUTPUT[scaleKindOf(t)].map(scaleOf(t).neutral);

/** True if some clip of the track (timeline or slot) has modulations. */
const hasEnvelopes = (t: Track) => t.arrangement.some(p => p.clip.envelopes.length) || t.slots.some(c => !!c?.envelopes.length);

/** A stretch in which a curve plays: from `start` to `end` (continuous clock) the curve's beat
 *  goes from `contentStart` onwards, without jumps. */
interface CurveSpan {
  readonly start: number;
  readonly end: number;
  readonly contentStart: number;
}

/** What the curve sources have in common: they schedule steps and ramps on the targets and
 *  remember them, to bring them back to neutral when the curve ends, something changes or it stops. */
abstract class CurveModulator implements ScheduledSource {
  /** The targets already touched, to bring them back to neutral. */
  private readonly touched = new Map<string, { readonly target: ModTarget; sink: ModSink }>();
  /** After a rescheduling: targets holding the previous value until the first
   *  new window picks them up (or, if the curve is gone, brings them back to neutral). */
  private stale = false;

  constructor(
    private readonly sinkOf: (target: ModTarget) => ModSink | null,
    private readonly now: () => number,
  ) {}

  /** The curves playing in the window, each with its stretch. */
  protected abstract curves(w: ScheduleWindow): Iterable<{ readonly envelopes: readonly ClipEnvelope[]; readonly span: CurveSpan }>;

  schedule(w: ScheduleWindow): void {
    if (this.stale) {
      // first all neutral from the start of the window: the curves still there, scheduled
      // right after at the same instant, take their place
      this.stale = false;
      const t = w.timeAt(w.from);
      for (const { target, sink } of this.touched.values()) sink.set(neutralOf(target), t);
    }
    for (const { envelopes, span } of this.curves(w)) {
      for (const env of envelopes) this.play(env, span, w);
    }
  }

  /** Rescheduling: what was scheduled is forgotten, the current value stays until
   *  the new windows pick it up (no jumps while playing). */
  stopAll(): void {
    const t = this.now();
    for (const { sink } of this.touched.values()) sink.hold(t);
    this.stale = this.touched.size > 0;
  }

  /** Rescheduling from `at`: up to there what was scheduled stays, then the new windows
   *  pick up the targets (or bring them back to neutral). */
  retake(at: number): void {
    for (const { sink } of this.touched.values()) sink.hold(at);
    this.stale = this.touched.size > 0;
  }

  /** From `at` (seconds) all the touched targets go back to neutral: a clip launched in place of
   *  the one playing brings its own curves, or none. */
  cut(at: number): void {
    for (const { target, sink } of this.touched.values()) {
      sink.hold(at);
      sink.set(neutralOf(target), at);
    }
  }

  /** Transport stopped: everything neutral right away. */
  reset(): void {
    this.cut(this.now());
    this.touched.clear();
    this.stale = false;
  }

  /** The part of the curve falling in the window: a step at the start (the same value as the
   *  ramp arriving there, so no jump), the ramps towards the points, the ramp up to the end
   *  of the window; where the stretch ends, the target goes back to neutral. */
  private play(env: ClipEnvelope, span: CurveSpan, w: ScheduleWindow): void {
    const from = Math.max(w.from + w.shift, span.start), to = Math.min(w.to + w.shift, span.end);
    if (to - from <= EPS || !env.points.length) return;
    const sink = this.sinkFor(env.target);
    if (!sink) return;
    const out = OUTPUT[scaleKindOf(env.target)];
    const time = (c: number) => timeAtClock(w, span.start + (c - span.contentStart));
    const c0 = span.contentStart + (from - span.start), c1 = span.contentStart + (to - span.start);
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
    if (Math.abs(to - span.end) <= EPS) sink.set(neutralOf(env.target), time(c1));
  }

  private sinkFor(target: ModTarget): ModSink | null {
    const sink = this.sinkOf(target);
    if (sink) this.touched.set(targetKey(target), { target, sink });
    return sink;
  }
}

/** A track's modulations, scheduled together with the rest (it's a scheduler source). */
export class TrackModulator extends CurveModulator {
  private track: Track;
  private active: boolean;
  private readonly segments = new WeakMap<Placement, Segment[]>();

  constructor(
    track: Track,
    private readonly programs: () => readonly Program[],
    sinkOf: (target: ModTarget) => ModSink | null,
    now: () => number,
  ) {
    super(sinkOf, now);
    this.track = track;
    this.active = hasEnvelopes(track);
  }

  update(track: Track): void {
    if (track === this.track) return;
    this.track = track;
    this.active = hasEnvelopes(track);
  }

  protected *curves(w: ScheduleWindow): Iterable<{ readonly envelopes: readonly ClipEnvelope[]; readonly span: CurveSpan }> {
    if (!this.active) return;
    for (const piece of piecesInWindow(this.track as Track<Clip>, this.programs(), w, p => this.segmentsOf(p))) {
      yield { envelopes: piece.clip.envelopes, span: piece };
    }
  }

  private segmentsOf(p: Placement): Segment[] {
    let s = this.segments.get(p);
    if (!s) this.segments.set(p, (s = placementSegments(p)));
    return s;
  }
}

/** The master's curves on the timeline: they play for the whole run of the transport (at every loop
 *  round they restart from the start of the loop), on the devices and macros of the master's chain. */
export class MasterModulator extends CurveModulator {
  private lanes: readonly ClipEnvelope[];

  constructor(lanes: readonly ClipEnvelope[], sinkOf: (target: ModTarget) => ModSink | null, now: () => number) {
    super(sinkOf, now);
    this.lanes = lanes;
  }

  /** The new curves; true if they changed. */
  update(lanes: readonly ClipEnvelope[]): boolean {
    if (lanes === this.lanes) return false;
    this.lanes = lanes;
    return true;
  }

  protected *curves(w: ScheduleWindow): Iterable<{ readonly envelopes: readonly ClipEnvelope[]; readonly span: CurveSpan }> {
    if (!this.lanes.length) return;
    // in the run timeline beat b plays at clock b + shift
    yield { envelopes: this.lanes, span: { start: w.runStart + w.shift, end: w.runEnd + w.shift, contentStart: w.runStart } };
  }
}
