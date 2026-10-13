import type { DeviceId, SampleId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import type { AudioData } from '../dsp/types';
import { ClipAudio } from '../engine/clip-audio';
import { renderMix } from '../engine/offline-mix';
import { PlaybackEngine } from '../engine/playback-engine';
import { RenderCache } from '../engine/render-cache';
import { SampleLibrary } from '../engine/sample-library';
import { liveGraph, offlineGraph } from '../engine/web-audio';
import { DeviceWorklet, WorkletEffects, WorkletInstruments, WorkletMeters } from '../engine/worklet-devices';
import type { ChainOwner, Project } from '../model/project';
import { EffectSpectrum } from './effect-spectrum';
import type { ProjectStore } from '../store/project-store';
import { DspService } from '../workers/dsp-service';

/** Tutto l'audio dell'app, montato in un posto solo: worker DSP, sample, cache dei render,
 *  contesto audio e motore di riproduzione, collegati allo store del progetto. */
export class AudioSystem {
  readonly dsp = new DspService();
  readonly library = new SampleLibrary(this.dsp);
  readonly renders = new RenderCache((id, job, key) => this.library.render(id, job, key));
  readonly context = new AudioContext({ latencyHint: 'interactive' });
  readonly clips: ClipAudio;
  readonly engine: PlaybackEngine;
  private readonly worklet = new DeviceWorklet();
  readonly instruments = new WorkletInstruments(this.worklet);
  readonly effects = new WorkletEffects(this.worklet);
  /** Misuratori di livello, solo dal vivo (nell'export non servono). */
  private readonly meters = new WorkletMeters(this.worklet);
  private readonly unsubscribe: () => void;

  constructor(private readonly store: ProjectStore) {
    const graph = liveGraph(this.context);
    // il modulo di strumenti ed effetti si carica subito: al primo play è già pronto
    this.instruments.prepare(graph).catch(e => console.error('AudioWorklet dei dispositivi non caricato', e));
    this.clips = new ClipAudio(graph, this.library, this.renders);
    this.engine = new PlaybackEngine(graph, { clips: this.clips, instruments: this.instruments, effects: this.effects, meters: this.meters });
    this.clips.on('ready', () => this.engine.refresh());
    this.clips.on('error', (clip, err) => console.error(`render della clip "${clip.name}" fallito`, err));
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

  /** Il browser avvia l'audio solo dopo un gesto dell'utente. */
  async play(from?: Beats): Promise<void> {
    if (this.context.state !== 'running') await this.context.resume();
    this.engine.play(from);
  }

  /** Fa sentire una nota con lo strumento della traccia. */
  async audition(track: TrackId, pitch: number, velocity?: number, seconds?: number): Promise<void> {
    if (this.context.state !== 'running') await this.context.resume();
    this.engine.audition(track, pitch, velocity, seconds);
  }

  /** Lo spettro prima e dopo un effetto che suona. */
  spectrum(owner: ChainOwner, id: DeviceId): EffectSpectrum {
    return new EffectSpectrum(this.context, () => this.engine.effectMonitor(owner, id));
  }

  /** Mixdown di [from, to) del progetto corrente. */
  exportMix(from: Beats, to: Beats): Promise<Float32Array[]> {
    return renderMix(this.store.project, from, to, {
      createGraph: offlineGraph, library: this.library, renders: this.renders, instruments: this.instruments, effects: this.effects,
    }, this.context.sampleRate);
  }

  dispose(): void {
    this.unsubscribe();
    this.engine.dispose();
    this.dsp.dispose();
    void this.context.close();
  }
}
