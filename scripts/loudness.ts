/* La loudness di un mix secondo ITU-R BS.1770-4 / EBU R128: pesatura K (scaffale + passa-alto
 * RLB, coefficienti ricalcolati per la frequenza di campionamento), blocchi da 400 ms con
 * gating assoluto (−70 LUFS) e relativo (−10 LU) per l'integrata, finestre da 3 s per la
 * short-term, e il true peak misurato su una copia sovracampionata 4× (lo stesso Oversampler
 * del Limiter). */
import { Oversampler } from '../src/devices/dsp/oversampler';

interface Biquad { b: readonly number[]; a: readonly number[] }

function kWeighting(sampleRate: number): Biquad[] {
  let f0 = 1681.974450955533, Q = 0.7071752369554196;
  const G = 3.999843853973347;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const highPass = { b: [1, -2, 1], a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, highPass];
}

function filter(x: Float32Array, { b, a }: Biquad): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

export interface Loudness {
  /** LUFS integrati (con il gating). */
  readonly integrated: number;
  /** La short-term (3 s) più alta. */
  readonly shortTermMax: number;
  /** dBTP. */
  readonly truePeak: number;
}

const lufs = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare + 1e-20);

export function measureLoudness(left: Float32Array, right: Float32Array, sampleRate: number): Loudness {
  // potenza pesata K dei due canali, sommata
  const [shelf, hp] = kWeighting(sampleRate);
  const l = filter(Float32Array.from(filter(left, shelf)), hp), r = filter(Float32Array.from(filter(right, shelf)), hp);
  const cum = new Float64Array(l.length + 1);
  for (let i = 0; i < l.length; i++) cum[i + 1] = cum[i] + l[i] * l[i] + r[i] * r[i];
  const blocks = (seconds: number, hop: number) => {
    const n = Math.round(seconds * sampleRate), h = Math.round(hop * sampleRate), out: number[] = [];
    for (let s = 0; s + n <= l.length; s += h) out.push((cum[s + n] - cum[s]) / n);
    return out;
  };
  const gated = blocks(0.4, 0.1).filter(ms => lufs(ms) > -70);
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  const relative = lufs(mean(gated)) - 10;
  const integrated = lufs(mean(gated.filter(ms => lufs(ms) > relative)));
  const shortTermMax = Math.max(...blocks(3, 0.5).map(lufs));
  let peak = 0;
  for (const ch of [left, right]) {
    const os = new Oversampler(4, 4096);
    for (let s = 0; s < ch.length; s += 4096) {
      const n = Math.min(4096, ch.length - s), up = os.up(ch.subarray(s, s + n), n);
      for (let i = 0; i < n * 4; i++) peak = Math.max(peak, Math.abs(up[i]));
    }
  }
  return { integrated, shortTermMax, truePeak: 20 * Math.log10(peak + 1e-12) };
}
