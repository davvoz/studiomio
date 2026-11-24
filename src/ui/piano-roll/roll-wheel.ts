/* The wheel on the piano roll, without the DOM: it scrolls the rows (Shift: the time); with Ctrl it zooms,
 * the time on the grid and the rows on the piano keys; with Ctrl+Shift or Alt it zooms the rows also from the grid. */
import type { BeatAxis } from '../clip-editor/clip-geometry';
import { WHEEL_ZOOM, wheelStep, wheelZoom, type WheelInput } from '../kit/wheel';
import type { PitchAxis } from './pitch-axis';

/** Where the turn happens. */
export interface RollWheelAt {
  readonly axis: BeatAxis;
  readonly pitches: PitchAxis;
  /** The pointer over the grid (the zooms' anchors). */
  readonly x: number;
  readonly y: number;
  /** Height of the notes' area (the rows' scrolling stops there). */
  readonly notesHeight: number;
  /** The turn is on the piano keys. */
  readonly keys: boolean;
}

/** What a turn changes: the time or the rows. */
export type RollWheelMove = { readonly axis: BeatAxis } | { readonly pitches: PitchAxis };

/** Shift+wheel: Chromium on Windows already delivers it as deltaX (with deltaY at 0). */
export function rollWheel(w: WheelInput, at: RollWheelAt): RollWheelMove {
  const { axis: a, pitches: pa } = at;
  if (w.alt || (w.ctrl && (at.keys || w.shift))) return { pitches: pa.zoomed(wheelZoom(pa.rowHeight, w.deltaY || w.deltaX, WHEEL_ZOOM.rows), at.y, at.notesHeight) };
  if (w.ctrl) return { axis: a.zoomed(wheelZoom(a.pxPerBeat, w.deltaY), at.x) };
  if (w.shift || Math.abs(w.deltaX) > Math.abs(w.deltaY)) return { axis: a.scrolled(a.startBeat + wheelStep(w) / a.pxPerBeat) };
  return { pitches: pa.scrolled(pa.scrollY + w.deltaY, at.notesHeight) };
}
