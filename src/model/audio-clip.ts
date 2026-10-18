import type { ClipId, SampleId } from '../core/id';
import type { Beats, Seconds, TempoMap } from '../core/music-time';
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
  /** Volume della clip, indipendente dal mixer: GAIN_MIN_DB..GAIN_MAX_DB */
  readonly gainDb: number;
  /** Suona il sample al contrario. I secondi della clip (marker, transienti) sono quelli
   *  del sample rovesciato: il secondo `t` è il secondo `durata − t` del file. */
  readonly reversed: boolean;
}

export const GAIN_MIN_DB = -70;
export const GAIN_MAX_DB = 24;

/** I secondi del sample (es. i transienti dell'analisi) come li vede la clip: specchiati e
 *  riordinati se la clip è al contrario. */
export function clipTimes(clip: AudioClip, times: readonly Seconds[], duration: Seconds): readonly Seconds[] {
  return clip.reversed ? times.map(t => duration - t).reverse() : times;
}

/** Il crop di una clip audio, come "Crop" in Live: resta solo la parte che suona. */
export interface AudioCrop {
  /** Il tratto da tenere, in secondi del file (mai rovesciati, anche se la clip lo è). */
  readonly fileStart: Seconds;
  readonly fileEnd: Seconds;
  /** La clip che suona il file ritagliato `sample`: si sente come prima. */
  readonly clip: (sample: SampleId) => AudioClip;
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
    return this.with({ gainDb: Math.max(GAIN_MIN_DB, Math.min(GAIN_MAX_DB, db)) });
  }

  /** Al contrario (o di nuovo dritta). Regione e loop restano dove sono e i marker si
   *  specchiano attorno alla parte che suona (il loop, se attivo): si sente lo stesso tratto
   *  di audio, rovesciato. Rovesciare due volte riporta la clip com'era. */
  withReversed(reversed: boolean, duration: Seconds): AudioClip {
    if (reversed === this.reversed) return this;
    const { region, loop } = this;
    const axis = loop.enabled ? loop.start + loop.end : region.start + region.end;
    return this.with({ reversed, warp: { ...this.warp, markers: this.warp.markers.mirrored(duration, axis) } });
  }

  /** Crop del loop (se attivo, altrimenti della regione): il tratto di sample sotto di esso
   *  diventa un file nuovo e la clip suona solo quello, dall'inizio del loop. Null se il
   *  tratto cade tutto fuori dal sample. */
  cropped(duration: Seconds, tempo: TempoMap): AudioCrop | null {
    const { start, end } = this.loop.enabled ? this.loop : this.region;
    // battiti e secondi della clip come nel motore: senza warp il sample parte dal battito 0
    // e scorre al tempo del progetto, alla velocità data dal transpose
    const warp = this.warp.enabled, rate = Math.pow(2, this.pitch / 12);
    const toSeconds = (b: Beats) => (warp ? this.warp.markers.timeOf(b) : tempo.secondsAt(b) * rate);
    const t0 = Math.max(0, toSeconds(start)), t1 = Math.min(duration, toSeconds(end));
    if (!(t1 - t0 > 1e-3)) return null;
    // senza warp il file nuovo riparte dal battito 0: tutto scorre indietro di quanto si taglia
    const shift = warp ? 0 : tempo.beatAt(t0 / rate);
    const cropped = this.warp.markers.cropped(t0, t1);
    const markers = shift ? WarpMarkers.of(cropped.markers.map(m => ({ t: m.t, b: m.b - shift })), cropped.baseBpm) : cropped;
    const envelopes = shift ? this.envelopes.map(e => ({ ...e, points: e.points.map(p => ({ ...p, beat: p.beat - shift })) })) : this.envelopes;
    const s = start - shift, e = end - shift;
    return {
      // nel sample rovesciato il secondo t è il secondo durata − t del file
      fileStart: this.reversed ? duration - t1 : t0,
      fileEnd: this.reversed ? duration - t0 : t1,
      clip: sample => this.with({
        sample, region: { start: s, end: e }, loop: { enabled: this.loop.enabled, start: s, end: e },
        warp: { ...this.warp, markers }, envelopes,
      }),
    };
  }
}
