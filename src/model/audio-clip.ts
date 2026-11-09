import type { ClipId, SampleId } from '../core/id';
import type { Beats, Seconds, TempoMap } from '../core/music-time';
import type { BeatsLoopMode, WarpMode } from '../dsp/stretch/stretcher';
import { Clip, fullRange, type ClipProps, type Color } from './clip';
import { sampleDuration, type SampleRef } from './sample';
import { WarpMarkers } from './warp-markers';

/** Options of each warp mode. They're all kept, as in Live: changing
 *  mode and going back the settings stay as they were. */
export interface WarpOptions {
  readonly beats: {
    /** 'transients' or the grid in beats (0.25 = sixteenths). */
    readonly preserve: 'transients' | Beats;
    readonly loop: BeatsLoopMode;
    /** 0..100 */
    readonly envelope: number;
  };
  readonly tones: { readonly grainMs: number };
  /** flux 0..100 */
  readonly texture: { readonly grainMs: number; readonly flux: number };
  readonly complex: { readonly fftSize: number; readonly resetOnTransients: boolean };
}

export const DEFAULT_WARP_OPTIONS: WarpOptions = {
  beats: { preserve: 'transients', loop: 'off', envelope: 100 },
  tones: { grainMs: 50 },
  texture: { grainMs: 80, flux: 20 },
  complex: { fftSize: 4096, resetOnTransients: true },
};

export interface WarpSettings {
  /** Without warp the sample plays at its own speed, regardless of the project's tempo. */
  readonly enabled: boolean;
  readonly mode: WarpMode;
  readonly markers: WarpMarkers;
  readonly options: WarpOptions;
}

export interface AudioClipProps extends ClipProps {
  readonly sample: SampleId;
  readonly warp: WarpSettings;
  /** Semitones, −48..48 */
  readonly transpose: number;
  /** Cents, −50..50 */
  readonly detune: number;
  /** Clip volume, independent of the mixer: GAIN_MIN_DB..GAIN_MAX_DB */
  readonly gainDb: number;
  /** Plays the sample backwards. The clip's seconds (markers, transients) are those
   *  of the reversed sample: second `t` is second `duration − t` of the file. */
  readonly reversed: boolean;
}

export const GAIN_MIN_DB = -70;
export const GAIN_MAX_DB = 24;

/** The sample's seconds (e.g. the analysis's transients) as the clip sees them: mirrored and
 *  re-sorted if the clip is reversed. */
export function clipTimes(clip: AudioClip, times: readonly Seconds[], duration: Seconds): readonly Seconds[] {
  return clip.reversed ? times.map(t => duration - t).reverse() : times;
}

/** An audio clip's crop, like "Crop" in Live: only the part that plays remains. */
export interface AudioCrop {
  /** The stretch to keep, in seconds of the file (never reversed, even if the clip is). */
  readonly fileStart: Seconds;
  readonly fileEnd: Seconds;
  /** The clip playing the cropped file `sample`: it sounds as before. */
  readonly clip: (sample: SampleId) => AudioClip;
}

/** Clip playing (part of) a sample, adapted to the project's tempo by the warp. */
export class AudioClip extends Clip<AudioClipProps> {
  readonly kind = 'audio';

  static create(props: AudioClipProps): AudioClip {
    return new AudioClip(props);
  }

  /** Newly imported clip: constant-tempo warp on the detected tempo, the whole sample. */
  static fromSample(id: ClipId, sample: SampleRef, color: Color): AudioClip {
    const bpm = sample.analysis?.tempo ?? 120;
    const markers = WarpMarkers.straight(bpm, sampleDuration(sample));
    return new AudioClip({
      id, name: sample.name, color,
      ...fullRange(0, markers.beatOf(sampleDuration(sample))),
      sample: sample.id,
      warp: { enabled: true, mode: 'complex', markers, options: DEFAULT_WARP_OPTIONS },
      transpose: 0, detune: 0, gainDb: 0, reversed: false,
    });
  }

