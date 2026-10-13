import type { ClipId, SampleId } from '../core/id';
import type { Beats } from '../core/music-time';
import type { BeatsLoopMode, WarpMode } from '../dsp/stretch/stretcher';
import { Clip, fullRange, type ClipProps, type Color } from './clip';
import { sampleDuration, type SampleRef } from './sample';
import { WarpMarkers } from './warp-markers';

/** Opzioni di ogni modalità di warp. Si conservano tutte, come in Live: cambiando
 *  modalità e tornando indietro le impostazioni restano quelle di prima. */
export interface WarpOptions {
  readonly beats: {
    /** 'transients' oppure la griglia in battiti (0.25 = sedicesimi). */
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
  /** Senza warp il sample suona alla sua velocità, indipendentemente dal tempo del progetto. */
  readonly enabled: boolean;
  readonly mode: WarpMode;
  readonly markers: WarpMarkers;
  readonly options: WarpOptions;
}

export interface AudioClipProps extends ClipProps {
  readonly sample: SampleId;
  readonly warp: WarpSettings;
  /** Semitoni, −48..48 */
  readonly transpose: number;
  /** Centesimi, −50..50 */
  readonly detune: number;
  readonly gainDb: number;
}

/** Clip che suona (una parte di) un sample, adattata al tempo del progetto dal warp. */
export class AudioClip extends Clip<AudioClipProps> {
  readonly kind = 'audio';

  static create(props: AudioClipProps): AudioClip {
    return new AudioClip(props);
  }

  /** Clip appena importata: warp a tempo costante sul tempo rilevato, tutto il sample. */
  static fromSample(id: ClipId, sample: SampleRef, color: Color): AudioClip {
    const bpm = sample.analysis?.tempo ?? 120;
    const markers = WarpMarkers.straight(bpm, sampleDuration(sample));
    return new AudioClip({
      id, name: sample.name, color,
      ...fullRange(0, markers.beatOf(sampleDuration(sample))),
      sample: sample.id,
      warp: { enabled: true, mode: 'complex', markers, options: DEFAULT_WARP_OPTIONS },
      transpose: 0, detune: 0, gainDb: 0,
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

  /** Trasposizione totale in semitoni (centesimi come decimali). */
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
    return this.with({ gainDb: db });
  }
}
