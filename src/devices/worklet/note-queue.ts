import type { InstrumentCore } from '../dsp/core';

export interface NoteEvent {
  /** Campione assoluto del contesto audio. */
  readonly frame: number;
  readonly kind: 'on' | 'off';
  readonly id: number;
  readonly pitch: number;
  readonly velocity: number;
}

/** A parità di campione gli spegnimenti vengono prima: una nota che finisce dove ne inizia
 *  un'altra libera la voce in tempo. */
const ORDER = { off: 0, on: 1 } as const;
const before = (a: NoteEvent, b: NoteEvent) => a.frame - b.frame || ORDER[a.kind] - ORDER[b.kind];

const APPLY: { readonly [K in NoteEvent['kind']]: (core: InstrumentCore, e: NoteEvent) => void } = {
  on: (core, e) => core.noteOn(e.id, e.pitch, e.velocity),
  off: (core, e) => core.noteOff(e.id),
};

/** Note programmate in anticipo, in ordine di tempo. */
export class NoteQueue {
  private events: NoteEvent[] = [];
  private nextId = 1;

  /** Programma una nota da `onFrame` a `offFrame`. */
  add(pitch: number, velocity: number, onFrame: number, offFrame: number): void {
    const id = this.nextId++;
    this.insert({ frame: onFrame, kind: 'on', id, pitch, velocity });
    this.insert({ frame: Math.max(onFrame + 1, offFrame), kind: 'off', id, pitch, velocity });
  }

  clear(): void {
    this.events = [];
  }

  /** Toglie le note che partirebbero da `frame` in poi e anticipa a `frame` la fine di quelle
   *  che suonerebbero oltre (anche quelle già partite). */
  cutAt(frame: number): void {
    const dropped = new Set(this.events.filter(e => e.kind === 'on' && e.frame >= frame).map(e => e.id));
    this.events = this.events
      .filter(e => !dropped.has(e.id))
      .map(e => (e.kind === 'off' && e.frame > frame ? { ...e, frame } : e))
      .sort(before);
  }

  /** Toglie le note che partirebbero da `frame` in poi; quelle già partite restano com'erano. */
  dropFrom(frame: number): void {
    const dropped = new Set(this.events.filter(e => e.kind === 'on' && e.frame >= frame).map(e => e.id));
    if (dropped.size) this.events = this.events.filter(e => !dropped.has(e.id));
  }

  get size(): number {
    return this.events.length;
  }

  /** Suona il blocco che inizia al campione `start`: il motore lavora a tratti, fermandosi
   *  sul campione di ogni evento. Gli eventi in ritardo valgono dall'inizio del blocco. */
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
    // ricerca binaria: di solito le note arrivano già in ordine e finiscono in coda
    let lo = 0, hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (before(this.events[mid], e) <= 0) lo = mid + 1;
      else hi = mid;
    }
    this.events.splice(lo, 0, e);
  }
}
