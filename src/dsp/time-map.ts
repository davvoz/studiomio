/** Coppia di posizioni in campioni: [uscita, ingresso]. */
export type MapPoint = readonly [output: number, input: number];

/** Corrispondenza lineare a tratti tra campioni di uscita e di ingresso, estrapolata
 *  con la pendenza dei segmenti estremi. È la mappa di warp vista dal DSP. */
export class TimeMap {
  private readonly out: Float64Array;
  private readonly inp: Float64Array;

  constructor(points: readonly MapPoint[]) {
    if (points.length === 0) throw new RangeError('TimeMap: serve almeno un punto');
    this.out = Float64Array.from(points, p => p[0]);
    this.inp = Float64Array.from(points, p => p[1]);
  }

  /** Campione di ingresso che suona al campione di uscita `o`. */
  inputAt(o: number): number {
    return TimeMap.lerp(this.out, this.inp, o);
  }

  /** Campione di uscita in cui suona il campione di ingresso `i`. */
  outputAt(i: number): number {
    return TimeMap.lerp(this.inp, this.out, i);
  }

  /** Copia dei punti come due array paralleli (formato per WebAssembly). */
  toArrays(): { readonly output: Float64Array; readonly input: Float64Array } {
    return { output: this.out.slice(), input: this.inp.slice() };
  }

  /** Nuova mappa con l'asse di uscita scalato (usato per la trasposizione). */
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
