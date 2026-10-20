import type { Beats } from '../core/music-time';
import type { Project } from '../model/project';
import type { AudioGraph } from './audio-graph';
import type { EffectHost } from './effect-chain';
import { ClipAudio } from './clip-audio';
import { PlaybackEngine } from './playback-engine';
import type { InstrumentHost } from './players/instrument';
import type { RenderCache } from './render-cache';
import type { SampleLibrary } from './sample-library';

/** Un grafo che calcola l'audio tutto in una volta (OfflineAudioContext). */
export interface OfflineGraph extends AudioGraph {
  startRendering(): Promise<{ readonly numberOfChannels: number; getChannelData(channel: number): Float32Array }>;
}

export interface MixDeps {
  /** Crea il grafo offline: OfflineAudioContext nel browser. */
  readonly createGraph: (frames: number, sampleRate: number) => OfflineGraph;
  readonly library: SampleLibrary;
  readonly renders: RenderCache;
  readonly instruments: InstrumentHost;
  readonly effects: EffectHost;
}

/** Mixdown di [from, to) del progetto, con lo stesso motore della riproduzione dal vivo.
 *  Il loop della timeline non si applica: si esporta la timeline com'è. */
export async function renderMix(
  project: Project, from: Beats, to: Beats, deps: MixDeps, sampleRate = 44100, tailSeconds = 1,
): Promise<Float32Array[]> {
  if (!(to > from)) throw new RangeError('intervallo vuoto');
  const seconds = project.tempo.secondsAt(to - from) + tailSeconds;
  const graph = deps.createGraph(Math.ceil(seconds * sampleRate), sampleRate);
  const clips = new ClipAudio(graph, deps.library, deps.renders);
  await Promise.all([clips.prepare(project), deps.instruments.prepare(graph)]);
  const engine = new PlaybackEngine(graph, { clips, instruments: deps.instruments, effects: deps.effects }, { timer: { every: () => () => {} } });
  engine.setProject(project);
  engine.scheduleRange(from, to, 0);
  // strumenti ed effetti ricevono note e trasporto per messaggio: devono averli prima di iniziare
  await Promise.all([deps.instruments.settle(graph), deps.effects.settle?.(graph)]);
  const out = await graph.startRendering();
  return Array.from({ length: out.numberOfChannels }, (_, i) => out.getChannelData(i).slice());
}

/** Un loop di `frames` campioni da un mixdown più lungo: la coda (riverberi, delay) oltre la
 *  fine si somma all'inizio, come quando il loop si ripete, così riparte senza stacchi. */
export function foldTail(channels: readonly Float32Array[], frames: number): Float32Array[] {
  return channels.map(c => {
    const out = c.slice(0, frames);
    for (let i = frames; i < c.length; i++) out[i % frames] += c[i];
    return out;
  });
}
