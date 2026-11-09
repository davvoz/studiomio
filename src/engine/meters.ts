import type { AudioGraph, AudioNodeLike } from './audio-graph';

/** Levels of a stereo channel, linear (1 = 0 dBFS): the peak since the last read and the RMS
 *  (moving average, 120 ms constant). */
export interface MeterReading {
  readonly peak: readonly [number, number];
  readonly rms: readonly [number, number];
}

export const SILENT: MeterReading = { peak: [0, 0], rms: [0, 0] };

/** A level meter in the graph: the sound passes from `input` to `output` without changing. */
export interface Meter {
  readonly input: AudioNodeLike;
  readonly output: AudioNodeLike;
  /** Reads the levels and restarts the peak from zero. */
  read(): MeterReading;
  dispose(): void;
}

/** Where the meters are born: in the browser the AudioWorklet, in tests a recorder. In the export
 *  they're not needed, and the mixer goes on without them. */
export interface MeterHost {
  create(graph: AudioGraph): Meter;
}
