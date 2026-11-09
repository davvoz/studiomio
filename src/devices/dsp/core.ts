/** An instrument's engine, run in the AudioWorklet: it receives notes and parameters and adds
 *  its sound into the output buffers. A new instrument type implements this interface
 *  and registers in worklet/cores.ts. It knows nothing of absolute times: the notes arrive
 *  exactly at the right sample, split by the processor. */
export interface InstrumentCore {
  setParams(params: Readonly<Record<string, number>>): void;
  /** `id` identifies the note for its noteOff (several notes of the same pitch can overlap). */
  noteOn(id: number, pitch: number, velocity: number): void;
  noteOff(id: number): void;
  /** Turns everything off in a few milliseconds (stop, cursor jump). */
  silence(): void;
  /** Adds the output into samples [from, to) of the two channels. */
  render(left: Float32Array, right: Float32Array, from: number, to: number): void;
  /** The project's tempo, for whoever has tempo-synced modulations (synced LFOs). */
  setTempo?(bpm: number): void;
  /** For whoever plays a sample: where the playing voices read (fractions of the sample; with several
   *  samples, the sample's index plus the fraction), written into `out`; returns how many there are.
   *  The interface draws them on the waveform. */
  playheads?(out: Float32Array): number;
}

export type CoreFactory = (sampleRate: number) => InstrumentCore;

/** A sample loaded into a device (e.g. on a pad): the samples and their rate. */
export interface SampleData {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
}

/** An engine that plays samples: it receives them by slot (null = empty slot). */
export interface SamplePlayer {
  setSample(slot: string, sample: SampleData | null): void;
}

export const playsSamples = (core: object): core is SamplePlayer => typeof (core as Partial<SamplePlayer>).setSample === 'function';

/** An effect's engine, run in the AudioWorklet: turns the input into the output one
 *  block at a time. Turning it off (bypass) is handled by the processor, not the effect. */
export interface EffectCore {
  setParams(params: Readonly<Record<string, number>>): void;
  /** The project's tempo, for tempo-synced effects. */
  setTempo(bpm: number): void;
  /** Processes `n` samples: reads the inputs and writes (overwrites) the outputs. */
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void;
}

export type EffectFactory = (sampleRate: number) => EffectCore;

/** A dynamics effect (compressor, gate): tells its panel what it's doing. */
export interface DynamicsMeter {
  /** Writes into `out` the loudest level heard by the detector (dB) and the strongest reduction
   *  (dB, positive) since the last read. */
  readDynamics(out: Float32Array): void;
}

export const metersDynamics = (core: object): core is DynamicsMeter => typeof (core as Partial<DynamicsMeter>).readDynamics === 'function';

/** Where the transport is at the start of a block: the timeline beat (in quarters) and
 *  the tempo it advances at. */
export interface TransportPosition {
  readonly beat: number;
  readonly bpm: number;
  readonly beatsPerBar: number;
}

/** An effect that follows the bar (e.g. the Beat Repeat). */
export interface TransportFollower {
  /** The transport position at the start of the next `process`; null if it's stopped. */
  setTransport(position: TransportPosition | null): void;
}

export const followsTransport = (core: object): core is TransportFollower =>
  typeof (core as Partial<TransportFollower>).setTransport === 'function';

/** An effect with a detector that can listen to another sound (sidechain). */
export interface KeyedEffect {
  /** The sound the detector listens to in the next `process` (same length as the input);
   *  null: goes back to listening to the input. */
  setKey(left: Float32Array | null, right: Float32Array | null): void;
}

export const isKeyed = (core: object): core is KeyedEffect => typeof (core as Partial<KeyedEffect>).setKey === 'function';

export const midiToHz = (pitch: number): number => 440 * Math.pow(2, (pitch - 69) / 12);

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
