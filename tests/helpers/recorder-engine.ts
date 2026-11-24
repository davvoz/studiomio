/* For the recording tests: an engine whose clock the test moves. */
import type { RecorderEngine } from '../../src/app/session-recorder';
import type { TrackId } from '../../src/core/id';
import type { TrackSessionState } from '../../src/engine/session';
import type { Track } from '../../src/model/track';

/** An engine whose clock the test moves; boundaries every `quantum` beats. */
export class FakeRecorderEngine implements RecorderEngine {
  playing = false;
  sessionClock = 0;
  quantum = 4;
  readonly launched: [TrackId, number][] = [];
  readonly started: TrackId[] = [];
  /** What each track plays in the session (none: nothing). */
  readonly states = new Map<TrackId, TrackSessionState>();
  private stateListener: ((playing: boolean) => void) | null = null;

  get nextBoundary(): number {
    return Math.ceil(this.sessionClock / this.quantum - 1e-9) * this.quantum;
  }

  startRecording(track: TrackId): number {
    this.started.push(track);
    if (this.playing) return this.nextBoundary;
    this.playing = true;
    return this.sessionClock;
  }

  launchSlot(track: TrackId, slot: number): void {
    this.launched.push([track, slot]);
  }

  sessionState(track: Track): TrackSessionState {
    return this.states.get(track.id) ?? { playing: null, queued: null, followsArrangement: true };
  }

  onStateChange(fn: (playing: boolean) => void) {
    this.stateListener = fn;
    return () => { this.stateListener = null; };
  }

  stop(): void {
    this.playing = false;
    this.stateListener?.(false);
  }
}
