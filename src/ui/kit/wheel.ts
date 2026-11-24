/* The mouse wheel, as the views read it: a turn zooms (with Ctrl) or scrolls the time. */
import type { Beats } from '../../core/music-time';

/** A wheel turn: the deltas and the modifiers (Ctrl also stands for ⌘). */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

/** How fast a turn zooms: the time, the piano roll's rows. */
export const WHEEL_ZOOM = { time: 0.0025, rows: 0.002 } as const;

export const wheelInput = (e: WheelEvent): WheelInput =>
  ({ deltaX: e.deltaX, deltaY: e.deltaY, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey });

/** The view takes the turn (the page doesn't scroll): what it says. */
export function takeWheel(e: WheelEvent): WheelInput {
  e.preventDefault();
  return wheelInput(e);
}

/** A size (pixels per beat, a row's height) zoomed by a turn of `delta`: up enlarges. */
export const wheelZoom = (size: number, delta: number, rate: number = WHEEL_ZOOM.time): number => size * Math.exp(-delta * rate);

/** How far a turn scrolls the time: sideways if it has a sideways part, otherwise the vertical one. */
export const wheelStep = (w: WheelInput): number => w.deltaX || w.deltaY;

/** A beat axis (the editors' and the lanes'). */
export interface WheelAxis<A> {
  readonly startBeat: Beats;
  readonly pxPerBeat: number;
  zoomed(pxPerBeat: number, anchorX: number): A;
  scrolled(startBeat: Beats): A;
}

/** The wheel on a beat axis: Ctrl zooms the time around `x`, otherwise it scrolls it. */
export function wheelBeats<A>(axis: WheelAxis<A>, w: WheelInput, x: number): A {
  if (w.ctrl) return axis.zoomed(wheelZoom(axis.pxPerBeat, w.deltaY), x);
  return axis.scrolled(axis.startBeat + wheelStep(w) / axis.pxPerBeat);
}
