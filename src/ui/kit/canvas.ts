/* Sharp canvases even on high-density screens, and the colours the device displays share. */

/** A canvas with a size given from outside (`resize`), drawn in CSS pixels. */
export class Surface {
  readonly canvas = document.createElement('canvas');
  readonly g = this.canvas.getContext('2d')!;
  width = 0;
  height = 0;

  constructor(className: string) {
    this.canvas.className = className;
  }

  resize(w: number, h: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.width = w;
    this.height = h;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

/** A canvas sized by its place in the page: resized to it and ready to draw in CSS pixels; null if
 *  it has no size yet (hidden). */
export function fit(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return null;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) Object.assign(c, { width: Math.round(w * dpr), height: Math.round(h * dpr) });
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

export const ACCENT = '#ff9d2e';
export const BACKGROUND = '#15181c';
export const GRID = 'rgba(255,255,255,0.06)';
export const LABEL = 'rgba(255,255,255,0.5)';
