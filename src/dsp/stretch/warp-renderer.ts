import { resample } from '../signal';
import { TimeMap, type MapPoint } from '../time-map';
import type { AudioData } from '../types';
import { BeatsStretcher } from './beats';
import { ComplexStretcher } from './phase-vocoder';
import { RepitchStretcher } from './repitch';
import type { StretchSettings, StretcherTable, TimeStretcher } from './stretcher';
import { TextureStretcher, TonesStretcher } from './wsola';

export interface WarpJob {
  /** Mappa di warp: [campione di uscita, campione di ingresso], crescenti. */
  readonly points: readonly MapPoint[];
  /** Lunghezza del risultato in campioni. */
  readonly outLength: number;
  /** Semitoni (con i centesimi come decimali). Ignorato dagli algoritmi che cambiano già l'intonazione. */
  readonly transpose: number;
  readonly settings: StretchSettings;
  /** Il sample si legge al contrario: i punti della mappa sono nel sample rovesciato. */
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

/** Applica un warp: sceglie l'algoritmo dalla tabella e gestisce la trasposizione
 *  (stretch più lungo/corto di 2^(st/12), poi ricampionamento alla durata richiesta). */
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
    // La tabella è tipizzata per modalità: qui l'abbinamento è garantito da StretcherTable.
    return this.stretchers[settings.mode] as TimeStretcher;
  }
}
