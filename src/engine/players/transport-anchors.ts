import type { TransportAnchor } from '../../devices/worklet/transport-clock';
import type { ScheduledSource, ScheduleWindow } from '../scheduler';

/** Tells the effects that follow the bar where the transport is: an anchor
 *  at the start of each run (play, loop round, jump, new tempo or loop), from there the worklet
 *  counts by itself. The stop is announced by the engine, which knows when the transport really stops
 *  (the scheduler also stops to restart right away from somewhere else). */
export class TransportAnchors implements ScheduledSource {
  private last: TransportAnchor | null = null;

  constructor(
    private readonly send: (anchor: TransportAnchor | null) => void,
    private readonly beatsPerBar: () => number,
  ) {}

  schedule(w: ScheduleWindow): void {
    if (w.from !== w.runStart) return;
    const bpm = 60 / (w.tempo.secondsAt(w.from + 1) - w.tempo.secondsAt(w.from));
    this.announce({ time: w.timeAt(w.from), beat: w.from, bpm, beatsPerBar: this.beatsPerBar() });
  }

  /** The time signature changed: the last anchor still applies, with the new bars. */
  resend(): void {
    if (this.last && this.last.beatsPerBar !== this.beatsPerBar()) this.announce({ ...this.last, beatsPerBar: this.beatsPerBar() });
  }

  stopped(): void {
    this.last = null;
    this.send(null);
  }

  stopAll(): void {}

  retake(): void {}

  private announce(anchor: TransportAnchor): void {
    this.last = anchor;
    this.send(anchor);
  }
}
