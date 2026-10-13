import type { AudioGraph } from './audio-graph';
import type { OfflineGraph } from './offline-mix';

/* Il motore lavora sulle interfacce di audio-graph.ts. Queste funzioni le collegano a
 * Web Audio e fanno controllare al compilatore che i tipi del browser le soddisfino. */

export const liveGraph = (ctx: AudioContext): AudioGraph => ctx;

export const offlineGraph = (frames: number, sampleRate: number): OfflineGraph =>
  new OfflineAudioContext({ numberOfChannels: 2, length: frames, sampleRate });
