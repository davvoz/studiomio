/** A pair of positions in samples: [output, input]. */
export type MapPoint = readonly [output: number, input: number];

/** Piecewise linear correspondence between output and input samples, extrapolated
 *  with the slope of the outermost segments. It's the warp map as the DSP sees it. */
export class TimeMap {
  private readonly out: Float64Array;
  private readonly inp: Float64Array;

  constructor(points: readonly MapPoint[]) {
    if (points.length === 0) throw new RangeError('TimeMap: at least one point is needed');
    this.out = Float64Array.from(points, p => p[0]);
    this.inp = Float64Array.from(points, p => p[1]);
  }

  /** Input sample that plays at output sample `o`. */
  inputAt(o: number): number {
    return TimeMap.lerp(this.out, this.inp, o);
  }

  /** Output sample at which input sample `i` plays. */
  outputAt(i: number): number {
    return TimeMap.lerp(this.inp, this.out, i);
  }

  /** Copy of the points as two parallel arrays (format for WebAssembly). */
  toArrays(): { readonly output: Float64Array; readonly input: Float64Array } {
    return { output: this.out.slice(), input: this.inp.slice() };
  }

  /** New map with the output axis scaled (used for the transposition). */
  scaleOutput(factor: number): TimeMap {
    return new TimeMap(Array.from(this.out, (o, k) => [o * factor, this.inp[k]] as const));
  }

  private static lerp(A: Float64Array, B: Float64Array, v: number): number {
    if (A.length === 1) return B[0] + (v - A[0]);
    const k = TimeMap.segment(A, v), d = A[k + 1] - A[k];
    return d > 0 ? B[k] + ((v - A[k]) * (B[k + 1] - B[k])) / d : B[k];
  }

  private static segment(arr: Float64Array, v: number): number {
    const n = arr.length;
    if (v <= arr[0]) return 0;
    if (v >= arr[n - 1]) return n - 2;
    let lo = 0, hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid] <= v) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
}
