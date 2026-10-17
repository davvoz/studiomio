import type { Beats, TempoMap } from '../core/music-time';
import type { MapPoint } from '../dsp/time-map';
import type { SettingsOf, WarpMode } from '../dsp/stretch/stretcher';
import type { WarpJob } from '../dsp/stretch/warp-renderer';
import { clipTimes, type AudioClip, type WarpOptions } from '../model/audio-clip';
import { sampleDuration, type SampleRef } from '../model/sample';
import type { WarpMarkers } from '../model/warp-markers';

/** Lavoro di warp di una clip: il sample intero portato al tempo del progetto. */
export interface ClipRender {
  readonly job: WarpJob;
  /** Battito della clip in cui cade il primo campione del risultato. */
  readonly startBeat: Beats;
}

interface SettingsContext {
  readonly options: WarpOptions;
  /** Transienti del sample, in campioni. */
  readonly transients: readonly number[];
  /** Inizi delle fette sulla griglia di `step` battiti, in campioni. */
  readonly gridSlices: (step: Beats) => number[];
}

/** Dalle opzioni salvate nella clip alle impostazioni dell'algoritmo, modalità per modalità. */
const settingsFor: { readonly [M in WarpMode]: (c: SettingsContext) => SettingsOf<M> } = {
  repitch: () => ({ mode: 'repitch' }),
  beats: ({ options: { beats }, transients, gridSlices }) => ({
    mode: 'beats',
    slices: beats.preserve === 'transients' ? transients : gridSlices(beats.preserve),
    loopMode: beats.loop,
    envelope: beats.envelope,
  }),
  tones: ({ options }) => ({ mode: 'tones', grainMs: options.tones.grainMs }),
  texture: ({ options }) => ({ mode: 'texture', grainMs: options.texture.grainMs, flux: options.texture.flux / 100 }),
  complex: ({ options, transients }) => ({
    mode: 'complex', fftSize: options.complex.fftSize,
    transients: options.complex.resetOnTransients ? transients : null,
  }),
};

/** Punti [uscita, ingresso] in campioni: ogni marker dentro il sample, più inizio e fine. */
function mapPoints(markers: WarpMarkers, duration: number, sr: number, tempo: TempoMap): MapPoint[] {
  const b0 = markers.beatOf(0);
  const ts = [0, duration, ...markers.markers.map(m => m.t).filter(t => t > 0 && t < duration)].sort((a, b) => a - b);
  const points: MapPoint[] = [];
  for (const t of ts) {
    if (points.length && t * sr - points[points.length - 1][1] < 1) continue;
    points.push([tempo.secondsAt(markers.beatOf(t) - b0) * sr, t * sr]);
  }
  return points;
}

/** Il lavoro di warp di una clip audio (con warp attivo) al tempo del progetto. */
export function clipRender(clip: AudioClip, sample: SampleRef, tempo: TempoMap): ClipRender {
  if (!clip.warp.enabled) throw new Error('la clip non usa il warp');
  if (clip.sample !== sample.id) throw new Error('il sample non è quello della clip');
  const sr = sample.sampleRate, duration = sampleDuration(sample), markers = clip.warp.markers;
  const points = mapPoints(markers, duration, sr, tempo);
  const startBeat = markers.beatOf(0), endBeat = markers.beatOf(duration);
  const gridSlices = (step: Beats): number[] => {
    const out: number[] = [];
    for (let b = Math.ceil(startBeat / step - 1e-9) * step; b < endBeat; b += step) out.push(markers.timeOf(b) * sr);
    return out;
  };
  const settings = settingsFor[clip.warp.mode]({
    options: clip.warp.options,
    transients: clipTimes(clip, sample.analysis?.transients ?? [], duration).map(t => t * sr),
    gridSlices,
  });
  return {
    job: {
      points,
      outLength: Math.max(1, Math.round(points[points.length - 1][0])),
      transpose: clip.pitch,
      settings,
      // solo se serve: le clip dritte tengono la chiave di render di sempre
      ...(clip.reversed ? { reverse: true } : {}),
    },
    startBeat,
  };
}
