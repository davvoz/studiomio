/** FFT complessa radix-2 in place. Le tabelle (bit reversal, seni e coseni) dipendono
 *  solo dalla dimensione, quindi ogni istanza le calcola una volta e le riusa. */
export class Fft {
  private static readonly cache = new Map<number, Fft>();

  /** Istanza condivisa per una dimensione (potenza di 2). */
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
    if (size < 2 || (size & (size - 1)) !== 0) throw new RangeError(`FFT: ${size} non è una potenza di 2`);
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

  /** Inversa, già normalizzata per 1/n. */
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

/** Dopo la FFT di (x + i·y), con x e y reali, separa gli spettri di x e y (bin 0..n/2). */
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

/** Inverso di splitPair: impacchetta due spettri hermitiani in uno solo, così una IFFT
 *  restituisce x nella parte reale e y in quella immaginaria (y assente = silenzio). */
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
