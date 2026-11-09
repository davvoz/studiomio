import type { AudioGraph } from './audio-graph';
import type { OfflineGraph } from './offline-mix';

/* The engine works on the interfaces of audio-graph.ts. These functions connect them to
 * Web Audio and make the compiler check that the browser's types satisfy them. */

export const liveGraph = (ctx: AudioContext): AudioGraph => ctx;

export const offlineGraph = (frames: number, sampleRate: number): OfflineGraph =>
  new OfflineAudioContext({ numberOfChannels: 2, length: frames, sampleRate });
