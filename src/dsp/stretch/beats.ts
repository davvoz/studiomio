import type { StretchInput, TimeStretcher, SettingsOf, BeatsLoopMode } from './stretcher';

/** Where to read, in the source, the n-th sample after the end of the slice (n ≥ 0),
 *  and with which gain. One strategy per loop mode. */
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

/** A slice of the input and where it lands in the output: its own length `sl`, the room it has
 *  `avail`; when the room is longer, its second half loops (or it fades). */
interface Slice {
  readonly first: boolean;
  readonly inA: number;
  readonly inB: number;
  readonly oA: number;
  readonly avail: number;
  readonly sl: number;
  readonly loopStart: number;
  readonly loopLen: number;
  readonly xf: number;
  readonly looping: boolean;
  /** Where the Envelope starts fading the slice (Infinity: at 100 %, never). */
  readonly envStart: number;
}

interface Fades {
  readonly loop: LoopReader | null;
  readonly fadeOut: number;
  readonly fadeIn: number;
}

/** The input sample a slice reads at its `n`-th output sample, and the gain there (reused). */
const reading = { src: 0, gain: 1 };

/** A slice into the outputs, with its fades. */
function renderSlice(slice: Slice, fades: Fades, channels: readonly Float32Array[], outs: Float32Array[], outLength: number): void {
  const total = slice.avail + fades.fadeOut;
  for (let n = 0; n < total; n++) {
    const o = slice.oA + n;
    if (o < 0) continue;
    if (o >= outLength || !sourceAt(n, slice, fades)) break;
    const g = faded(reading.gain, n, slice, fades);
    if (g <= 0) continue;
    for (let c = 0; c < channels.length; c++) outs[c][o] += channels[c][reading.src] * g;
  }
}

/** Into `reading`: the slice itself (fading out before its end if the room is longer), then the
 *  loop of its second half. False when the slice has ended and doesn't loop. */
function sourceAt(n: number, slice: Slice, fades: Fades): boolean {
  const { sl, avail, looping, xf } = slice;
  if (n < sl) {
    reading.src = slice.inA + n;
    reading.gain = 1;
    if (n >= sl - xf && looping && sl < avail) reading.gain = (sl - n) / xf;
    else if (!looping && sl < avail && n >= sl - fades.fadeOut) reading.gain = (sl - n) / fades.fadeOut;
    return true;
  }
  if (!looping) return false;
  const r = fades.loop!(n - sl, { inB: slice.inB, loopStart: slice.loopStart, loopLen: slice.loopLen, xf });
  reading.src = r.src;
  reading.gain = r.gain;
  return true;
}

/** The gain with the fades: in at the start (not the first slice), the Envelope, out after the room. */
function faded(gain: number, n: number, slice: Slice, fades: Fades): number {
  let g = gain;
  if (n < fades.fadeIn && !slice.first) g *= n / fades.fadeIn;
  if (n > slice.envStart) g *= Math.max(0, 1 - (n - slice.envStart) / (slice.avail - slice.envStart + 1));
  if (n >= slice.avail) g *= 1 - (n - slice.avail) / fades.fadeOut;
  return g;
}

/** Beats: each slice (between transients or on the grid) plays at original speed from
 *  its new position; the gaps are filled according to the loop mode. */
export class BeatsStretcher implements TimeStretcher<SettingsOf<'beats'>> {
  readonly shiftsPitch = false;

  stretch({ channels, sampleRate, map, outLength }: StretchInput, s: SettingsOf<'beats'>): Float32Array[] {
    const len = channels[0].length;
    const fades = { loop: s.loopMode === 'off' ? null : loopReaders[s.loopMode], fadeOut: Math.max(8, Math.round(0.004 * sampleRate)), fadeIn: Math.max(4, Math.round(0.0007 * sampleRate)) };
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
      const slice: Slice = {
        first: si === 0, inA, inB, oA, avail, sl, loopStart, loopLen,
        xf: Math.max(4, Math.min(256, loopLen >> 2)),
        looping: fades.loop !== null && loopLen >= 64,
        envStart: s.envelope >= 100 ? Infinity : (avail * s.envelope) / 100,
      };
      renderSlice(slice, fades, channels, outs, outLength);
    });
    return outs;
  }

  /** Slice starts sorted, without slices shorter than 32 samples; the first starts at 0. */
  private static slicePoints(slices: readonly number[], len: number): number[] {
    const pts = [0];
    for (const v of [...slices].sort((p, q) => p - q).map(Math.round)) {
      if (v > pts.at(-1)! + 32 && v < len - 32) pts.push(v);
    }
    return pts;
  }
}
