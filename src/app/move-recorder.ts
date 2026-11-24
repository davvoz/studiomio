/* Recording the movements of the controls into the clips, as Live's Automation Arm in the session:
 * while it's on, a control of a recording track that moves (on screen, from a controller, a mapped
 * key, a macro: whatever changes it) is a gesture, in clip beats. In a take the gestures become the
 * new clip's curves when it's written; in overdub a gesture is written over the playing clip's curve
 * once the control stays still, and is heard at the next turn. Either way the control goes back where it
 * was and the curve moves it: the clip replays the gesture. What's recorded is found by comparing
 * the track before and after each change of the project. */
import type { ClipId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { scaleOf, targetKey, type ClipEnvelope } from '../model/envelope';
import { thinned, touched } from '../model/move-take';
import type { Project } from '../model/project';
import { MidiTrack } from '../model/track';
import type { ProjectStore } from '../store/project-store';
import { touchCurve, type SlotRef } from '../store/session-edits';
import { gestureCurve, trackKnobs, type Knob } from './track-knobs';

/** Where a movement on a track falls now: in the take being recorded, or in the overdubbed clip. */
export type MoveSpot =
  | { readonly kind: 'take'; readonly beat: Beats }
  | { readonly kind: 'overdub'; readonly ref: SlotRef; readonly clip: ClipId; readonly beat: Beats };

interface Gesture {
  readonly track: TrackId;
  readonly base: Knob;
  /** Overdub: the clip it goes into (null: a take). */
  into: { readonly ref: SlotRef; readonly clip: ClipId } | null;
  samples: { beat: Beats; knob: Knob }[];
  /** When the control last moved (ms). */
  last: number;
}

/** An overdub gesture is written when its control has been still this long (ms). */
const IDLE_MS = 300;
const CHECK_MS = 100;

export class MoveRecorder {
  /** Movements are recorded (Options › Recording). */
  on = false;
  private snapshot: Project;
  private readonly gestures = new Map<string, Gesture>();
  /** The recorder's own changes aren't movements. */
  private writing = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: ProjectStore,
    private readonly spotOf: (track: TrackId) => MoveSpot | null,
    /** The undo step overdub gestures join. */
    private readonly overdubKey: () => string,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.snapshot = store.project;
    store.onChange(p => this.changed(p));
  }

  /** The curves of the take recorded on `track`, for its clip `length` beats long. */
  takeCurves(track: TrackId, length: Beats): ClipEnvelope[] {
    const out: ClipEnvelope[] = [];
    for (const g of this.gestures.values()) {
      if (g.track !== track || g.into) continue;
      const curve = gestureCurve(g.base, g.samples.filter(s => s.beat < length));
      const scale = scaleOf(g.base.target);
      const points = touched([], thinned(curve.points, scale), scale.neutral * curve.scale);
      if (points.length) out.push({ target: g.base.target, points });
    }
    return out;
  }

  /** The take on `track` is written: its controls go back (in its undo step `key`), its gestures end. */
  endTake(track: TrackId, key: string): void {
    for (const [id, g] of this.gestures) {
      if (g.track !== track || g.into) continue;
      this.gestures.delete(id);
      this.write(() => this.store.apply(g.base.set(gestureCurve(g.base, g.samples).rest), { mergeKey: key }));
    }
  }

  /** The overdub gestures are written now (overdub off, transport stopped). */
  flushOverdubs(): void {
    for (const g of this.gestures.values()) if (g.into) this.finish(g);
    this.stopTimer();
  }

  private changed(p: Project): void {
    const before = this.snapshot;
    this.snapshot = p;
    if (this.writing || !this.on) return;
    for (const t of p.tracks) {
      // the project is immutable: a track that didn't change is the same object
      if (!(t instanceof MidiTrack) || before.track(t.id) === t) continue;
      const spot = this.spotOf(t.id);
      if (!spot) continue;
      const old = trackKnobs(before, t.id);
      for (const [key, knob] of trackKnobs(p, t.id)) {
        const was = old.get(key);
        if (was && was.raw !== knob.raw) this.sample(t.id, was, knob, spot);
      }
    }
  }

  private sample(track: TrackId, was: Knob, knob: Knob, spot: MoveSpot): void {
    const id = `${track}|${targetKey(was.target)}`;
    let g = this.gestures.get(id);
    if (g && !this.continues(g, spot)) {
      if (g.into && spot.kind === 'overdub') {
        // the loop came round (or another clip plays): the stretch so far is written, the gesture goes on
        this.writeCurve(g);
        g.into = { ref: spot.ref, clip: spot.clip };
        g.samples = [];
      } else {
        this.finish(g);
        g = undefined;
      }
    }
    if (!g) {
      g = { track, base: was, into: spot.kind === 'overdub' ? { ref: spot.ref, clip: spot.clip } : null, samples: [], last: 0 };
      this.gestures.set(id, g);
    }
    g.samples.push({ beat: spot.beat, knob });
    g.last = this.now();
    if (g.into) this.timer ??= setInterval(() => this.check(), CHECK_MS);
  }

  private continues(g: Gesture, spot: MoveSpot): boolean {
    if (!g.into) return spot.kind === 'take';
    return spot.kind === 'overdub' && spot.clip === g.into.clip && spot.beat >= g.samples.at(-1)!.beat;
  }

  /** The overdub gestures whose control has been still long enough are written. */
  private check(): void {
    const now = this.now();
    for (const g of this.gestures.values()) if (g.into && now - g.last >= IDLE_MS) this.finish(g);
    this.stopTimer();
  }

  /** An overdub gesture ends: its curve is written, and the control goes back where the curve wants it.
   *  A take's gesture ends with its take (endTake). */
  private finish(g: Gesture): void {
    this.gestures.delete(`${g.track}|${targetKey(g.base.target)}`);
    if (!g.into) return;
    this.writeCurve(g);
    const rest = gestureCurve(g.base, g.samples).rest;
    this.write(() => this.store.apply(g.base.set(rest), { mergeKey: this.overdubKey() }));
  }

  /** An overdub gesture's stretch over its clip's curve. */
  private writeCurve(g: Gesture): void {
    if (!g.into || !g.samples.length) return;
    const { ref, clip } = g.into, target = g.base.target;
    const curve = gestureCurve(g.base, g.samples);
    const points = thinned(curve.points, scaleOf(target));
    this.write(() => this.store.apply(touchCurve(ref, clip, target, points, curve.scale), { mergeKey: this.overdubKey() }));
  }

  private write(apply: () => void): void {
    this.writing = true;
    try {
      apply();
    } finally {
      this.writing = false;
    }
  }

  private stopTimer(): void {
    if (this.timer === null || [...this.gestures.values()].some(g => g.into)) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
