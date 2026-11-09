import type { Beats, TempoMap } from '../core/music-time';
import type { MapPoint } from '../dsp/time-map';
import type { SettingsOf, WarpMode } from '../dsp/stretch/stretcher';
import type { WarpJob } from '../dsp/stretch/warp-renderer';
import { clipTimes, type AudioClip, type WarpOptions } from '../model/audio-clip';
import { sampleDuration, type SampleRef } from '../model/sample';
import type { WarpMarkers } from '../model/warp-markers';

/** A clip's warp job: the whole sample brought to the project's tempo. */
export interface ClipRender {
  readonly job: WarpJob;
  /** Clip beat the first sample of the result falls on. */
  readonly startBeat: Beats;
}

interface SettingsContext {
  readonly options: WarpOptions;
  /** The sample's transients, in samples. */
  readonly transients: readonly number[];
  /** Slice starts on the grid of `step` beats, in samples. */
  readonly gridSlices: (step: Beats) => number[];
}

/** From the options saved in the clip to the algorithm's settings, mode by mode. */
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

/** [output, input] points in samples: each marker inside the sample, plus start and end. */
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

/** The clip's pitch with `shift` extra semitones, within the transpose's limits. */
export const shiftedPitch = (clip: AudioClip, shift: number): number => Math.max(-48, Math.min(48, clip.transpose + shift)) + clip.detune / 100;

/** The warp job of an audio clip (with warp active) at the project's tempo, transposed by
 *  `shift` extra semitones (the transpose curve). */
export function clipRender(clip: AudioClip, sample: SampleRef, tempo: TempoMap, shift = 0): ClipRender {
  if (!clip.warp.enabled) throw new Error('the clip doesn\'t use warp');
  if (clip.sample !== sample.id) throw new Error('the sample isn\'t the clip\'s');
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
      transpose: shiftedPitch(clip, shift),
      settings,
      // only if needed: the straight clips keep their usual render key
      ...(clip.reversed ? { reverse: true } : {}),
    },
    startBeat,
  };
}
