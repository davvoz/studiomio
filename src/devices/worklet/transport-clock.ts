/* Where the transport is, in the AudioWorklet: for the effects that follow the bar (Beat
 * Repeat). The main thread sends an anchor at every start, loop round, jump or
 * tempo change, with the instant it applies from (usually a moment in the future); from there the
 * position is computed by itself. Pure: it's also tested in Node. */
import type { TransportPosition } from '../dsp/core';

/** Timeline beat `beat` plays at instant `time` (audio context seconds) and from
 *  there the transport advances at `bpm`. */
export interface TransportAnchor {
  readonly time: number;
  readonly beat: number;
  readonly bpm: number;
  readonly beatsPerBar: number;
}

export class TransportClock {
  /** In order of instant: the first is the one in force (or the next, if none is yet). */
  private anchors: TransportAnchor[] = [];

  /** A new anchor replaces those that would have applied from that instant on (a jump
   *  cancels the already announced loop round); null: the transport stopped, right away. */
  set(anchor: TransportAnchor | null): void {
    if (!anchor) {
      this.anchors = [];
      return;
    }
    this.anchors = [...this.anchors.filter(a => a.time < anchor.time), anchor];
  }

  /** The position at instant `time` (null if stopped, or not started yet). */
  at(time: number): TransportPosition | null {
    const a = this.anchors;
    while (a.length > 1 && a[1].time <= time) a.shift();
    const now = a[0];
    if (!now || now.time > time) return null;
    return { beat: now.beat + ((time - now.time) * now.bpm) / 60, bpm: now.bpm, beatsPerBar: now.beatsPerBar };
  }
}
