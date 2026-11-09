/* Dragging a track to change its place, from the header in the arrangement or from the head
 * of the column in the session. The drag starts after a few pixels, so a click stays a
 * click; Esc cancels it. A line shows where the track will go. */
import { el } from './dom';

/** A place to drop the track and the line showing it (in screen pixels). */
export interface DropSpot<T> {
  readonly drop: T;
  readonly line: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface TrackDragOptions<T> {
  /** The element of the grabbed track, which fades while it's carried. */
  readonly source: HTMLElement;
  /** The place under the pointer (null: it can't be dropped there). */
  spotAt(e: PointerEvent): DropSpot<T> | null;
  drop(target: T): void;
}

/** From a pointerdown on a track: the click stays a click, the drag moves it. */
export function startTrackDrag<T>(down: PointerEvent, o: TrackDragOptions<T>): void {
  let line: HTMLElement | null = null;
  let spot: DropSpot<T> | null = null;
  const move = (e: PointerEvent) => {
    if (!line) {
      if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < 5) return;
      line = el('div', { className: 'track-drop-line' });
      document.body.append(line);
      document.body.classList.add('track-dragging');
      getSelection()?.removeAllRanges();
      o.source.classList.add('dragging');
    }
    spot = o.spotAt(e);
    line.hidden = !spot;
    if (!spot) return;
    const r = spot.line;
    Object.assign(line.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
  const end = (dropped: boolean) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('keydown', key, true);
    if (!line) return;
    line.remove();
    document.body.classList.remove('track-dragging');
    o.source.classList.remove('dragging');
    // the click following the release opens nothing
    const swallow = (e: MouseEvent) => e.stopPropagation();
    window.addEventListener('click', swallow, true);
    setTimeout(() => window.removeEventListener('click', swallow, true));
    if (dropped && spot) o.drop(spot.drop);
  };
  const up = () => end(true);
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !line) return;
    e.preventDefault();
    e.stopPropagation();
    end(false);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('keydown', key, true);
}

/** True if the pointerdown can start a drag: left button, without Shift or Ctrl
 *  (which widen the selection), and not on a header control. */
export const canStartTrackDrag = (e: PointerEvent): boolean =>
  e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey
  && !(e.target as HTMLElement).closest('button, input, select, textarea, .knob, .midi-slot, .level-meter');
