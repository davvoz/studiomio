/* Small helpers shared by the Prisma panel's drawings. */

/** A sharp canvas, resized to its place; null if it has no size yet (hidden). */
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

/** A drag with the pointer captured: `move` receives the offset from the start,
 *  `end` arrives at the end (even if cancelled). */
export function drag(e: PointerEvent, target: HTMLElement, move: (dx: number, dy: number, ev: PointerEvent) => void, end: () => void): void {
  const x0 = e.clientX, y0 = e.clientY;
  target.setPointerCapture(e.pointerId);
  const onMove = (m: PointerEvent) => move(m.clientX - x0, m.clientY - y0, m);
  const onEnd = () => {
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onEnd);
    target.removeEventListener('pointercancel', onEnd);
    end();
  };
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onEnd);
  target.addEventListener('pointercancel', onEnd);
}
