/* The frame shared by the clip editors (audio and piano roll): beat axis, ruler
 * with loop and flags, grid, and the gestures changing them. Each editor adds its
 * content to it (waveform, notes). */
import type { Beats, TimeSignature } from '../../core/music-time';
import type { Clip } from '../../model/clip';
import { dragLoop, LOOP_CURSOR, loopPartAt, type BeatRange, type LoopPart } from '../loop-drag';
import type { Pointer } from '../timeline/gestures';
import { snapTo } from '../timeline/geometry';
import { COLORS } from '../timeline/painters';
import { withLoopSafe, withRegionSafe, type BeatAxis } from './clip-geometry';

/** Ruler bands, from the top. */
export const FRAME = { loopBand: 10, ruler: 28 } as const;

/** What the frame's gestures use of the editor. */
export interface ClipHost<C extends Clip> {
  readonly axis: BeatAxis;
  /** Snap step for this pointer, or null if snapping is off. */
  snapStep(p: Pointer): Beats | null;
  /** Applies a change to the clip (one undo step). */
  commit(label: string, fn: (c: C) => C): void;
  /** Moves the timeline cursor to where the clip plays beat `content`. */
  seekContent(content: Beats): void;
  setAxis(axis: BeatAxis): void;
  invalidate(): void;
}

/** A drag in an editor: `preview` shows the clip as it would be on release. */
export interface ClipGesture<C extends Clip> {
  readonly cursor: string;
  move(p: Pointer): void;
  end(p: Pointer): void;
  cancel(): void;
  preview(clip: C): C;
}

export type FrameHit =
  | { readonly kind: 'loop'; readonly part: LoopPart }
  | { readonly kind: 'flag'; readonly edge: 'start' | 'end' }
  | { readonly kind: 'ruler' };

const FLAG_PX = 8, CLICK_PX = 3;
/** Length of the ruler's ticks per level (bar, beat, half, the rest). */
const TICK_PX = [18, 8, 5, 3];

/** What's under the pointer in the ruler, or null if the pointer is lower. */
export function frameHit(axis: BeatAxis, clip: Clip, x: number, y: number): FrameHit | null {
  if (y < FRAME.loopBand) return { kind: 'loop', part: loopPartAt(clip.loop, x, b => axis.beatToX(b)) };
  if (y >= FRAME.ruler) return null;
  const xs = axis.beatToX(clip.region.start), xe = axis.beatToX(clip.region.end);
  if (Math.abs(xs - x) < FLAG_PX && x >= xs - 2) return { kind: 'flag', edge: 'start' };
  if (Math.abs(xe - x) < FLAG_PX) return { kind: 'flag', edge: 'end' };
  return { kind: 'ruler' };
}

export const moved = (a: Pointer, b: Pointer): boolean => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) >= CLICK_PX;

export const snappedBeat = <C extends Clip>(host: ClipHost<C>, p: Pointer, b: Beats): Beats => {
  const s = host.snapStep(p);
  return s ? snapTo(b, s) : b;
};

/** Dragging the clip's start or end flag. */
export class FlagGesture<C extends Clip> implements ClipGesture<C> {
  readonly cursor = 'ew-resize';
  private beat: Beats | null = null;

  constructor(private readonly host: ClipHost<C>, private readonly edge: 'start' | 'end') {}

  move(p: Pointer): void {
    this.beat = snappedBeat(this.host, p, this.host.axis.xToBeat(p.x));
    this.host.invalidate();
  }

  end(): void {
    if (this.beat === null) return;
    this.host.commit(this.edge === 'start' ? 'Clip start' : 'Clip end', c => this.apply(c));
  }

  cancel(): void {
    this.beat = null;
    this.host.invalidate();
  }

  preview(clip: C): C {
    return this.beat === null ? clip : this.apply(clip);
  }

  private apply(c: C): C {
    const b = this.beat!;
    return this.edge === 'start' ? withRegionSafe(c, b, c.region.end) : withRegionSafe(c, c.region.start, b);
  }
}

/** The clip's loop band: edges, body and outside as on the timeline's ruler; a click turns it on or off. */
export class LoopBandGesture<C extends Clip> implements ClipGesture<C> {
  readonly cursor: string;
  private dragged = false;
  private range: BeatRange | null = null;
  private readonly anchor: Beats;

