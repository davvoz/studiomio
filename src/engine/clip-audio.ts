import { Emitter, type Unsubscribe } from '../core/emitter';
import type { ClipId, SampleId } from '../core/id';
import type { Beats, TempoMap } from '../core/music-time';
import { SupersededError } from '../workers/worker-pool';
import { AudioClip } from '../model/audio-clip';
import { CLIP_TRANSPOSE, steppedValues } from '../model/envelope';
import type { Project } from '../model/project';
import type { SampleRef } from '../model/sample';
import { toAudioBuffer, type AudioBufferLike, type AudioGraph } from './audio-graph';
import { renderKey, type RenderCache } from './render-cache';
import type { SampleLibrary } from './sample-library';
import { clipRender, shiftedPitch, type ClipRender } from './warp-job';

/** Audio ready for a clip: the buffer, the clip's beat its first sample falls on
 *  and the reading speed (≠ 1 only without warp, for the transpose). */
export interface Playable {
  readonly buffer: AudioBufferLike;
  readonly startBeat: Beats;
  readonly rate: number;
  /** Provisional audio (the previous render, while the new one arrives): whoever plays it should
   *  reschedule it when the right one arrives. */
  readonly provisional?: boolean;
}

export interface PlayableProvider {
  /** The clip's audio (transposed by `shift` extra semitones) if it's ready; otherwise it
   *  requests it and returns null. */
  playable(clip: AudioClip, shift?: number): Playable | null;
}

/** The semitone offsets the clip's transpose curve plays, besides 0. */
const shiftsOf = (clip: AudioClip) => steppedValues(clip.envelope(CLIP_TRANSPOSE)?.points ?? []).filter(s => s !== 0);

type ClipAudioEvents = {
  /** A requested render is ready: whoever is playing can reschedule. */
  ready: [];
  error: [clip: AudioClip, error: unknown];
};

/** From the audio clips to the buffers to play, at the current project's tempo. */
export class ClipAudio implements PlayableProvider {
  private tempo: TempoMap | null = null;
  private samples = new Map<string, SampleRef>();
  private readonly jobs = new WeakMap<AudioClip, Map<number, { tempo: TempoMap; sample: SampleRef; render: ClipRender; key: string }>>();
  private readonly buffers = new WeakMap<readonly Float32Array[], AudioBufferLike>();
  private readonly raw = new Map<string, AudioBufferLike>();
  /** Each clip's last ready render and the tempo it was made at: it plays in place of the
   *  new one until it arrives (changing the tempo doesn't interrupt the audio). */
  private readonly last = new Map<ClipId, { readonly playable: Playable; readonly tempo: TempoMap; readonly sample: SampleId }>();
  private readonly events = new Emitter<ClipAudioEvents>();

  constructor(
    private readonly graph: AudioGraph,
    private readonly library: SampleLibrary,
    private readonly renders: RenderCache,
  ) {}

  on<K extends keyof ClipAudioEvents>(event: K, fn: (...a: ClipAudioEvents[K]) => void): Unsubscribe {
    return this.events.on(event, fn);
  }

  /** The project's tempo and samples; requests in advance the renders of the clips on the timeline. */
  setProject(project: Project): void {
    this.tempo = project.tempo;
    this.samples = new Map(project.samples.map(s => [s.id, s]));
    const clips = new Set(project.tracks.flatMap(t => t.clips.map(c => c.id)));
    for (const id of this.last.keys()) if (!clips.has(id)) this.last.delete(id);
    for (const t of project.tracks) {
      for (const p of t.arrangement) {
        if (!(p.clip instanceof AudioClip)) continue;
        this.playable(p.clip);
        for (const shift of shiftsOf(p.clip)) this.playable(p.clip, shift);
      }
    }
  }

  /** Waits until all the clips on the timeline have their audio (for the export). */
  async prepare(project: Project): Promise<void> {
    this.setProject(project);
    const waits: Promise<unknown>[] = [];
    for (const t of project.tracks) {
      for (const p of t.arrangement) {
        if (!(p.clip instanceof AudioClip) || !p.clip.warp.enabled) continue;
        for (const shift of [0, ...shiftsOf(p.clip)]) {
          const j = this.job(p.clip, shift);
          if (j) waits.push(this.renders.ensure(j.key, j.sample.id, j.render.job));
        }
      }
    }
    await Promise.all(waits);
  }

  playable(clip: AudioClip, shift = 0): Playable | null {
    const audio = this.library.get(clip.sample);
    if (!audio) return null;
    if (!clip.warp.enabled) {
      // without warp: the sample as it is, at its own speed (the transpose changes the speed)
      const key = clip.reversed ? `${clip.sample}|reverse` : clip.sample;
      let buffer = this.raw.get(key);
      if (!buffer) {
        const channels = clip.reversed ? audio.channels.map(c => c.slice().reverse()) : audio.channels;
        buffer = toAudioBuffer(this.graph, channels, audio.sampleRate);
        this.raw.set(key, buffer);
      }
      return { buffer, startBeat: 0, rate: Math.pow(2, shiftedPitch(clip, shift) / 12) };
    }
    const j = this.job(clip, shift);
    if (!j) return null;
    const channels = this.renders.get(j.key);
    if (!channels) {
      this.renders.ensure(j.key, j.sample.id, j.render.job, shift ? `${clip.id}|${shift}` : clip.id).then(
        () => this.events.emit('ready'),
        err => { if (!(err instanceof SupersededError)) this.events.emit('error', clip, err); },
      );
      // the curve's semitones have no substitute: they arrive quickly and get rescheduled
      return shift ? null : this.standIn(clip, j.tempo);
    }
    let buffer = this.buffers.get(channels);
    if (!buffer) {
      buffer = toAudioBuffer(this.graph, channels, audio.sampleRate);
      this.buffers.set(channels, buffer);
    }
    const playable = { buffer, startBeat: j.render.startBeat, rate: 1 };
    if (!shift) this.last.set(clip.id, { playable, tempo: j.tempo, sample: clip.sample });
    return playable;
  }

  /** While the new render is being computed: the clip's last ready one, read faster or slower
   *  as much as needed to stay in time (for a moment the pitch follows the speed). Null if the
   *  clip doesn't have one of the same sample. */
  private standIn(clip: AudioClip, tempo: TempoMap): Playable | null {
    const last = this.last.get(clip.id);
    if (!last || last.sample !== clip.sample) return null;
    // at constant tempo beat b is at secondsAt(b): the ratio between the durations of a beat is enough
    const speed = last.tempo.secondsAt(1) / tempo.secondsAt(1);
    return { ...last.playable, rate: last.playable.rate * speed, provisional: true };
  }

  /** The clip's warp work at the current tempo (memoized per clip, semitones and tempo). */
  private job(clip: AudioClip, shift: number) {
    const tempo = this.tempo, sample = this.samples.get(clip.sample);
    if (!tempo || !sample) return null;
    let byShift = this.jobs.get(clip);
    if (!byShift) this.jobs.set(clip, (byShift = new Map()));
    const cached = byShift.get(shift);
    if (cached && cached.tempo === tempo && cached.sample === sample) return cached;
    const render = clipRender(clip, sample, tempo, shift);
    const entry = { tempo, sample, render, key: renderKey(sample.id, render.job) };
    byShift.set(shift, entry);
    return entry;
  }
}
