/* A take: the notes played while recording into a clip, timed in beats on the session's
 * continuous clock (it doesn't jump back with the loop). It knows nothing of the engine or the
 * keyboard: it receives presses and releases with their beat and gives back the clip's notes. */
import type { Beats } from '../core/music-time';
import type { Note } from './midi-clip';

/** A note pressed this much before the take starts (on the beat, a little early) counts from its start. */
const EARLY: Beats = 0.25;
/** The shortest note kept (pressed and released in the same instant). */
const MIN_DURATION: Beats = 1 / 64;

interface Held {
  /** Where it falls in the clip. */
  readonly start: Beats;
  /** The clock when it was pressed: a note pressed early goes at the clip's start, but lasts as long as it was held. */
  readonly at: Beats;
  readonly velocity: number;
}

export class NoteTake {
  private readonly held = new Map<number, Held>();
  private readonly played: Note[] = [];
  private last: Beats | null = null;

  /** `start`: the clock where the clip's beat 0 falls. */
  constructor(readonly start: Beats) {}

  /** The clock of the last press or release, null if nothing was played. */
  get lastEvent(): Beats | null {
    return this.last;
  }

  press(pitch: number, velocity: number, at: Beats): void {
    if (at < this.start - EARLY) return;
    // the same key again before its release: the first note ends here
    this.release(pitch, at);
    this.held.set(pitch, { start: Math.max(0, at - this.start), at, velocity });
    this.last = at;
  }

  release(pitch: number, at: Beats): void {
    const h = this.held.get(pitch);
    if (!h) return;
    this.held.delete(pitch);
    this.played.push({ pitch, start: h.start, velocity: h.velocity, duration: at - h.at });
    this.last = at;
  }

  /** The notes of a clip `length` beats long: those still held end there, those starting
   *  at or after the end are left out. */
  notes(length: Beats): Note[] {
    const held = [...this.held].map(([pitch, h]): Note => ({ pitch, start: h.start, velocity: h.velocity, duration: length - h.start }));
    return [...this.played, ...held]
      .filter(n => n.start < length)
      .map(n => ({ ...n, duration: Math.max(MIN_DURATION, Math.min(n.duration, length - n.start)) }));
  }
}

/** The length of a take's clip that went on `span` beats: whole launch quanta (whole beats
 *  without quantization), at least one. */
export function takeLength(span: Beats, quantum: Beats): Beats {
  const unit = quantum > 0 ? quantum : 1;
  return Math.max(1, Math.ceil(span / unit - 1e-9)) * unit;
}