  constructor(private readonly host: ClipHost<C>, private readonly original: BeatRange, private readonly part: LoopPart, private readonly origin: Pointer) {
    this.anchor = snappedBeat(host, origin, host.axis.xToBeat(origin.x));
    this.cursor = part === 'body' ? 'grabbing' : LOOP_CURSOR[part];
  }

  move(p: Pointer): void {
    if (!this.dragged && !moved(p, this.origin)) return;
    this.dragged = true;
    this.range = dragLoop(this.part, this.original, this.anchor, snappedBeat(this.host, p, this.host.axis.xToBeat(p.x))) ?? this.range;
    this.host.invalidate();
  }

  end(): void {
    const r = this.range;
    if (!this.dragged) return this.host.commit('Clip loop', c => withLoopSafe(c, c.loop.start, c.loop.end, !c.loop.enabled));
    if (r) this.host.commit('Clip loop', c => withLoopSafe(c, r.start, r.end));
  }

  cancel(): void {
    this.range = null;
    this.host.invalidate();
  }

  preview(clip: C): C {
    const r = this.range;
    return r ? withLoopSafe(clip, r.start, r.end) : clip;
  }
}

/** Dragging moves the view. On the ruler (`seekOnClick`) a click brings the timeline cursor
 *  there; elsewhere a click does nothing, so as not to interrupt playback. */
export class PanGesture<C extends Clip> implements ClipGesture<C> {
  readonly cursor = 'grabbing';
  private dragged = false;
  private readonly start: BeatAxis;

  constructor(private readonly host: ClipHost<C>, private readonly origin: Pointer, private readonly seekOnClick = false) {
    this.start = host.axis;
  }

  move(p: Pointer): void {
    if (!this.dragged && !moved(p, this.origin)) return;
    this.dragged = true;
    this.host.setAxis(this.start.scrolled(this.start.startBeat - (p.x - this.origin.x) / this.start.pxPerBeat));
  }

  end(p: Pointer): void {
    if (!this.dragged && this.seekOnClick) this.host.seekContent(this.host.axis.xToBeat(p.x));
  }

  cancel(): void { /* niente */ }

  preview(clip: C): C {
    return clip;
  }
}

/** No effect. */
export class IdleGesture<C extends Clip> implements ClipGesture<C> {
  readonly cursor = 'default';
  move(): void { /* niente */ }
  end(): void { /* niente */ }
  cancel(): void { /* niente */ }
  preview(clip: C): C {
    return clip;
  }
}

/** The gesture starting by pressing on each part of the ruler. */
export const frameGestureFor: { readonly [K in FrameHit['kind']]: <C extends Clip>(host: ClipHost<C>, clip: C, hit: Extract<FrameHit, { kind: K }>, p: Pointer) => ClipGesture<C> } = {
  loop: (h, c, hit, p) => new LoopBandGesture(h, c.loop, hit.part, p),
  flag: (h, _c, hit) => new FlagGesture(h, hit.edge),
  ruler: (h, _c, _hit, p) => new PanGesture(h, p, true),
};

export const frameCursor: { readonly [K in FrameHit['kind']]: (hit: Extract<FrameHit, { kind: K }>) => string } = {
  loop: hit => LOOP_CURSOR[hit.part],
  flag: () => 'ew-resize',
  ruler: () => 'pointer',
};

// ------------------------------------------------------------------ drawing

/** Intensity of the grid lines, as in Live: bar, beat (the quarter), half
 *  beat, finer subdivisions. */
const GRID_LINE = ['rgba(255,255,255,0.24)', 'rgba(255,255,255,0.13)', 'rgba(255,255,255,0.075)', 'rgba(255,255,255,0.04)'];
/** The alternating bands, every other one. */
const GRID_BAND = 'rgba(255,255,255,0.045)';

/** Level of beat `b` in the grid: 0 bar, 1 beat, 2 half beat, 3 the rest. */
export function beatLevel(b: Beats, beatsPerBar: number): 0 | 1 | 2 | 3 {
  const on = (step: number) => Math.abs(b / step - Math.round(b / step)) < 1e-6;
  if (on(beatsPerBar)) return 0;
  if (on(1)) return 1;
  return on(0.5) ? 2 : 3;
}

/** Width of the alternating bands for a grid of step `grid`: the beat as long as the
 *  grid divides it, then the bar, then groups of 4 bars. */
