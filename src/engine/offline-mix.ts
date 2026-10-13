import type { Beats } from '../core/music-time';
import type { Project } from '../model/project';
import type { AudioGraph } from './audio-graph';
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
  const engine = new PlaybackEngine(graph, { clips, instruments: deps.instruments }, { timer: { every: () => () => {} } });
  engine.setProject(project);
  engine.scheduleRange(from, to, 0);
  // gli strumenti ricevono le note per messaggio: devono averle tutte prima di iniziare
  await deps.instruments.settle(graph);
  const out = await graph.startRendering();
  return Array.from({ length: out.numberOfChannels }, (_, i) => out.getChannelData(i).slice());
}
