import type { InstrumentCore } from '../dsp/core';

export interface NoteEvent {
  /** Absolute sample of the audio context. */
  readonly frame: number;
  readonly kind: 'on' | 'off';
  readonly id: number;
  readonly pitch: number;
  readonly velocity: number;
}

/** At equal samples the note-offs come first: a note ending where another starts
 *  frees the voice in time. */
const ORDER = { off: 0, on: 1 } as const;
const before = (a: NoteEvent, b: NoteEvent) => a.frame - b.frame || ORDER[a.kind] - ORDER[b.kind];

const APPLY: { readonly [K in NoteEvent['kind']]: (core: InstrumentCore, e: NoteEvent) => void } = {
  on: (core, e) => core.noteOn(e.id, e.pitch, e.velocity),
  off: (core, e) => core.noteOff(e.id),
};

/** Notes scheduled ahead, in time order. */
export class NoteQueue {
  private events: NoteEvent[] = [];
  private nextId = 1;
  /** The notes held by hand, by pitch: their end is known only when the key goes up. */
  private readonly held = new Map<number, { readonly id: number; readonly frame: number }>();

  /** Schedules a note from `onFrame` to `offFrame`. */
  add(pitch: number, velocity: number, onFrame: number, offFrame: number): void {
    const id = this.nextId++;
    this.insert({ frame: onFrame, kind: 'on', id, pitch, velocity });
    this.insert({ frame: Math.max(onFrame + 1, offFrame), kind: 'off', id, pitch, velocity });
  }

  /** A note held by hand: starts at `frame` and ends with `release`. Of a held note only
   *  the start is known, so the clips' cuts and reschedules don't touch it. */
  press(pitch: number, velocity: number, frame: number): void {
    this.release(pitch, frame);
    const id = this.nextId++;
    this.held.set(pitch, { id, frame });
    this.insert({ frame, kind: 'on', id, pitch, velocity });
  }

  /** The key went up. The note is already off if meanwhile everything stopped. */
  release(pitch: number, frame: number): void {
    const note = this.held.get(pitch);
    if (!note) return;
    this.held.delete(pitch);
    // in the same block as `press`: at equal samples the note-offs would come first
    this.insert({ frame: Math.max(frame, note.frame + 1), kind: 'off', id: note.id, pitch, velocity: 0 });
  }

  clear(): void {
    this.events = [];
    this.held.clear();
  }

  /** Removes the notes that would start from `frame` on and brings forward to `frame` the end of those
   *  that would play beyond it (also those already started). */
  cutAt(frame: number): void {
    const dropped = new Set(this.events.filter(e => e.kind === 'on' && e.frame >= frame).map(e => e.id));
    this.events = this.events
      .filter(e => !dropped.has(e.id))
      .map(e => (e.kind === 'off' && e.frame > frame ? { ...e, frame } : e))
      .sort(before);
  }

  /** Removes the notes that would start from `frame` on; those already started stay as they were. */
  dropFrom(frame: number): void {
    const dropped = new Set(this.events.filter(e => e.kind === 'on' && e.frame >= frame).map(e => e.id));
    if (dropped.size) this.events = this.events.filter(e => !dropped.has(e.id));
  }

  get size(): number {
    return this.events.length;
  }

  /** Plays the block starting at sample `start`: the engine works in stretches, stopping
   *  on the sample of each event. Late events apply from the start of the block. */
  renderBlock(core: InstrumentCore, left: Float32Array, right: Float32Array, start: number): void {
    const end = start + left.length;
    let pos = 0, n = 0;
    while (n < this.events.length && this.events[n].frame < end) {
      const e = this.events[n++];
      const at = Math.max(pos, e.frame - start);
      if (at > pos) {
        core.render(left, right, pos, at);
        pos = at;
      }
      APPLY[e.kind](core, e);
    }
    if (n) this.events.splice(0, n);
    if (pos < left.length) core.render(left, right, pos, left.length);
  }

  private insert(e: NoteEvent): void {
    // binary search: usually the notes arrive already in order and end up at the end
    let lo = 0, hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (before(this.events[mid], e) <= 0) lo = mid + 1;
      else hi = mid;
    }
    this.events.splice(lo, 0, e);
  }
}
