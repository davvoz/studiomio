import { resample } from '../signal';
import { TimeMap, type MapPoint } from '../time-map';
import type { AudioData } from '../types';
import { BeatsStretcher } from './beats';
import { ComplexStretcher } from './phase-vocoder';
import { RepitchStretcher } from './repitch';
import type { StretchSettings, StretcherTable, TimeStretcher } from './stretcher';
import { TextureStretcher, TonesStretcher } from './wsola';

export interface WarpJob {
  /** Warp map: [output sample, input sample], increasing. */
  readonly points: readonly MapPoint[];
  /** Length of the result in samples. */
  readonly outLength: number;
  /** Semitones (with the cents as decimals). Ignored by the algorithms that already change the pitch. */
  readonly transpose: number;
  readonly settings: StretchSettings;
  /** The sample is read backwards: the map's points are in the reversed sample. */
  readonly reverse?: boolean;
}

const reversed = (channels: readonly Float32Array[]): Float32Array[] => channels.map(c => c.slice().reverse());

export const defaultStretchers = (): StretcherTable => ({
  repitch: new RepitchStretcher(),
  beats: new BeatsStretcher(),
  tones: new TonesStretcher(),
  texture: new TextureStretcher(),
  complex: new ComplexStretcher(),
});

/** Applies a warp: chooses the algorithm from the table and handles the transposition
 *  (stretch longer/shorter by 2^(st/12), then resampling to the requested length). */
export class WarpRenderer {
  constructor(private readonly stretchers: StretcherTable = defaultStretchers()) {}

  render(audio: AudioData, job: WarpJob): Float32Array[] {
    const { sampleRate } = audio, channels = job.reverse ? reversed(audio.channels) : audio.channels;
    const stretcher = this.stretcherFor(job.settings);
    const ratio = stretcher.shiftsPitch ? 1 : Math.pow(2, job.transpose / 12);
    const map = new TimeMap(job.points).scaleOutput(ratio);
    const length = Math.max(1, Math.round(job.outLength * ratio));
    const out = stretcher.stretch({ channels, sampleRate, map, outLength: length }, job.settings);
    return Math.abs(ratio - 1) > 1e-6 ? resample(out, ratio, job.outLength) : out;
  }

  private stretcherFor(settings: StretchSettings): TimeStretcher {
    // The table is typed per mode: here the pairing is guaranteed by StretcherTable.
    return this.stretchers[settings.mode] as TimeStretcher;
  }
}
