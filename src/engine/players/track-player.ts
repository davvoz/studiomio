import type { InstrumentSettings } from '../../model/device';
import type { Track } from '../../model/track';
import type { AudioGraph, AudioNodeLike, ScheduledNodeLike } from '../audio-graph';
import type { DeviceModulation } from '../modulation';
import type { NoteActivity } from '../note-activity';
import type { ScheduledSource } from '../scheduler';
import type { Program } from '../session';

/** Makes a track play: receives the track's new versions and schedules its clips. */
export interface TrackPlayer extends ScheduledSource {
  update(track: Track): void;
  /** Plays a note right away, for whoever has an instrument. */
  audition?(pitch: number, velocity: number, seconds: number): void;
  /** A note held by hand, for whoever has an instrument: plays until `release` arrives. */
  press?(pitch: number, velocity: number): void;
  release?(pitch: number): void;
  /** The instrument's modulatable parameters, for whoever has one. */
  instrumentModulation?(): DeviceModulation | null;
  /** Where the instrument's voices read, if it plays a sample (fractions of the sample). */
  playheads?(): readonly number[];
  /** Cuts at instant `at` everything it has already scheduled beyond (a launched clip
   *  takes the place of the one playing). */
  cut(at: number): void;
  dispose(): void;
}

export interface PlayerContext {
  readonly graph: AudioGraph;
  /** Input of the track's mixer channel. */
  readonly output: AudioNodeLike;
  /** To be called when something doesn't start because its audio isn't ready yet. */
  readonly missing: () => void;
  /** What the track plays and when (timeline or session clips), on the continuous clock. */
  readonly programs: () => readonly Program[];
  /** Where to note the scheduled notes, for the interface. */
  readonly notes: NoteActivity;
  /** The project's tempo (BPM). */
  readonly tempo: () => number;
  /** The instrument took the sound of a starting clip: the project must follow it. */
  readonly sound?: (sound: InstrumentSettings) => void;
}

/** How a scheduled node stops earlier than planned. */
export interface NodeEnding {
  /** Ends at instant `at` (normally with a short fade). */
  cut(at: number): void;
  /** Rescheduling from `at`: if it starts from `at` on it doesn't play; if it's already running it gives
   *  way to the one replacing it (which restarts from `at`). */
  retake(at: number): void;
}

/** Scheduled nodes not yet finished, to be able to stop them all together. */
export class ActiveNodes {
  private readonly nodes = new Map<ScheduledNodeLike, NodeEnding>();

  /** Registers the node; at the end `cleanup` disconnects what's needed. Without `ending` the node
   *  stops abruptly at the instant of the cut. */
  add(node: ScheduledNodeLike, cleanup: () => void, ending?: NodeEnding): void {
    const stop = (at: number) => stopQuietly(node, at);
    this.nodes.set(node, ending ?? { cut: stop, retake: stop });
    node.onended = () => {
      this.nodes.delete(node);
      cleanup();
    };
  }

  /** Makes all the nodes that would play beyond end at instant `at`. */
  cutAt(at: number): void {
    for (const e of this.nodes.values()) e.cut(at);
  }

  /** Rescheduling from `at` (see `NodeEnding.retake`). */
  retakeAt(at: number): void {
    for (const e of this.nodes.values()) e.retake(at);
  }

  get size(): number {
    return this.nodes.size;
  }

  stopAll(): void {
    for (const n of this.nodes.keys()) stopQuietly(n);
  }
}

/** Stops a node (right away, or at instant `at`); if it's already stopped it does nothing. */
export function stopQuietly(node: ScheduledNodeLike, at?: number): void {
  try {
    node.stop(at);
  } catch {
    // already stopped
  }
}
