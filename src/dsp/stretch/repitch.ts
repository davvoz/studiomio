import { readCubic } from '../signal';
import type { StretchInput, TimeStretcher, SettingsOf } from './stretcher';

/** Re-Pitch: lettura a velocità variabile, come un giradischi (cambia l'intonazione). */
export class RepitchStretcher implements TimeStretcher<SettingsOf<'repitch'>> {
  readonly shiftsPitch = true;

  stretch({ channels, map, outLength }: StretchInput): Float32Array[] {
    const pos = new Float64Array(outLength);
    for (let n = 0; n < outLength; n++) pos[n] = map.inputAt(n);
    return channels.map(x => {
      const y = new Float32Array(outLength);
      for (let n = 0; n < outLength; n++) y[n] = readCubic(x, pos[n]);
      return y;
    });
  }
}
