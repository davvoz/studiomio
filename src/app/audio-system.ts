import type { DeviceId, SampleId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import type { AudioData } from '../dsp/types';
import { ClipAudio } from '../engine/clip-audio';
import { renderMix } from '../engine/offline-mix';
import { PlaybackEngine } from '../engine/playback-engine';
import { RenderCache } from '../engine/render-cache';
import { SampleLibrary } from '../engine/sample-library';
import { liveGraph, offlineGraph } from '../engine/web-audio';
import { DeviceWorklet, WorkletEffects, WorkletInstruments, WorkletMeters, type FaultListener } from '../engine/worklet-devices';
import type { ChainOwner, Project } from '../model/project';
import { EffectDynamics } from './effect-dynamics';
import { EffectSpectrum } from './effect-spectrum';
import type { ProjectStore } from '../store/project-store';
import { DspService } from '../workers/dsp-service';

/** All the app's audio, assembled in one place: DSP workers, samples, render cache,
 *  audio context and playback engine, connected to the project store. */
export class AudioSystem {
  readonly dsp = new DspService();
  readonly library = new SampleLibrary(this.dsp);
  readonly renders = new RenderCache((id, job, key) => this.library.render(id, job, key));
  readonly context = new AudioContext({ latencyHint: 'interactive' });
  readonly clips: ClipAudio;
  readonly engine: PlaybackEngine;
  private readonly worklet = new DeviceWorklet();
  readonly instruments = new WorkletInstruments(this.worklet, id => this.library.get(id));
  readonly effects = new WorkletEffects(this.worklet);
  /** Level meters, live only (export doesn't need them). */
  private readonly meters = new WorkletMeters(this.worklet);
  private readonly unsubscribe: () => void;

  constructor(private readonly store: ProjectStore) {
    const graph = liveGraph(this.context);
    // the instruments and effects module loads right away: at the first play it's ready
    this.instruments.prepare(graph).catch(e => console.error('devices AudioWorklet not loaded', e));
    this.clips = new ClipAudio(graph, this.library, this.renders);
    this.engine = new PlaybackEngine(graph, { clips: this.clips, instruments: this.instruments, effects: this.effects, meters: this.meters });
    this.clips.on('ready', () => this.engine.refresh());
    this.clips.on('error', (clip, err) => console.error(`render of clip "${clip.name}" failed`, err));
    const sync = (p: Project) => {
      this.clips.setProject(p);
      this.engine.setProject(p);
    };
    this.unsubscribe = store.onChange(sync);
    sync(store.project);
  }

  addSample(id: SampleId, audio: AudioData): Promise<void> {
    return this.library.add(id, audio);
  }

  /** When a device's engine breaks (and is restarted). */
  onDeviceFault(fn: FaultListener): () => void {
    return this.worklet.onFault(fn);
  }

  /** The browser starts audio only after a user gesture. */
  async play(from?: Beats): Promise<void> {
    if (this.context.state !== 'running') await this.context.resume();
    this.engine.play(from);
  }

  /** Plays a note with the track's instrument. */
  async audition(track: TrackId, pitch: number, velocity?: number, seconds?: number): Promise<void> {
    if (this.context.state !== 'running') await this.context.resume();
    this.engine.audition(track, pitch, velocity, seconds);
  }

  /** A note played by hand. No waiting: the key going up must follow the note that started. */
  pressNote(track: TrackId, pitch: number, velocity: number): void {
    if (this.context.state !== 'running') void this.context.resume();
    this.engine.pressNote(track, pitch, velocity);
  }

  releaseNote(track: TrackId, pitch: number): void {
    this.engine.releaseNote(track, pitch);
  }

  /** The spectrum before and after a playing effect. */
  spectrum(owner: ChainOwner, id: DeviceId): EffectSpectrum {
    return new EffectSpectrum(this.context, () => this.engine.effectMonitor(owner, id));
  }

  /** What a playing dynamics effect is doing, for its panel. */
  dynamics(owner: ChainOwner, id: DeviceId): EffectDynamics {
    return new EffectDynamics(() => this.engine.effectMonitor(owner, id));
  }

  /** Mixdown of [from, to) of the current project. */
  /** Mixdown of [from, to) of the project (or another one, e.g. a scene put on the timeline). */
  exportMix(from: Beats, to: Beats, project = this.store.project, tailSeconds?: number): Promise<Float32Array[]> {
    return renderMix(project, from, to, {
      createGraph: offlineGraph, library: this.library, renders: this.renders, instruments: this.instruments, effects: this.effects,
    }, this.context.sampleRate, tailSeconds);
  }

  dispose(): void {
    this.unsubscribe();
    this.engine.dispose();
    this.dsp.dispose();
    void this.context.close();
  }
}
