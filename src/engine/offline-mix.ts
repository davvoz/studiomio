import type { Beats } from '../core/music-time';
import type { Project } from '../model/project';
import type { AudioGraph } from './audio-graph';
import type { EffectHost } from './effect-chain';
import { ClipAudio } from './clip-audio';
import { PlaybackEngine } from './playback-engine';
import type { InstrumentHost } from './players/instrument';
import type { RenderCache } from './render-cache';
import type { SampleLibrary } from './sample-library';

/** A graph computing the audio all at once (OfflineAudioContext). */
export interface OfflineGraph extends AudioGraph {
  startRendering(): Promise<{ readonly numberOfChannels: number; getChannelData(channel: number): Float32Array }>;
}

export interface MixDeps {
  /** Creates the offline graph: OfflineAudioContext in the browser. */
  readonly createGraph: (frames: number, sampleRate: number) => OfflineGraph;
  readonly library: SampleLibrary;
  readonly renders: RenderCache;
  readonly instruments: InstrumentHost;
  readonly effects: EffectHost;
}

/** Mixdown of [from, to) of the project, with the same engine as live playback.
 *  The timeline loop doesn't apply: the timeline is exported as it is. */
export async function renderMix(
  project: Project, from: Beats, to: Beats, deps: MixDeps, sampleRate = 44100, tailSeconds = 1,
): Promise<Float32Array[]> {
  if (!(to > from)) throw new RangeError('empty interval');
  const seconds = project.tempo.secondsAt(to - from) + tailSeconds;
  const graph = deps.createGraph(Math.ceil(seconds * sampleRate), sampleRate);
  const clips = new ClipAudio(graph, deps.library, deps.renders);
  await Promise.all([clips.prepare(project), deps.instruments.prepare(graph)]);
  const engine = new PlaybackEngine(graph, { clips, instruments: deps.instruments, effects: deps.effects }, { timer: { every: () => () => {} } });
  engine.setProject(project);
  engine.scheduleRange(from, to, 0);
  // instruments and effects receive notes and transport by message: they must have them before starting
  await Promise.all([deps.instruments.settle(graph), deps.effects.settle?.(graph)]);
  const out = await graph.startRendering();
  return Array.from({ length: out.numberOfChannels }, (_, i) => out.getChannelData(i).slice());
}

/** A loop of `frames` samples from a longer mixdown: the tail (reverbs, delays) beyond the
 *  end is added to the start, as when the loop repeats, so it restarts seamlessly. */
export function foldTail(channels: readonly Float32Array[], frames: number): Float32Array[] {
  return channels.map(c => {
    const out = c.slice(0, frames);
    for (let i = frames; i < c.length; i++) out[i % frames] += c[i];
    return out;
  });
}
