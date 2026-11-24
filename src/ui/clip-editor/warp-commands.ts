/* The audio editor's commands, without the DOM: Auto-Warp, Follow tempo, quantize and reset the markers,
 * warp and reverse on or off, 1.1.1 on a marker, a marker added or deleted, Crop. They're what the
 * menu and the panel do. Each change is an undo step; what can't be done is said. */
import type { Beats, Seconds } from '../../core/music-time';
import { clipTimes, type AudioClip } from '../../model/audio-clip';
import { sampleDuration, type SampleRef } from '../../model/sample';
import { autoWarp, followTempo } from '../../model/warp-tools';
import { cropClipAt, findClip, type ClipRef, type FoundClip } from '../../store/clip-ref';
import type { ProjectStore } from '../../store/project-store';
import type { EditorMenuActions } from './editor-menu';

/** The open clip with its sample. */
export interface WarpTarget {
  readonly clip: AudioClip;
  readonly found: FoundClip;
  readonly sample: SampleRef;
}

/** The analysis's transients in the clip's seconds (mirrored if it's reversed). */
export const clipTransients = (t: WarpTarget): readonly Seconds[] =>
  clipTimes(t.clip, t.sample.analysis?.transients ?? [], sampleDuration(t.sample));

/** What the commands use of the app. */
export interface WarpDeps {
  readonly store: ProjectStore;
  /** Beats (in samples) following the given tempo: the DSP workers' beat tracking. */
  readonly trackBeats: (sample: SampleRef, bpm: number) => Promise<number[]>;
  /** The stretch [from, to] (seconds) of a sample as a new project file, loaded in the engine. */
  readonly cropSample: (sample: SampleRef, from: Seconds, to: Seconds) => Promise<SampleRef>;
  readonly say: (text: string) => void;
}

/** What the commands use of the editor. */
export interface WarpEditor {
  /** The open clip and its sample (null: none). */
  target(): WarpTarget | null;
  /** Where the open clip is. */
  ref(): ClipRef | null;
  /** The chosen marker (-1: none). */
  selected(): number;
  /** Chooses the marker (and shows it in the panel). */
  selectMarker(index: number): void;
  /** Forgets the chosen marker (the change that follows redraws). */
  forgetMarker(): void;
  commit(label: string, fn: (c: AudioClip) => AudioClip): void;
  /** The grid's step. */
  grid(): Beats;
  /** Frames the clip again. */
  refit(): void;
}

export class WarpCommands implements EditorMenuActions {
  constructor(private readonly deps: WarpDeps, private readonly view: WarpEditor) {}

  /** The sample has been analysed (tempo and transients). */
  get analysed(): boolean {
    return !!this.view.target()?.sample.analysis;
  }

  private duration(): Seconds {
    const t = this.view.target();
    return t ? sampleDuration(t.sample) : 0;
  }

  private transients(): readonly Seconds[] {
    const t = this.view.target();
    return t ? clipTransients(t) : [];
  }

  autoWarp(): void {
    const t = this.view.target();
    const a = t?.sample.analysis;
    if (!t || !a) return this.deps.say('The sample hasn\'t been analysed.');
    this.view.commit('Auto-Warp', c => c.withMarkers(autoWarp(a.tempo, this.transients(), sampleDuration(t.sample))).withWarp({ enabled: true }));
    this.deps.say(`Auto-Warp: ${a.tempo.toFixed(2)} BPM.`);
  }

  async followTempo(): Promise<void> {
    const t = this.view.target();
    const a = t?.sample.analysis;
    if (!t || !a) return this.deps.say('The sample hasn\'t been analysed.');
    const sr = t.sample.sampleRate, duration = sampleDuration(t.sample);
    const beats = clipTimes(t.clip, (await this.deps.trackBeats(t.sample, a.tempo)).map(i => i / sr), duration);
    const markers = followTempo(beats, clipTimes(t.clip, a.transients, duration), a.tempo, duration, this.deps.store.project.signature.beatsPerBar);
    if (!markers) return this.deps.say('Couldn\'t find enough beats: try Auto-Warp.');
    this.view.commit('Follow tempo', c => c.withMarkers(markers).withWarp({ enabled: true }));
    this.deps.say(`Follow tempo: ${markers.length} markers.`);
  }

  quantize(): void {
    const step = Math.min(1, this.view.grid());
    this.view.commit('Quantize warp markers', c => c.withMarkers(c.warp.markers.quantized(step)));
  }

  resetMarkers(): void {
    this.view.commit('Reset warp markers', c => c.withMarkers(c.warp.markers.cleared(this.duration())));
  }

  setWarp(on: boolean): void {
    this.view.commit(on ? 'Warp on' : 'Warp off', c => c.withWarp({ enabled: on }));
  }

  setReversed(on: boolean): void {
    this.view.commit(on ? 'Reverse' : 'Reverse off', c => c.withReversed(on, this.duration()));
  }

  /** Marker `index` becomes the start of bar 1. */
  setOrigin(index: number): void {
    this.view.commit('Set 1.1.1', c => c.withMarkers(c.warp.markers.withOrigin(c.warp.markers.markers[index].t)));
  }

  /** The chosen marker goes (at least two must stay). */
  deleteMarker(): void {
    const i = this.view.selected();
    const clip = this.view.target()?.clip;
    if (clip && i >= 0 && clip.warp.markers.canRemove(i)) {
      this.view.forgetMarker();
      this.view.commit('Delete warp marker', c => c.withMarkers(c.warp.markers.without(i)));
    } else this.deps.say('At least two warp markers are needed: use "Reset" to restart from a constant tempo.');
  }

  /** A warp marker at beat `beat` (if warp is on and it falls in the sample), chosen. */
  addMarkerAt(beat: Beats): void {
    const clip = this.view.target()?.clip;
    if (!clip?.warp.enabled) return;
    const t = clip.warp.markers.timeOf(beat);
    if (t < 0 || t > this.duration()) return;
    const { markers, index } = clip.warp.markers.withMarkerAt(t);
    if (markers !== clip.warp.markers) this.view.commit('Add warp marker', c => c.withMarkers(markers));
    this.view.selectMarker(index);
  }

  /** Crop: the loop (or the region) becomes a file of its own and the clip plays only that. */
  async crop(): Promise<void> {
    const t = this.view.target(), ref = this.view.ref();
    if (!t || !ref) return;
    const { store, say } = this.deps;
    const crop = t.clip.cropped(sampleDuration(t.sample), store.project.tempo);
    if (!crop) return say('Crop: the part to keep is outside the sample.');
    try {
      const sample = await this.deps.cropSample(t.sample, crop.fileStart, crop.fileEnd);
      // the new file is ready meanwhile, but the clip may have changed (or disappeared) in the meantime
      if (findClip(store.project, ref)?.clip !== t.clip) return say('Crop cancelled: the clip changed in the meantime.');
      store.apply(cropClipAt(ref, sample, crop.clip(sample.id)));
      this.view.forgetMarker();
      if (this.view.ref() === ref) this.view.refit();
      say(`Crop: ${(crop.fileEnd - crop.fileStart).toFixed(2)} s in "${sample.name}".`);
    } catch (e) {
      say(`Crop: ${e instanceof Error ? e.message : e}`);
    }
  }
}
