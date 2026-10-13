import type { StretchInput, TimeStretcher, SettingsOf, BeatsLoopMode } from './stretcher';

/** Dove leggere, nella sorgente, il campione n-esimo dopo la fine della fetta (n ≥ 0),
 *  e con quale guadagno. Una strategia per ogni loop mode. */
type LoopReader = (n: number, slice: { inB: number; loopStart: number; loopLen: number; xf: number }) => { src: number; gain: number };

const loopReaders: Record<Exclude<BeatsLoopMode, 'off'>, LoopReader> = {
  forward: (n, { loopStart, loopLen, xf }) => {
    const m = n % loopLen;
    return { src: loopStart + m, gain: Math.min(1, m / xf, (loopLen - m) / xf) };
  },
  pingpong: (n, { inB, loopStart, loopLen }) => {
    const m = n % (2 * loopLen);
    return { src: m < loopLen ? inB - 1 - m : loopStart + (m - loopLen), gain: 1 };
  },
};

/** Beats: ogni fetta (tra transienti o sulla griglia) suona a velocità originale dalla
 *  sua nuova posizione; i buchi si riempiono secondo il loop mode. */
export class BeatsStretcher implements TimeStretcher<SettingsOf<'beats'>> {
  readonly shiftsPitch = false;

  stretch({ channels, sampleRate, map, outLength }: StretchInput, s: SettingsOf<'beats'>): Float32Array[] {
    const len = channels[0].length;
    const loop = s.loopMode === 'off' ? null : loopReaders[s.loopMode];
    const fadeOut = Math.max(8, Math.round(0.004 * sampleRate));
    const fadeIn = Math.max(4, Math.round(0.0007 * sampleRate));
    const outs = channels.map(() => new Float32Array(outLength));
    const pts = BeatsStretcher.slicePoints(s.slices, len);

    pts.forEach((inA, si) => {
      const last = si + 1 >= pts.length;
      const inB = last ? len : pts[si + 1];
      const oA = Math.round(map.outputAt(inA));
      const oB = last ? outLength : Math.round(map.outputAt(inB));
      const avail = oB - oA, sl = inB - inA;
      if (avail <= 0 || sl <= 0) return;
      const loopStart = inA + (sl >> 1), loopLen = inB - loopStart;
      const xf = Math.max(4, Math.min(256, loopLen >> 2));
      const looping = loop !== null && loopLen >= 64;
      const envStart = s.envelope >= 100 ? Infinity : (avail * s.envelope) / 100;
      const total = avail + fadeOut;
      for (let n = 0; n < total; n++) {
        const o = oA + n;
        if (o < 0) continue;
        if (o >= outLength) break;
        let src: number, g = 1;
        if (n < sl) {
          src = inA + n;
          if (n >= sl - xf && looping && sl < avail) g = (sl - n) / xf;
          else if (!looping && sl < avail && n >= sl - fadeOut) g = (sl - n) / fadeOut;
        } else if (!looping) {
          break;
        } else {
          const r = loop!(n - sl, { inB, loopStart, loopLen, xf });
          src = r.src;
          g = r.gain;
        }
        if (n < fadeIn && si > 0) g *= n / fadeIn;
        if (n > envStart) g *= Math.max(0, 1 - (n - envStart) / (avail - envStart + 1));
        if (n >= avail) g *= 1 - (n - avail) / fadeOut;
        if (g <= 0) continue;
        for (let c = 0; c < channels.length; c++) outs[c][o] += channels[c][src] * g;
      }
    });
    return outs;
  }

  /** Inizi delle fette ordinati, senza fette più corte di 32 campioni; la prima parte da 0. */
  private static slicePoints(slices: readonly number[], len: number): number[] {
    const pts = [0];
    for (const v of [...slices].sort((p, q) => p - q).map(Math.round)) {
      if (v > pts[pts.length - 1] + 32 && v < len - 32) pts.push(v);
    }
    return pts;
  }
}
