/** Campioni di uno o più canali, tutti della stessa lunghezza. */
export type Channels = readonly Float32Array[];

/** Array numerico leggibile per indice (Float32Array, Float64Array, number[]…). */
export type Samples = ArrayLike<number>;

export interface AudioData {
  readonly channels: Channels;
  readonly sampleRate: number;
}

export const lengthOf = (channels: Channels): number => channels[0]?.length ?? 0;
