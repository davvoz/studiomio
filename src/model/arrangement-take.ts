/* A take on the timeline, as Live's Arrangement Record: the notes played on the armed tracks from
 * the punch-in on, at the timeline's beats where they're heard. It follows the playhead: a round of
 * the loop goes on recording (the notes of every round stay, on top of each other), a jump elsewhere
 * (a click on the ruler) ends it. When it ends, each track that got notes gets a clip covering the
 * whole stretch recorded. Pure data: it receives the moments, it knows nothing of the engine. */
import type { TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import type { ClipEnvelope } from './envelope';
import type { Note } from './midi-clip';

/** An instant of the transport: the timeline's beat and the continuous clock (which doesn't go back
 *  with the loop). `clock − beat` changes by a loop's length at each round, otherwise by a jump. */
export interface Moment {
  readonly beat: Beats;
  readonly clock: number;
}

/** The loop playing while recording. */
export interface TakeLoop {
  readonly start: Beats;
  readonly end: Beats;
}

/** What a track recorded: a clip from `start`, `length` beats long, with its notes and the curves of
 *  the controls moved (the recorder adds them: see app/move-recorder.ts). */
export interface TakeClip {
  readonly track: TrackId;
  readonly start: Beats;
  readonly length: Beats;
  readonly notes: readonly Note[];
  readonly envelopes?: readonly ClipEnvelope[];
}

/** The shortest note kept (pressed and released in the same instant). */
const MIN_DURATION: Beats = 1 / 64;
const EPS = 1e-6;

interface Held {
  /** Where it falls on the timeline. */
  readonly beat: Beats;
  /** The clock when it was pressed: it lasts as long as it was held. */
  readonly clock: number;
  readonly velocity: number;
}

/** A recorded note on the timeline. */
interface Played extends Held {
  readonly pitch: number;
  readonly duration: Beats;
}

/** The loop the transport goes round in from `beat`: the active one, if `beat` is before its end. */
export function playingLoop(loop: { readonly enabled: boolean } & TakeLoop, beat: Beats): TakeLoop | null {
  return loop.enabled && loop.end > loop.start && beat < loop.end ? { start: loop.start, end: loop.end } : null;
}

export class TimelineTake {
  private shift: number;
  private wrapped = false;
  private furthest: Beats;
  private readonly held = new Map<TrackId, Map<number, Held>>();
  private readonly played = new Map<TrackId, Played[]>();

  /** `from`: the punch-in; `loop`: the loop the transport goes round in (null: none). */
  constructor(readonly from: Moment, readonly loop: TakeLoop | null) {
    this.shift = from.clock - from.beat;
    this.furthest = from.beat;
  }

  /** The playhead got to `m`; false if it jumped elsewhere (not a round of the loop): the take is over. */
  follow(m: Moment): boolean {
    const d = m.clock - m.beat - this.shift;
    if (Math.abs(d) > EPS) {
      const length = this.loop ? this.loop.end - this.loop.start : 0;
      // one or more rounds of the loop since the last moment
      const rounds = length > 0 ? Math.round(d / length) : 0;
      if (rounds < 1 || Math.abs(d - rounds * length) > EPS) return false;
      this.wrapped = true;
      this.shift += d;
    }
    this.furthest = Math.max(this.furthest, m.beat);
    return true;
  }

  /** The stretch of timeline recorded: from the punch-in to where the playhead got (with a round of
   *  the loop, the whole loop too). */
  get span(): TakeLoop {
    if (this.wrapped && this.loop) return { start: Math.min(this.from.beat, this.loop.start), end: this.loop.end };
    return { start: this.from.beat, end: this.furthest };
  }

  /** The tracks that recorded something, also notes still held. */
  get tracks(): TrackId[] {
    return [...new Set([...this.played.keys(), ...this.held.keys()])];
  }

  press(track: TrackId, pitch: number, velocity: number, m: Moment): void {
    // the same key again before its release: the first note ends here
    this.release(track, pitch, m);
    const notes = this.held.get(track) ?? new Map<number, Held>();
    notes.set(pitch, { beat: m.beat, clock: m.clock, velocity });
    this.held.set(track, notes);
  }

  release(track: TrackId, pitch: number, m: Moment): void {
    const notes = this.held.get(track), h = notes?.get(pitch);
    if (!notes || !h) return;
    notes.delete(pitch);
    if (!notes.size) this.held.delete(track);
    const list = this.played.get(track) ?? [];
    list.push({ ...h, pitch, duration: this.limited(h, m.clock - h.clock) });
    this.played.set(track, list);
  }

  /** A note doesn't go past the end of the loop it started in: there the playhead goes back. */
  private limited(h: Held, duration: Beats): Beats {
    const end = this.loop && h.beat < this.loop.end ? this.loop.end : Infinity;
    return Math.max(MIN_DURATION, Math.min(duration, end - h.beat));
  }

  /** The clips of the take ended at `m` (the notes still held end there), one per track with notes
   *  inside the stretch; none if the stretch is empty. */
  clips(m: Moment): TakeClip[] {
    const { start, end } = this.span, length = end - start;
    if (length < MIN_DURATION) return [];
    return this.tracks.flatMap(track => {
      const held = [...(this.held.get(track) ?? [])].map(([pitch, h]): Played => ({ ...h, pitch, duration: this.limited(h, m.clock - h.clock) }));
      const notes = [...(this.played.get(track) ?? []), ...held]
        .filter(n => n.beat >= start - EPS && n.beat < end - EPS)
        .map((n): Note => {
          const at = Math.max(0, n.beat - start);
          return { pitch: n.pitch, velocity: n.velocity, start: at, duration: Math.max(MIN_DURATION, Math.min(n.duration, length - at)) };
        });
      return notes.length ? [{ track, start, length, notes }] : [];
    });
  }
}
