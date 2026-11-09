/* The part of Web Audio the engine uses. AudioContext and OfflineAudioContext
 * satisfy it as they are; the tests use a fake graph that records what gets
 * scheduled. The engine depends on these interfaces, not on the browser. */

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown;
  cancelScheduledValues(time: number): unknown;
  /** Removes the events from `time` on, keeping the value there (not in all browsers). */
  cancelAndHoldAtTime?(time: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  /** Without a destination disconnects all the outputs; with one, only that (error if it isn't connected). */
  disconnect(destination?: AudioNodeLike): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface PannerNodeLike extends AudioNodeLike {
  readonly pan: AudioParamLike;
}

/** A constant-value source: connected to an AudioParam, it adds `offset` to it. */
export interface ConstantSourceNodeLike extends AudioNodeLike {
  readonly offset: AudioParamLike;
  connect(destination: AudioNodeLike | AudioParamLike): unknown;
  start(when?: number): void;
}

export interface AudioBufferLike {
  readonly duration: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  copyToChannel(source: Float32Array<ArrayBuffer>, channel: number): void;
}

export interface ScheduledNodeLike extends AudioNodeLike {
  start(when?: number, offset?: number, duration?: number): void;
  stop(when?: number): void;
  onended: ((this: never, ev: Event) => unknown) | null;
}

export interface BufferSourceNodeLike extends ScheduledNodeLike {
  buffer: AudioBufferLike | null;
  readonly playbackRate: AudioParamLike;
}

export interface OscillatorNodeLike extends ScheduledNodeLike {
  type: OscillatorType;
  readonly frequency: AudioParamLike;
}

export interface AudioGraph {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createStereoPanner(): PannerNodeLike;
  createBufferSource(): BufferSourceNodeLike;
  createOscillator(): OscillatorNodeLike;
  createConstantSource(): ConstantSourceNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
}

/** Decibels → linear gain; below −70 dB it's silence. */
export const dbToGain = (db: number): number => (db <= -70 ? 0 : Math.pow(10, db / 20));

/** Channels → graph buffer. */
export function toAudioBuffer(graph: AudioGraph, channels: readonly Float32Array[], sampleRate: number): AudioBufferLike {
  const buf = graph.createBuffer(channels.length, Math.max(1, channels[0].length), sampleRate);
  channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return buf;
}
