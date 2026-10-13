import type { SampleId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import type { AudioData } from '../dsp/types';
import { ClipAudio } from '../engine/clip-audio';
import { renderMix } from '../engine/offline-mix';
import { PlaybackEngine } from '../engine/playback-engine';
import { RenderCache } from '../engine/render-cache';
import { SampleLibrary } from '../engine/sample-library';
import { liveGraph, offlineGraph } from '../engine/web-audio';
import { WorkletInstruments } from '../engine/worklet-instruments';
import type { Project } from '../model/project';
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
  readonly instruments = new WorkletInstruments();
  private readonly unsubscribe: () => void;

  constructor(private readonly store: ProjectStore) {
    const graph = liveGraph(this.context);
    // il modulo degli strumenti si carica subito: al primo play è già pronto
    this.instruments.prepare(graph).catch(e => console.error('AudioWorklet degli strumenti non caricato', e));
    this.clips = new ClipAudio(graph, this.library, this.renders);
    this.engine = new PlaybackEngine(graph, { clips: this.clips, instruments: this.instruments });
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

  /** Mixdown di [from, to) del progetto corrente. */
  exportMix(from: Beats, to: Beats): Promise<Float32Array[]> {
    return renderMix(this.store.project, from, to, {
      createGraph: offlineGraph, library: this.library, renders: this.renders, instruments: this.instruments,
    }, this.context.sampleRate);
  }

  dispose(): void {
    this.unsubscribe();
    this.engine.dispose();
    this.dsp.dispose();
    void this.context.close();
  }
}
