/* WarpMio — motore DSP.
 *
 * Tutto il codice sta dentro WarpDSP() perché la funzione viene usata sia nel thread
 * principale sia, serializzata con toString(), dentro un Web Worker creato da Blob
 * (così l'app funziona anche aprendo index.html direttamente da disco).
 * Non deve quindi fare riferimento a nulla di esterno.
 */
function WarpDSP() {
  'use strict';

  // ===================================================================== FFT

  const fftTables = {};

  function tables(n) {
    let t = fftTables[n];
    if (t) return t;
    const bits = Math.round(Math.log2(n));
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
      rev[i] = r;
    }
    const cos = new Float64Array(n >> 1), sin = new Float64Array(n >> 1);
    for (let i = 0; i < n >> 1; i++) {
      cos[i] = Math.cos(2 * Math.PI * i / n);
      sin[i] = Math.sin(2 * Math.PI * i / n);
    }
    t = { rev, cos, sin };
    fftTables[n] = t;
    return t;
  }

  // FFT complessa radix-2 in place.
  function fft(re, im, inverse) {
    const n = re.length, t = tables(n), rev = t.rev, cs = t.cos, sn = t.sin;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let x = re[i]; re[i] = re[j]; re[j] = x;
        x = im[i]; im[i] = im[j]; im[j] = x;
      }
    }
    const sgn = inverse ? 1 : -1;
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
    if (inverse) {
      const s = 1 / n;
      for (let i = 0; i < n; i++) { re[i] *= s; im[i] *= s; }
    }
  }

  // Dopo la FFT di (x + i·y), con x e y reali, separa gli spettri di x e y (bin 0..n/2).
  function splitPair(re, im, xr, xi, yr, yi) {
    const n = re.length, h = n >> 1;
    for (let k = 0; k <= h; k++) {
      const nk = (n - k) & (n - 1);
      xr[k] = 0.5 * (re[k] + re[nk]);
      xi[k] = 0.5 * (im[k] - im[nk]);
      yr[k] = 0.5 * (im[k] + im[nk]);
      yi[k] = -0.5 * (re[k] - re[nk]);
    }
  }

  // Inverso di splitPair: impacchetta due spettri hermitiani in uno solo, così una
  // IFFT restituisce x nella parte reale e y in quella immaginaria.
  function joinPair(xr, xi, yr, yi, re, im) {
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

  // ================================================================= utilità

  function hann(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    return w;
  }

  function mixMono(channels) {
    if (channels.length === 1) return channels[0];
    const n = channels[0].length, m = new Float32Array(n), g = 1 / channels.length;
    for (const c of channels) for (let i = 0; i < n; i++) m[i] += c[i] * g;
    return m;
  }

  function readFrame(x, start, win, dst) {
    const n = win.length, len = x.length;
    if (start >= 0 && start + n <= len) {
      for (let i = 0; i < n; i++) dst[i] = x[start + i] * win[i];
    } else {
      for (let i = 0; i < n; i++) {
        const j = start + i;
        dst[i] = j >= 0 && j < len ? x[j] * win[i] : 0;
      }
    }
  }

  function princarg(p) {
    return p - 2 * Math.PI * Math.round(p / (2 * Math.PI));
  }

  function at(x, i) {
    return i >= 0 && i < x.length ? x[i] : 0;
  }

  // Interpolazione cubica di Hermite.
  function readCubic(x, pos) {
    const i = Math.floor(pos), f = pos - i;
    const xm1 = at(x, i - 1), x0 = at(x, i), x1 = at(x, i + 1), x2 = at(x, i + 2);
    const c1 = 0.5 * (x1 - xm1);
    const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
    const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
    return ((c3 * f + c2) * f + c1) * f + x0;
  }

  // Passa-basso FIR (sinc finestrata Blackman); cutoff in frazione di Nyquist.
  function lowpass(x, cutoff) {
    const half = 16, taps = 2 * half + 1, h = new Float64Array(taps);
    let sum = 0;
    for (let k = 0; k < taps; k++) {
      const m = k - half;
      const s = m === 0 ? cutoff : Math.sin(Math.PI * cutoff * m) / (Math.PI * m);
      const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * k / (taps - 1)) + 0.08 * Math.cos(4 * Math.PI * k / (taps - 1));
      h[k] = s * w;
      sum += h[k];
    }
    for (let k = 0; k < taps; k++) h[k] /= sum;
    const n = x.length, y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      if (i >= half && i < n - half) {
        for (let k = 0; k < taps; k++) acc += h[k] * x[i + k - half];
      } else {
        for (let k = 0; k < taps; k++) acc += h[k] * at(x, i + k - half);
      }
      y[i] = acc;
    }
    return y;
  }

  // Ricampiona leggendo l'ingresso a velocità `factor` (>1 = più acuto e più corto).
  function resample(channels, factor, outLen) {
    return channels.map(x => {
      const src = factor > 1.001 ? lowpass(x, 0.95 / factor) : x;
      const y = new Float32Array(outLen);
      for (let n = 0; n < outLen; n++) y[n] = readCubic(src, n * factor);
      return y;
    });
  }

  // ========================================================== mappa temporale

  // points: [[campioneUscita, campioneIngresso], ...] crescenti. Lineare a tratti,
  // estrapolata con la pendenza dei segmenti estremi.
  function makeMap(points) {
    const n = points.length, O = new Float64Array(n), I = new Float64Array(n);
    for (let k = 0; k < n; k++) { O[k] = points[k][0]; I[k] = points[k][1]; }
    function seg(arr, v) {
      if (v <= arr[0]) return 0;
      if (v >= arr[n - 1]) return n - 2;
      let lo = 0, hi = n - 2;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (arr[mid] <= v) lo = mid; else hi = mid - 1;
      }
      return lo;
    }
    function lerp(A, B, v) {
      if (n === 1) return B[0] + (v - A[0]);
      const k = seg(A, v), d = A[k + 1] - A[k];
      return d > 0 ? B[k] + (v - A[k]) * (B[k + 1] - B[k]) / d : B[k];
    }
    return { o2i: o => lerp(O, I, o), i2o: i => lerp(I, O, i) };
  }

  // ============================================================ algoritmi warp

  // Re-Pitch: lettura a velocità variabile, come un giradischi (cambia l'intonazione).
  function repitchStretch(channels, map, outLen) {
    const pos = new Float64Array(outLen);
    for (let n = 0; n < outLen; n++) pos[n] = map.o2i(n);
    return channels.map(x => {
      const y = new Float32Array(outLen);
      for (let n = 0; n < outLen; n++) y[n] = readCubic(x, pos[n]);
      return y;
    });
  }

  // Cerca, attorno a `target`, l'inizio di frame più simile alla continuazione naturale `nat`.
  function bestMatch(x, nat, target, tol, N, stride) {
    const len = x.length;
    const score = (s, st) => {
      let dot = 0, en = 1e-9;
      for (let i = 0; i < N; i += st) {
        const j = s + i, k = nat + i;
        const c = j >= 0 && j < len ? x[j] : 0;
        const r = k >= 0 && k < len ? x[k] : 0;
        dot += c * r; en += c * c;
      }
      return dot / Math.sqrt(en);
    };
    const step = Math.max(1, stride >> 1);
    let best = target, bestScore = score(target, stride);
    for (let d = -tol; d <= tol; d += step) {
      const s = score(target + d, stride);
      if (s > bestScore) { bestScore = s; best = target + d; }
    }
    const fine = Math.max(1, stride >> 2);
    let refined = best, refScore = score(best, fine);
    for (let d = -step + 1; d < step; d++) {
      if (d === 0) continue;
      const s = score(best + d, fine);
      if (s > refScore) { refScore = s; refined = best + d; }
    }
    return refined;
  }

  // Tones (WSOLA) e Texture (granulare con "flux" casuale).
  function wsolaStretch(channels, sr, map, outLen, opts) {
    let N = Math.round((opts.grainMs || 50) / 1000 * sr);
    N = Math.max(256, Math.min(16384, N));
    N -= N % 2;
    const H = N >> 1, win = hann(N);
    const C = channels.length, mono = mixMono(channels), len = mono.length;
    const search = opts.search !== false;
    const tol = search ? Math.round(N / 4) : 0;
    const jitter = Math.round((opts.flux || 0) * N * 0.5);
    const stride = Math.max(1, Math.round(N / 256));
    const outs = channels.map(() => new Float32Array(outLen));
    const wsum = new Float32Array(outLen);
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let prev = null;
    for (let k = 0; ; k++) {
      const oc = k * H, os = oc - H;
      if (os >= outLen) break;
      const target = Math.round(map.o2i(oc)) - H;
      let start = target;
      if (search && prev !== null) start = bestMatch(mono, prev + H, target, tol, N, stride);
      else if (jitter) start = target + Math.round((rnd() * 2 - 1) * jitter);
      const i0 = Math.max(0, -os), i1 = Math.min(N, outLen - os);
      for (let c = 0; c < C; c++) {
        const x = channels[c], y = outs[c];
        for (let i = i0; i < i1; i++) {
          const j = start + i;
          if (j >= 0 && j < len) y[os + i] += x[j] * win[i];
        }
      }
      for (let i = i0; i < i1; i++) wsum[os + i] += win[i];
      prev = start;
    }
    for (const y of outs) for (let i = 0; i < outLen; i++) if (wsum[i] > 1e-3) y[i] /= wsum[i];
    return outs;
  }

  // Complex: phase vocoder con phase locking (Laroche-Dolson), fase stereo coerente
  // (calcolata sul mid e applicata ai canali) e reset di fase sui transienti.
  function pvStretch(channels, sr, map, outLen, opts) {
    const N = opts.fftSize || 4096, H = N >> 2, h = N >> 1, nb = h + 1;
    const win = hann(N);
    const C = channels.length, mono = mixMono(channels);
    const outs = channels.map(() => new Float32Array(outLen));
    const wsum = new Float32Array(outLen);
    const re = new Float64Array(N), im = new Float64Array(N);
    const mr = new Float64Array(nb), mi = new Float64Array(nb), pr = new Float64Array(nb), pi = new Float64Array(nb);
    const mag = new Float64Array(nb), ph = new Float64Array(nb), syn = new Float64Array(nb);
    const peaks = new Int32Array(nb);
    const ar = new Float64Array(nb), ai = new Float64Array(nb), br = new Float64Array(nb), bi = new Float64Array(nb);
    const omegaH = new Float64Array(nb);
    for (let k = 0; k < nb; k++) omegaH[k] = 2 * Math.PI * k * H / N;
    const trans = opts.transients && opts.transients.length ? opts.transients : null;
    let ti = 0, first = true;

    for (let f = 0; ; f++) {
      const oc = f * H, os = oc - h;
      if (os >= outLen) break;
      const ic = map.o2i(oc), a = Math.round(ic) - h;

      // Mid: frame corrente e frame precedente di H campioni, con una sola FFT.
      readFrame(mono, a, win, re);
      readFrame(mono, a - H, win, im);
      fft(re, im, false);
      splitPair(re, im, mr, mi, pr, pi);
      let maxMag = 0;
      for (let k = 0; k < nb; k++) {
        mag[k] = Math.hypot(mr[k], mi[k]);
        ph[k] = Math.atan2(mi[k], mr[k]);
        if (mag[k] > maxMag) maxMag = mag[k];
      }

      let reset = first;
      if (trans) {
        while (ti < trans.length && trans[ti] <= ic) { if (!first) reset = true; ti++; }
      }

      if (reset) {
        syn.set(ph);
      } else {
        let np = 0;
        const thr = maxMag * 1e-6;
        for (let k = 2; k < nb - 2; k++) {
          const m = mag[k];
          if (m > thr && m > mag[k - 1] && m >= mag[k + 1] && m > mag[k - 2] && m >= mag[k + 2]) peaks[np++] = k;
        }
        if (np === 0) {
          for (let k = 0; k < nb; k++) {
            syn[k] += omegaH[k] + princarg(ph[k] - Math.atan2(pi[k], pr[k]) - omegaH[k]);
          }
        } else {
          for (let j = 0; j < np; j++) {
            const p = peaks[j];
            syn[p] = princarg(syn[p] + omegaH[p] + princarg(ph[p] - Math.atan2(pi[p], pr[p]) - omegaH[p]));
          }
          let start = 0;
          for (let j = 0; j < np; j++) {
            const p = peaks[j];
            let end = nb;
            if (j < np - 1) {
              const q = peaks[j + 1];
              end = p + 1;
              for (let k = p + 1; k < q; k++) if (mag[k] < mag[end]) end = k;
            }
            for (let k = start; k < end; k++) if (k !== p) syn[k] = syn[p] + ph[k] - ph[p];
            start = end;
          }
        }
      }

      // Sintesi dei canali, due per volta con una sola FFT diretta e una inversa.
      for (let c = 0; c < C; c += 2) {
        const two = c + 1 < C;
        readFrame(channels[c], a, win, re);
        if (two) readFrame(channels[c + 1], a, win, im); else im.fill(0);
        fft(re, im, false);
        splitPair(re, im, ar, ai, br, bi);
        for (let q = 0; q < (two ? 2 : 1); q++) {
          const xr = q ? br : ar, xi = q ? bi : ai;
          for (let k = 0; k < nb; k++) {
            const m = Math.hypot(xr[k], xi[k]);
            const phase = C > 1 ? syn[k] + Math.atan2(xi[k], xr[k]) - ph[k] : syn[k];
            xr[k] = m * Math.cos(phase);
            xi[k] = m * Math.sin(phase);
          }
        }
        joinPair(ar, ai, two ? br : null, two ? bi : null, re, im);
        fft(re, im, true);
        const y0 = outs[c], y1 = two ? outs[c + 1] : null;
        const i0 = Math.max(0, -os), i1 = Math.min(N, outLen - os);
        for (let i = i0; i < i1; i++) {
          y0[os + i] += re[i] * win[i];
          if (y1) y1[os + i] += im[i] * win[i];
        }
      }
      const i0 = Math.max(0, -os), i1 = Math.min(N, outLen - os);
      for (let i = i0; i < i1; i++) wsum[os + i] += win[i] * win[i];
      first = false;
    }
    for (const y of outs) for (let i = 0; i < outLen; i++) if (wsum[i] > 1e-3) y[i] /= wsum[i];
    return outs;
  }

  // Beats: ogni fetta (tra transienti o sulla griglia) suona a velocità originale a
  // partire dalla sua nuova posizione; i buchi si riempiono secondo il loop mode.
  function beatsStretch(channels, sr, map, outLen, opts) {
    const len = channels[0].length;
    const loopMode = opts.loopMode || 'off';
    const env = opts.envelope == null ? 100 : opts.envelope;
    const fadeOut = Math.max(8, Math.round(0.004 * sr));
    const fadeIn = Math.max(4, Math.round(0.0007 * sr));
    const outs = channels.map(() => new Float32Array(outLen));
    const pts = [0];
    for (const s of (opts.slices || []).slice().sort((p, q) => p - q)) {
      const v = Math.round(s);
      if (v > pts[pts.length - 1] + 32 && v < len - 32) pts.push(v);
    }
    for (let s = 0; s < pts.length; s++) {
      const inA = pts[s], inB = s + 1 < pts.length ? pts[s + 1] : len;
      const oA = Math.round(map.i2o(inA));
      const oB = s + 1 < pts.length ? Math.round(map.i2o(inB)) : outLen;
      const avail = oB - oA, sl = inB - inA;
      if (avail <= 0 || sl <= 0) continue;
      const loopStart = inA + (sl >> 1), loopLen = inB - loopStart;
      const xf = Math.max(4, Math.min(256, loopLen >> 2));
      const looping = loopMode !== 'off' && loopLen >= 64;
      const envStart = env >= 100 ? Infinity : avail * env / 100;
      const total = avail + fadeOut;
      for (let n = 0; n < total; n++) {
        const o = oA + n;
        if (o < 0) continue;
        if (o >= outLen) break;
        let src, g = 1;
        if (n < sl) {
          src = inA + n;
          if (n >= sl - xf && looping && sl < avail) g = (sl - n) / xf;
          else if (!looping && sl < avail && n >= sl - fadeOut) g = (sl - n) / fadeOut;
        } else if (!looping) {
          break;
        } else if (loopMode === 'forward') {
          const m = (n - sl) % loopLen;
          src = loopStart + m;
          g = Math.min(1, m / xf, (loopLen - m) / xf);
        } else {
          const m = (n - sl) % (2 * loopLen);
          src = m < loopLen ? inB - 1 - m : loopStart + (m - loopLen);
        }
        if (n < fadeIn && s > 0) g *= n / fadeIn;
        if (n > envStart) g *= Math.max(0, 1 - (n - envStart) / (avail - envStart + 1));
        if (n >= avail) g *= 1 - (n - avail) / fadeOut;
        if (g <= 0) continue;
        for (let c = 0; c < channels.length; c++) outs[c][o] += channels[c][src] * g;
      }
    }
    return outs;
  }

  function pvSize(sr, base) {
    let n = base || 4096;
    if (sr > 60000) n *= 2;
    return n;
  }

  /* job = {
   *   mode: 'beats' | 'tones' | 'texture' | 'complex' | 'repitch',
   *   points: [[uscita, ingresso], ...] in campioni, outLen: campioni in uscita,
   *   transpose: semitoni, transients: [campioni], opts: {...}
   * } */
  function render(channels, sr, job) {
    const st = job.mode === 'repitch' ? 0 : (job.transpose || 0);
    const p = Math.pow(2, st / 12);
    const map = makeMap(job.points.map(q => [q[0] * p, q[1]]));
    const L = Math.max(1, Math.round(job.outLen * p));
    const o = job.opts || {};
    let out;
    switch (job.mode) {
      case 'repitch':
        out = repitchStretch(channels, map, L);
        break;
      case 'beats':
        out = beatsStretch(channels, sr, map, L, o);
        break;
      case 'tones':
        out = wsolaStretch(channels, sr, map, L, { grainMs: o.grainMs, search: true });
        break;
      case 'texture':
        out = wsolaStretch(channels, sr, map, L, { grainMs: o.grainMs, search: false, flux: o.flux });
        break;
      default:
        out = pvStretch(channels, sr, map, L, {
          fftSize: pvSize(sr, o.pvFft),
          transients: o.pvTransients ? job.transients : null,
        });
    }
    if (Math.abs(p - 1) > 1e-6) out = resample(out, p, job.outLen);
    return out;
  }

  // ================================================================== analisi

  // Spectral flux su magnitudo log-compressa: curva di "novità" per transienti e tempo.
  function onsetEnvelope(mono, sr) {
    const N = sr > 60000 ? 2048 : 1024, hop = N >> 2, nb = (N >> 1) + 1;
    const win = hann(N);
    const frames = Math.floor(mono.length / hop) + 1;
    const flux = new Float32Array(frames);
    const re = new Float64Array(N), im = new Float64Array(N);
    const ar = new Float64Array(nb), ai = new Float64Array(nb), br = new Float64Array(nb), bi = new Float64Array(nb);
    let prev = new Float64Array(nb), cur = new Float64Array(nb);
    const maxBin = Math.min(nb, Math.round(16000 / sr * N));
    const norm = 4 / N;
    // Bande logaritmiche: una cassa (pochi bin bassi) pesa quanto un piatto (centinaia di bin).
    const nBands = 12, band = new Int32Array(maxBin), bandW = new Float64Array(nBands);
    for (let k = 1; k < maxBin; k++) {
      band[k] = Math.min(nBands - 1, Math.floor(nBands * Math.log(k) / Math.log(maxBin)));
      bandW[band[k]]++;
    }
    const acc = new Float64Array(nBands);
    const step = (xr, xi, f) => {
      acc.fill(0);
      for (let k = 1; k < maxBin; k++) {
        const v = Math.log1p(100 * norm * Math.hypot(xr[k], xi[k]));
        cur[k] = v;
        const d = v - prev[k];
        if (d > 0) acc[band[k]] += d;
      }
      let s = 0;
      for (let b = 0; b < nBands; b++) if (bandW[b]) s += acc[b] / Math.sqrt(bandW[b]);
      flux[f] = f === 0 ? 0 : s;
      const t = prev; prev = cur; cur = t;
    };
    for (let f = 0; f < frames; f += 2) {
      readFrame(mono, f * hop - (N >> 1), win, re);
      readFrame(mono, (f + 1) * hop - (N >> 1), win, im);
      fft(re, im, false);
      splitPair(re, im, ar, ai, br, bi);
      step(ar, ai, f);
      if (f + 1 < frames) step(br, bi, f + 1);
    }
    return { flux, hop, frameRate: sr / hop };
  }

  // Porta la posizione del transiente all'inizio reale dell'attacco.
  function refineOnset(x, center, hop) {
    const B = 32, len = x.length;
    const lo = Math.max(0, center - 3 * hop), hi = Math.min(len, center + 2 * hop);
    const nB = Math.floor((hi - lo) / B);
    if (nB < 4) return center;
    const env = new Float32Array(nB);
    for (let j = 0; j < nB; j++) {
      let m = 0;
      for (let i = lo + j * B, e = i + B; i < e; i++) { const v = Math.abs(x[i]); if (v > m) m = v; }
      env[j] = m;
    }
    let jb = 1, best = -Infinity;
    for (let j = 1; j < nB; j++) {
      const r = env[j] - Math.max(env[j - 1], j > 1 ? env[j - 2] : 0);
      if (r > best) { best = r; jb = j; }
    }
    const peak = env[jb];
    let j = jb, steps = 0;
    while (j > 0 && steps < 6 && env[j - 1] < env[j] && env[j - 1] > 0.12 * peak) { j--; steps++; }
    return lo + j * B;
  }

  // sensitivity 0..1. Restituisce posizioni in campioni.
  function detectTransients(mono, envl, sensitivity) {
    const { flux, hop, frameRate } = envl;
    const n = flux.length;
    let max = 0;
    for (let i = 0; i < n; i++) if (flux[i] > max) max = flux[i];
    if (max <= 0) return [];
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = flux[i] / max;
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + f[i];
    const w = Math.max(2, Math.round(0.1 * frameRate));
    const sens = Math.max(0, Math.min(1, sensitivity));
    const delta = 0.02 + (1 - sens) * 0.3;
    const mult = 1.1 + (1 - sens) * 0.9;
    const minGap = Math.round(0.035 * frameRate);
    const peaks = [];
    for (let i = 1; i < n - 1; i++) {
      const v = f[i];
      if (v < delta) continue;
      let isMax = true;
      for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) {
        if (j < i ? f[j] >= v : f[j] > v) { isMax = false; break; }
      }
      if (!isMax) continue;
      const a = Math.max(0, i - w), b = Math.min(n, i + w + 1);
      const mean = (pre[b] - pre[a]) / (b - a);
      if (v < mean * mult + delta * 0.5) continue;
      const last = peaks[peaks.length - 1];
      if (last && i - last.i < minGap) {
        if (v > last.v) { last.i = i; last.v = v; }
        continue;
      }
      peaks.push({ i, v });
    }
    const out = [];
    for (const p of peaks) {
      const pos = refineOnset(mono, p.i * hop, hop);
      if (!out.length || pos - out[out.length - 1] > hop) out.push(pos);
    }
    return out;
  }

  function autocorr(f, lag) {
    let s = 0;
    const n = f.length - lag;
    for (let i = 0; i < n; i++) s += f[i] * f[i + lag];
    return n > 0 ? s / n : 0;
  }

  // Stima del tempo: autocorrelazione dell'onset con preferenza attorno ai 120 BPM e,
  // per i loop, aggancio a una durata di battute intere.
  function estimateTempo(envl, durationSec) {
    const { flux, frameRate } = envl;
    const n = flux.length;
    if (n < 16) return 120;
    const win = Math.max(1, Math.round(0.4 * frameRate));
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + flux[i];
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - win), b = Math.min(n, i + win + 1);
      f[i] = Math.max(0, flux[i] - (pre[b] - pre[a]) / (b - a));
    }
    const lMin = Math.max(2, Math.floor(frameRate * 60 / 220));
    const lMax = Math.min(n - 2, Math.ceil(frameRate * 60 / 50));
    const ac = new Float64Array(lMax * 4 + 3);
    for (let L = lMin - 1; L <= Math.min(lMax * 4 + 2, n - 2); L++) ac[L] = autocorr(f, L);
    let bestL = 0, best = -Infinity;
    for (let L = lMin; L <= lMax; L++) {
      const bpm = 60 * frameRate / L;
      const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
      const s = (ac[L] + 0.5 * (ac[2 * L] || 0) + 0.25 * (ac[4 * L] || 0)) * w;
      if (s > best) { best = s; bestL = L; }
    }
    if (!bestL) return 120;
    let L = bestL;
    const y0 = ac[bestL - 1], y1 = ac[bestL], y2 = ac[bestL + 1];
    const den = y0 - 2 * y1 + y2;
    if (den < 0) L = bestL + 0.5 * (y0 - y2) / den;
    let bpm = 60 * frameRate / L;
    while (bpm < 80) bpm *= 2;
    while (bpm >= 160) bpm /= 2;
    if (durationSec > 0.5 && durationSec <= 60) {
      let snap = null, err = 0.04;
      for (const bars of [1, 2, 3, 4, 6, 8, 12, 16, 24, 32]) {
        for (const beats of [bars * 4]) {
          const c = beats * 60 / durationSec;
          if (c < 60 || c > 200) continue;
          for (const mult of [0.5, 1, 2]) {
            const e = Math.abs(c / (bpm * mult) - 1);
            if (e < err) { err = e; snap = c; }
          }
        }
      }
      if (snap) {
        bpm = snap;
        while (bpm < 80) bpm *= 2;
        while (bpm >= 160) bpm /= 2;
      }
    }
    return Math.round(bpm * 100) / 100;
  }

  // Beat tracking con programmazione dinamica (Ellis 2007). Restituisce campioni.
  function trackBeats(envl, bpm) {
    const { flux, hop, frameRate } = envl;
    const n = flux.length;
    const period = frameRate * 60 / bpm;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += flux[i];
    mean /= n;
    let sd = 0;
    for (let i = 0; i < n; i++) sd += (flux[i] - mean) ** 2;
    sd = Math.sqrt(sd / n) || 1;
    const o = new Float64Array(n);
    for (let i = 0; i < n; i++) o[i] = flux[i] / sd;
    const score = new Float64Array(n), back = new Int32Array(n).fill(-1);
    const tight = 100;
    const lo = Math.round(period / 2), hi = Math.round(2 * period);
    for (let i = 0; i < n; i++) {
      let best = -Infinity, bi = -1;
      for (let j = i - hi; j <= i - lo; j++) {
        if (j < 0) continue;
        const r = Math.log((i - j) / period);
        const v = score[j] - tight * r * r;
        if (v > best) { best = v; bi = j; }
      }
      score[i] = o[i] + (bi >= 0 ? Math.max(0, best) : 0);
      back[i] = bi >= 0 && best > 0 ? bi : -1;
    }
    let end = n - 1, bestEnd = -Infinity;
    for (let i = Math.max(0, n - Math.round(period)); i < n; i++) {
      if (score[i] > bestEnd) { bestEnd = score[i]; end = i; }
    }
    const beats = [];
    for (let i = end; i >= 0; i = back[i]) beats.push(i * hop);
    return beats.reverse();
  }

  // ================================================================ file WAV

  function encodeWav(channels, sr, bits) {
    const C = channels.length, n = channels[0].length;
    const float = bits === 32, bps = bits / 8;
    const dataLen = n * C * bps;
    const buf = new ArrayBuffer(44 + dataLen), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, float ? 3 : 1, true); v.setUint16(22, C, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * C * bps, true);
    v.setUint16(32, C * bps, true); v.setUint16(34, bits, true);
    str(36, 'data'); v.setUint32(40, dataLen, true);
    let o = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < C; c++) {
        const s = Math.max(-1, Math.min(1, channels[c][i]));
        if (float) { v.setFloat32(o, channels[c][i], true); o += 4; }
        else if (bits === 16) { v.setInt16(o, Math.round(s < 0 ? s * 32768 : s * 32767), true); o += 2; }
        else {
          const x = Math.round(s < 0 ? s * 8388608 : s * 8388607);
          v.setUint8(o, x & 255); v.setUint8(o + 1, (x >> 8) & 255); v.setUint8(o + 2, (x >> 16) & 255);
          o += 3;
        }
      }
    }
    return buf;
  }

  // ===================================================== ZIP (senza compressione)

  let crcTable = null;
  function crc32(u8) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[i] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // files: [{name, data: Uint8Array}] → Uint8Array del file .zip
  function makeZip(files) {
    const enc = new TextEncoder();
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, time, true);
      ch.setUint16(14, date, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true);
      ch.setUint32(24, size, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    }
    let cdSize = 0;
    for (const c of central) cdSize += c.length;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    let total = 0;
    for (const p of all) total += p.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of all) { out.set(p, o); o += p.length; }
    return out;
  }

  return {
    render, resample, mixMono, makeMap,
    onsetEnvelope, detectTransients, estimateTempo, trackBeats,
    encodeWav, makeZip, crc32,
  };
}
