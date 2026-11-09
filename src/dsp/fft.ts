/** In-place radix-2 complex FFT. The tables (bit reversal, sines and cosines) depend
 *  only on the size, so each instance computes them once and reuses them. */
export class Fft {
  private static readonly cache = new Map<number, Fft>();

  /** Shared instance for a size (power of 2). */
  static of(size: number): Fft {
    let f = Fft.cache.get(size);
    if (!f) {
      f = new Fft(size);
      Fft.cache.set(size, f);
    }
    return f;
  }

  readonly size: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  private constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new RangeError(`FFT: ${size} is not a power of 2`);
    this.size = size;
    const bits = Math.round(Math.log2(size));
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
      this.rev[i] = r;
    }
    const half = size >> 1;
    this.cos = new Float64Array(half);
    this.sin = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((2 * Math.PI * i) / size);
    }
  }

  forward(re: Float64Array, im: Float64Array): void {
    this.transform(re, im, -1);
  }

  /** Inverse, already normalized by 1/n. */
  inverse(re: Float64Array, im: Float64Array): void {
    this.transform(re, im, 1);
    const s = 1 / this.size;
    for (let i = 0; i < this.size; i++) {
      re[i] *= s;
      im[i] *= s;
    }
  }

  private transform(re: Float64Array, im: Float64Array, sgn: 1 | -1): void {
    const n = this.size, rev = this.rev, cs = this.cos, sn = this.sin;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let x = re[i]; re[i] = re[j]; re[j] = x;
        x = im[i]; im[i] = im[j]; im[j] = x;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const wr = cs[k], wi = sgn * sn[k];
        for (let a = j; a < n; a += size) {
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }
}

/** After the FFT of (x + i·y), with x and y real, separates the spectra of x and y (bins 0..n/2). */
export function splitPair(
  re: Float64Array, im: Float64Array,
  xr: Float64Array, xi: Float64Array, yr: Float64Array, yi: Float64Array,
): void {
  const n = re.length, h = n >> 1;
  for (let k = 0; k <= h; k++) {
    const nk = (n - k) & (n - 1);
    xr[k] = 0.5 * (re[k] + re[nk]);
    xi[k] = 0.5 * (im[k] - im[nk]);
    yr[k] = 0.5 * (im[k] + im[nk]);
    yi[k] = -0.5 * (re[k] - re[nk]);
  }
}

/** Inverse of splitPair: packs two Hermitian spectra into one, so an IFFT
 *  returns x in the real part and y in the imaginary one (y absent = silence). */
export function joinPair(
  xr: Float64Array, xi: Float64Array, yr: Float64Array | null, yi: Float64Array | null,
  re: Float64Array, im: Float64Array,
): void {
  const n = re.length, h = n >> 1;
  for (let k = 0; k <= h; k++) {
    const Yr = yr ? yr[k] : 0, Yi = yi ? yi[k] : 0;
    if (k === 0 || k === h) {
      re[k] = xr[k]; im[k] = Yr;
    } else {
      re[k] = xr[k] - Yi; im[k] = xi[k] + Yr;
      re[n - k] = xr[k] + Yi; im[n - k] = -xi[k] + Yr;
    }
  }
}
