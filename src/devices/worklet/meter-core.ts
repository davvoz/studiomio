/** A meter's values, in this order: left and right peak, left and right mean
 *  of squares. The AudioWorklet writes it, the interface reads it (and resets the peaks). */
export const METER_VALUES = 4;

/** Time constant of the mean of squares, in seconds: the RMS falls by about 36 dB per second. */
const RMS_TIME = 0.12;

/** Measures one block at a time: the peak accumulates in `out` until the reader resets it,
 *  the mean of squares glides with the constant RMS_TIME. */
export class MeterCore {
  private msL = 0;
  private msR = 0;

  constructor(private readonly sampleRate: number, private readonly out: Float32Array) {}

  process(left: Float32Array, right: Float32Array, n: number): void {
    let pl = 0, pr = 0, sl = 0, sr = 0;
    for (let i = 0; i < n; i++) {
      const l = left[i], r = right[i];
      const al = Math.abs(l), ar = Math.abs(r);
      if (al > pl) pl = al;
      if (ar > pr) pr = ar;
      sl += l * l;
      sr += r * r;
    }
    const d = Math.exp(-n / (RMS_TIME * this.sampleRate));
    this.msL = flush(this.msL * d + (sl / n) * (1 - d));
    this.msR = flush(this.msR * d + (sr / n) * (1 - d));
    const out = this.out;
    if (pl > out[0]) out[0] = pl;
    if (pr > out[1]) out[1] = pr;
    out[2] = this.msL;
    out[3] = this.msR;
  }
}

const flush = (x: number) => (x < 1e-30 ? 0 : x);
