/** Samples of one or more channels, all the same length. */
export type Channels = readonly Float32Array[];

/** Numeric array readable by index (Float32Array, Float64Array, number[]…). */
export type Samples = ArrayLike<number>;

export interface AudioData {
  readonly channels: Channels;
  readonly sampleRate: number;
}
