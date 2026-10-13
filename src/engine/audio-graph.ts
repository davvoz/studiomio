/* La parte di Web Audio che il motore usa. AudioContext e OfflineAudioContext la
 * soddisfano così come sono; i test usano un grafo finto che registra cosa viene
 * programmato. Il motore dipende da queste interfacce, non dal browser. */

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown;
  cancelScheduledValues(time: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface PannerNodeLike extends AudioNodeLike {
  readonly pan: AudioParamLike;
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
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
}

/** Decibel → guadagno lineare; sotto i −70 dB è silenzio. */
export const dbToGain = (db: number): number => (db <= -70 ? 0 : Math.pow(10, db / 20));

/** Canali → buffer del grafo. */
export function toAudioBuffer(graph: AudioGraph, channels: readonly Float32Array[], sampleRate: number): AudioBufferLike {
  const buf = graph.createBuffer(channels.length, Math.max(1, channels[0].length), sampleRate);
  channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return buf;
}
