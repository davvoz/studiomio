/* A MIDI keyboard plays the armed MIDI tracks (⌨), like the computer keyboard: any port that isn't
 * taken by a session controller (APC40, Launchpad), on any channel, with its velocity. A note mapped
 * to a macro or a parameter stays a mapping and doesn't play (as does every note while mapping). */
import type { TrackId } from '../core/id';

export interface MidiNoteOutput {
  press(track: TrackId, pitch: number, velocity: number): void;
  release(track: TrackId, pitch: number): void;
}

interface HeldNote {
  readonly track: TrackId;
  readonly pitch: number;
}

export class MidiNoteInput {
  /** What each key down (channel and pitch) started: releasing it stops those notes, even if
   *  the armed tracks changed meanwhile. */
  private readonly held = new Map<number, HeldNote[]>();

  constructor(
    private readonly armed: () => Iterable<TrackId>,
    /** The note is taken by a mapping. */
    private readonly mapped: (channel: number, pitch: number) => boolean,
    private readonly out: MidiNoteOutput,
  ) {}

  /** A message from a MIDI port: note on and note off play, the rest is left to the others. */
  receive(data: ArrayLike<number>): void {
    const [status, pitch, velocity = 0] = Array.from(data);
    if (status === undefined || pitch === undefined || status >= 0xf0) return;
    const kind = status & 0xf0, channel = status & 0x0f;
    if (kind !== 0x90 && kind !== 0x80) return;
    const key = channel * 128 + pitch;
    if (kind === 0x90 && velocity > 0) this.down(key, channel, pitch, velocity);
    else this.up(key);
  }

  /** The notes of the tracks that stopped being armed stop. */
  keepTracks(tracks: ReadonlySet<TrackId>): void {
    for (const [key, notes] of this.held) {
      for (const n of notes) if (!tracks.has(n.track)) this.out.release(n.track, n.pitch);
      this.held.set(key, notes.filter(n => tracks.has(n.track)));
    }
  }

  private down(key: number, channel: number, pitch: number, velocity: number): void {
    if (this.mapped(channel, pitch)) return;
    // the same key again without its note off: the first note ends
    this.up(key);
    const notes = [...this.armed()].map(track => ({ track, pitch }));
    for (const n of notes) this.out.press(n.track, pitch, velocity);
    this.held.set(key, notes);
  }

  private up(key: number): void {
    for (const n of this.held.get(key) ?? []) this.out.release(n.track, n.pitch);
    this.held.delete(key);
  }
}
