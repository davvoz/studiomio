import type { SampleId } from '../core/id';
import type { Seconds } from '../core/music-time';

/** Result of a sample's analysis, saved in the project so as not to repeat it. */
export interface SampleAnalysis {
  readonly tempo: number;
  readonly transients: readonly Seconds[];
  /** Sensitivity used for the transients, 0..1 */
  readonly sensitivity: number;
}

/** An audio file of the project. The samples aren't in the model: the engine keeps them,
 *  the model only keeps where to find them and what's known about them. */
export interface SampleRef {
  readonly id: SampleId;
  readonly name: string;
  /** Path relative to the project folder, e.g. "audio/kick.wav". */
  readonly file: string;
  readonly sampleRate: number;
  readonly channels: number;
  readonly frames: number;
  readonly analysis: SampleAnalysis | null;
}

export const sampleDuration = (s: SampleRef): Seconds => s.frames / s.sampleRate;
