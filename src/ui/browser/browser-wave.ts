/* The preview's waveform: for each column the lowest and highest sample, as a bar around the middle. */

/** The lowest and highest sample of [from, to) (and 0): each column looks at 64 samples at most,
 *  so a long file is drawn right away anyway. */
export function columnPeaks(channels: readonly Float32Array[], from: number, to: number): [number, number] {
  let lo = 0, hi = 0;
  const step = Math.max(1, Math.floor((to - from) / 64));
  for (const ch of channels) {
    for (let i = from; i < to; i += step) {
      const v = ch[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return [lo, hi];
}

/** Clears `g` (w × h) and draws the channels' waveform in `color` (no audio: only cleared). */
export function paintWave(g: CanvasRenderingContext2D, w: number, h: number, channels: readonly Float32Array[], color: () => string): void {
  g.clearRect(0, 0, w, h);
  const n = channels[0]?.length ?? 0;
  if (!n) return;
  g.fillStyle = color();
  const per = n / w, mid = h / 2;
  for (let x = 0; x < w; x++) {
    const from = Math.floor(x * per), to = Math.min(n, Math.max(from + 1, Math.floor((x + 1) * per)));
    const [lo, hi] = columnPeaks(channels, from, to);
    g.fillRect(x, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid));
  }
}
