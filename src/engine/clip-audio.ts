import { Emitter, type Unsubscribe } from '../core/emitter';
import type { Beats, TempoMap } from '../core/music-time';
import { SupersededError } from '../workers/worker-pool';
import { AudioClip } from '../model/audio-clip';
import type { Project } from '../model/project';
import type { SampleRef } from '../model/sample';
import { toAudioBuffer, type AudioBufferLike, type AudioGraph } from './audio-graph';
import { renderKey, type RenderCache } from './render-cache';
import type { SampleLibrary } from './sample-library';
import { clipRender, type ClipRender } from './warp-job';

/** Audio pronto per una clip: il buffer, il battito della clip in cui cade il suo primo
 *  campione e la velocità di lettura (≠ 1 solo senza warp, per il transpose). */
export interface Playable {
  readonly buffer: AudioBufferLike;
  readonly startBeat: Beats;
  readonly rate: number;
}

export interface PlayableProvider {
  /** L'audio della clip se è pronto; altrimenti lo chiede e restituisce null. */
  playable(clip: AudioClip): Playable | null;
}

type ClipAudioEvents = {
  /** Un render richiesto è pronto: chi sta suonando può riprogrammare. */
  ready: [];
  error: [clip: AudioClip, error: unknown];
};

/** Dalle clip audio ai buffer da suonare, al tempo del progetto corrente. */
export class ClipAudio implements PlayableProvider {
  private tempo: TempoMap | null = null;
  private samples = new Map<string, SampleRef>();
  private readonly jobs = new WeakMap<AudioClip, { tempo: TempoMap; sample: SampleRef; render: ClipRender; key: string }>();
  private readonly buffers = new WeakMap<readonly Float32Array[], AudioBufferLike>();
  private readonly raw = new Map<string, AudioBufferLike>();
  private readonly events = new Emitter<ClipAudioEvents>();

  constructor(
    private readonly graph: AudioGraph,
    private readonly library: SampleLibrary,
    private readonly renders: RenderCache,
  ) {}

  on<K extends keyof ClipAudioEvents>(event: K, fn: (...a: ClipAudioEvents[K]) => void): Unsubscribe {
    return this.events.on(event, fn);
  }

  /** Tempo e sample del progetto; chiede in anticipo i render delle clip sulla timeline. */
  setProject(project: Project): void {
    this.tempo = project.tempo;
    this.samples = new Map(project.samples.map(s => [s.id, s]));
    for (const t of project.tracks) {
      for (const p of t.arrangement) if (p.clip instanceof AudioClip) this.playable(p.clip);
    }
  }

  /** Attende che tutte le clip sulla timeline abbiano il loro audio (per l'export). */
  async prepare(project: Project): Promise<void> {
    this.setProject(project);
    const waits: Promise<unknown>[] = [];
    for (const t of project.tracks) {
      for (const p of t.arrangement) {
        if (!(p.clip instanceof AudioClip) || !p.clip.warp.enabled) continue;
        const j = this.job(p.clip);
        if (j) waits.push(this.renders.ensure(j.key, j.sample.id, j.render.job));
      }
    }
    await Promise.all(waits);
  }

  playable(clip: AudioClip): Playable | null {
    const audio = this.library.get(clip.sample);
    if (!audio) return null;
    if (!clip.warp.enabled) {
      // senza warp: il sample com'è, alla sua velocità (il transpose cambia la velocità)
      let buffer = this.raw.get(clip.sample);
      if (!buffer) {
        buffer = toAudioBuffer(this.graph, audio.channels, audio.sampleRate);
        this.raw.set(clip.sample, buffer);
      }
      return { buffer, startBeat: 0, rate: Math.pow(2, clip.pitch / 12) };
    }
    const j = this.job(clip);
    if (!j) return null;
    const channels = this.renders.get(j.key);
    if (!channels) {
      this.renders.ensure(j.key, j.sample.id, j.render.job, clip.id).then(
        () => this.events.emit('ready'),
        err => { if (!(err instanceof SupersededError)) this.events.emit('error', clip, err); },
      );
      return null;
    }
    let buffer = this.buffers.get(channels);
    if (!buffer) {
      buffer = toAudioBuffer(this.graph, channels, audio.sampleRate);
      this.buffers.set(channels, buffer);
    }
    return { buffer, startBeat: j.render.startBeat, rate: 1 };
  }

  /** Lavoro di warp della clip al tempo corrente (memorizzato per clip e tempo). */
  private job(clip: AudioClip) {
    const tempo = this.tempo, sample = this.samples.get(clip.sample);
    if (!tempo || !sample) return null;
    const cached = this.jobs.get(clip);
    if (cached && cached.tempo === tempo && cached.sample === sample) return cached;
    const render = clipRender(clip, sample, tempo);
    const entry = { tempo, sample, render, key: renderKey(sample.id, render.job) };
    this.jobs.set(clip, entry);
    return entry;
  }
}