export function gridBand(grid: Beats, beatsPerBar: number): Beats {
  const bands = [1, beatsPerBar, 4 * beatsPerBar, 16 * beatsPerBar, 64 * beatsPerBar];
  return bands.find(s => s >= 2 * grid - 1e-9) ?? bands[bands.length - 1];
}

/** Vertical grid from `top` down, as in Live: alternating bands (the beats, or the bars
 *  from afar) and stronger lines for bars, beats and half beats. */
export function paintBeatGrid(
  g: CanvasRenderingContext2D, axis: BeatAxis, width: number, top: number, height: number, grid: Beats, signature: TimeSignature,
): void {
  const bar = signature.beatsPerBar, band = gridBand(grid, bar);
  g.fillStyle = GRID_BAND;
  for (let i = Math.floor(axis.xToBeat(0) / band); axis.beatToX(i * band) < width; i++) {
    if (i % 2 === 0) continue;
    const x0 = Math.round(axis.beatToX(i * band)), x1 = Math.round(axis.beatToX((i + 1) * band));
    g.fillRect(x0, top, x1 - x0, height - top);
  }
  for (let i = Math.floor(axis.xToBeat(0) / grid); axis.beatToX(i * grid) < width; i++) {
    g.fillStyle = GRID_LINE[beatLevel(i * grid, bar)];
    g.fillRect(Math.round(axis.beatToX(i * grid)), top, 1, height - top);
  }
}

/** Ruler: the clip's loop, bar numbers, start and end flags. */
export function paintClipRuler(g: CanvasRenderingContext2D, axis: BeatAxis, width: number, clip: Clip, signature: TimeSignature): void {
  g.fillStyle = COLORS.ruler;
  g.fillRect(0, 0, width, FRAME.ruler);
  const lx0 = axis.beatToX(clip.loop.start), lx1 = axis.beatToX(clip.loop.end);
  g.fillStyle = clip.loop.enabled ? COLORS.loop : COLORS.loopOff;
  g.fillRect(lx0, 1, lx1 - lx0, FRAME.loopBand - 2);
  // ticks under the numbers: longer on the beats than on the subdivisions
  const bar = signature.beatsPerBar;
  const tick = [0.25, 0.5, 1, bar].find(s => s * axis.pxPerBeat >= 6) ?? bar;
  g.fillStyle = '#4a4f58';
  for (let i = Math.floor(axis.xToBeat(0) / tick); axis.beatToX(i * tick) < width; i++) {
    const h = TICK_PX[beatLevel(i * tick, bar)];
    g.fillRect(Math.round(axis.beatToX(i * tick)), FRAME.ruler - h, 1, h);
  }
  // bar numbers (or bar.beat if the zoom allows it)
  const label = [0.25, 1, bar, 2 * bar, 4 * bar, 8 * bar, 16 * bar, 32 * bar].find(s => s * axis.pxPerBeat >= 44) ?? 32 * bar;
  g.font = '10.5px system-ui, sans-serif';
  for (let b = Math.floor(axis.xToBeat(0) / label) * label; axis.beatToX(b) < width; b += label) {
    const x = Math.round(axis.beatToX(b));
    g.fillStyle = '#5d636d';
    g.fillRect(x, FRAME.loopBand, 1, FRAME.ruler - FRAME.loopBand);
    const parts = label >= 1 ? 2 : 3;
    const text = label >= bar ? String(Math.floor(b / bar + 1e-9) + 1) : signature.format(b).split('.').slice(0, parts).join('.');
    g.fillStyle = COLORS.rulerText;
    g.fillText(text, x + 3, FRAME.ruler - 6);
  }
  flag(g, axis.beatToX(clip.region.start), 1);
  flag(g, axis.beatToX(clip.region.end), -1);
}

/** Triangle pointing towards the inside of the region (dir 1 = start, −1 = end). */
function flag(g: CanvasRenderingContext2D, x: number, dir: 1 | -1): void {
  const y0 = FRAME.loopBand, y1 = FRAME.ruler;
  g.fillStyle = '#e8eaee';
  g.beginPath();
  g.moveTo(x, y0);
  g.lineTo(x + 9 * dir, y0 + (y1 - y0) / 2);
  g.lineTo(x, y1);
  g.closePath();
  g.fill();
  g.fillRect(Math.round(x) - (dir > 0 ? 0 : 1), y0, 1, y1 - y0);
}