  protected create(props: AudioClipProps): this {
    return new AudioClip(props) as this;
  }

  get sample(): SampleId { return this.props.sample; }
  get warp(): WarpSettings { return this.props.warp; }
  get transpose(): number { return this.props.transpose; }
  get detune(): number { return this.props.detune; }
  get gainDb(): number { return this.props.gainDb; }
  get reversed(): boolean { return this.props.reversed; }

  /** Total transposition in semitones (cents as decimals). */
  get pitch(): number {
    return this.transpose + this.detune / 100;
  }

  withWarp(patch: Partial<WarpSettings>): AudioClip {
    return this.with({ warp: { ...this.warp, ...patch } });
  }

  withMarkers(markers: WarpMarkers): AudioClip {
    return this.withWarp({ markers });
  }

  withWarpOptions<M extends keyof WarpOptions>(mode: M, patch: Partial<WarpOptions[M]>): AudioClip {
    return this.withWarp({ options: { ...this.warp.options, [mode]: { ...this.warp.options[mode], ...patch } } });
  }

  withTranspose(semitones: number): AudioClip {
    return this.with({ transpose: Math.max(-48, Math.min(48, Math.round(semitones))) });
  }

  withDetune(cents: number): AudioClip {
    return this.with({ detune: Math.max(-50, Math.min(50, cents)) });
  }

  withGain(db: number): AudioClip {
    return this.with({ gainDb: Math.max(GAIN_MIN_DB, Math.min(GAIN_MAX_DB, db)) });
  }

  /** Reversed (or straight again). Region and loop stay where they are and the markers are
   *  mirrored around the playing part (the loop, if active): you hear the same stretch
   *  of audio, reversed. Reversing twice brings the clip back as it was. */
  withReversed(reversed: boolean, duration: Seconds): AudioClip {
    if (reversed === this.reversed) return this;
    const { region, loop } = this;
    const axis = loop.enabled ? loop.start + loop.end : region.start + region.end;
    return this.with({ reversed, warp: { ...this.warp, markers: this.warp.markers.mirrored(duration, axis) } });
  }

  /** Crop of the loop (if active, otherwise of the region): the stretch of sample under it
   *  becomes a new file and the clip plays only that, from the start of the loop. Null if the
   *  stretch falls entirely outside the sample. */
  cropped(duration: Seconds, tempo: TempoMap): AudioCrop | null {
    const { start, end } = this.loop.enabled ? this.loop : this.region;
    // the clip's beats and seconds as in the engine: without warp the sample starts from beat 0
    // and flows at the project's tempo, at the speed given by the transpose
    const warp = this.warp.enabled, rate = Math.pow(2, this.pitch / 12);
    const toSeconds = (b: Beats) => (warp ? this.warp.markers.timeOf(b) : tempo.secondsAt(b) * rate);
    const t0 = Math.max(0, toSeconds(start)), t1 = Math.min(duration, toSeconds(end));
    if (!(t1 - t0 > 1e-3)) return null;
    // without warp the new file restarts from beat 0: everything shifts back by as much as is cut
    const shift = warp ? 0 : tempo.beatAt(t0 / rate);
    const cropped = this.warp.markers.cropped(t0, t1);
    const markers = shift ? WarpMarkers.of(cropped.markers.map(m => ({ t: m.t, b: m.b - shift })), cropped.baseBpm) : cropped;
    const envelopes = shift ? this.envelopes.map(e => ({ ...e, points: e.points.map(p => ({ ...p, beat: p.beat - shift })) })) : this.envelopes;
    const s = start - shift, e = end - shift;
    return {
      // in the reversed sample second t is second duration − t of the file
      fileStart: this.reversed ? duration - t1 : t0,
      fileEnd: this.reversed ? duration - t0 : t1,
      clip: sample => this.with({
        sample, region: { start: s, end: e }, loop: { enabled: this.loop.enabled, start: s, end: e },
        warp: { ...this.warp, markers }, envelopes,
      }),
    };
  }
}
