/** Loop demo deterministico, usato dalla pagina di prova e dai test. */

function lcg(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

/** Loop di batteria stereo con un accordo sotto: cassa, rullante e charleston a `bpm`. */
export function drumLoop(bars = 1, bpm = 120, sr = 44100): Float32Array[] {
  const beat = (60 / bpm) * sr, len = Math.round(beat * 4 * bars);
  const L = new Float32Array(len), R = new Float32Array(len);
  const rnd = lcg(7);
  const add = (start: number, dur: number, gl: number, gr: number, f: (t: number, i: number) => number) => {
    for (let i = 0; i < dur && start + i < len; i++) {
      const v = f(i / sr, i);
      L[start + i] += v * gl;
      R[start + i] += v * gr;
    }
  };
  for (let b = 0; b < 4 * bars; b++) {
    const at = Math.round(b * beat);
    add(at, sr * 0.3, 0.8, 0.8, t => Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-t * 30)) * t) * Math.exp(-t * 9));
    if (b % 2 === 1) add(at, sr * 0.2, 0.5, 0.4, t => (rnd() * 2 - 1) * Math.exp(-t * 18));
    for (const off of [0, 0.5]) {
      add(Math.round(at + off * beat), sr * 0.05, 0.15, 0.25, t => (rnd() * 2 - 1) * Math.exp(-t * 80));
    }
  }
  for (const [f, g] of [[220, 0.08], [277.18, 0.06], [329.63, 0.06]] as const) {
    for (let i = 0; i < len; i++) {
      const v = Math.sin((2 * Math.PI * f * i) / sr) * g;
      L[i] += v;
      R[i] += v * 0.7;
    }
  }
  return [L, R];
}
