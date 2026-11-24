/* The pointer in the views: where it is inside an element, when a press becomes a drag, a drag with the
 * pointer captured, where a menu opened from a button goes. */

/** A pointer in an element's coordinates, with the modifier keys the gestures read. */
export interface Pointer {
  readonly x: number;
  readonly y: number;
  readonly shift: boolean;
  /** Alt: no snapping to the grid. */
  readonly alt: boolean;
  /** Ctrl/Cmd: copy instead of move. */
  readonly ctrl: boolean;
}

interface ClientPoint {
  readonly clientX: number;
  readonly clientY: number;
}

/** Where the event is inside `el`, in CSS pixels from its top left corner. */
export function localPoint(e: ClientPoint, el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/** The event as a gesture's pointer, inside `el`. */
export function pointerIn(e: MouseEvent, el: Element): Pointer {
  const { x, y } = localPoint(e, el);
  return { x, y, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey };
}

/** Below this distance (in pixels, across plus down) a press is still a click. */
export const CLICK_PX = 3;

/** The pointer went far enough from `b` to be a drag. */
export const moved = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) >= CLICK_PX;

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

/** Where a menu opened from `el` goes: under it, aligned to its left edge. */
export function below(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 2 };
}
