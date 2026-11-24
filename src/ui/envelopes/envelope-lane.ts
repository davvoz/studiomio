/* A modulation's lane, under the clip editor (piano roll or audio) and aligned with its
 * beat axis, or under the master and aligned with the timeline: the curve with its points,
 * the neutral line, the grid. Gestures: click in
 * empty space adds a point and drags it, dragging a point moves it (Alt: without grid,
 * Shift: fine), double click deletes it; in draw mode (B) steps are painted on the grid,
 * with Alt freehand. Shift+drag chooses a range: it's dragged all together, and with
 * Ctrl+C/X/V it's copied, also onto another parameter or into another clip (without a range, the whole
 * curve). F opens the ready-made shapes, which go into the chosen range or over everything that plays. The top
 * edge changes the lane's height.
 * Each gesture is an undo step. This is the DOM: what happens to the curve is in `LaneEditing`,
 * the drags in lane-drags, the drawing in lane-painter. */
import type { Beats, TimeSignature } from '../../core/music-time';
import type { Color } from '../../model/clip';
import { scaleOf, type ClipEnvelope, type EnvelopePoint, type ModTarget } from '../../model/envelope';
import type { Clipboard } from '../../store/clipboard';
import type { BeatAxis } from '../clip-editor/clip-geometry';
import { showContextMenu } from '../context-menu';
import { el } from '../dom';
import type { DrawMode } from '../draw-mode';
import { Surface } from '../kit/canvas';
import { drag as dragPointer, localPoint } from '../kit/pointer';
import { readPref, writePref } from '../kit/prefs';
import { LaneEditing } from './lane-editing';
import { LANE_PAD, LaneGeometry } from './lane-geometry';
import { paintLane, paintLaneBackground } from './lane-painter';
import type { ModChain } from './mod-targets';
import { ShapeStrip } from './shape-strip';

/** The curves the lane shows: those of a clip, or those of the master. */
export interface LaneCurves {
  readonly color: Color;
  readonly envelopes: readonly ClipEnvelope[];
  envelope(target: ModTarget): ClipEnvelope | undefined;
}

/** What the lane uses of the editor hosting it. */
export interface LaneHost {
  readonly axis: BeatAxis;
  /** The curves (null: nothing open); the same object until they change. */
  curves(): LaneCurves | null;
  /** The playing part, in the axis's beats: outside it's darker (absent: all of it). */
  span?(): { readonly start: Beats; readonly end: Beats } | null;
  /** The grid's step (and the snap's). */
  grid(): Beats;
  signature(): TimeSignature;
  /** The beat playing now, if it plays. */
  playhead(): Beats | null;
  /** Replaces the curve's points on `target`; without points it removes it (one undo step). */
  commit(label: string, target: ModTarget, points: readonly EnvelopePoint[]): void;
  /** The wheel on the lane scrolls and zooms the time as in the editor. */
  wheel(e: WheelEvent, x: number): void;
  /** The modulated chain: for a choice the lane shows the option that's heard. */
  chain?(): ModChain | null;
  /** The app's clipboard: a curve can also be pasted elsewhere. */
  readonly clipboard: Clipboard;
  /** The app's draw mode (B), shared with the piano roll and the other lanes. */
  readonly drawMode: DrawMode;
}

/** The wheel on the lane: Ctrl zooms the time, otherwise it scrolls it. */
export function wheelTime(e: WheelEvent, x: number, axis: BeatAxis): BeatAxis {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) return axis.zoomed(axis.pxPerBeat * Math.exp(-e.deltaY * 0.0025), x);
  return axis.scrolled(axis.startBeat + (e.deltaX || e.deltaY) / axis.pxPerBeat);
}

/** Height of the lane (by dragging its top edge), remembered by this browser: it's in
 *  a CSS variable, because the editor hosting it must also grow with it. */
const LANE_HEIGHT = { key: 'studiomio.mod-lane.height', variable: '--lane-h', min: 60, max: 360 } as const;
const setLaneHeight = (px: number) => document.documentElement.style.setProperty(LANE_HEIGHT.variable, `${px}px`);

export class EnvelopeLane {
  readonly element = el('div', { className: 'mod-lane', hidden: true });
  private readonly surface = new Surface('mod-canvas');
  private readonly editing: LaneEditing;
  private readonly strip: ShapeStrip;
  private hover: { x: number; y: number } | null = null;
  /** Where the curve starts: with the shapes open, under their little bar. */
  private top = LANE_PAD;
  private dirty = true;
  private last: { axis: BeatAxis; curves: LaneCurves | null; playhead: Beats | null; grid: Beats } | null = null;

  constructor(private readonly host: LaneHost, private readonly onDrawMode: (on: boolean) => void, private readonly onShapes: (on: boolean) => void) {
    const lane = this;
    this.editing = new LaneEditing({
      host,
      geometry: () => this.geometry(),
      width: () => this.surface.width,
      get shapes() { return lane.shapes; },
      setShapes: on => this.setShapes(on),
      focus: () => this.surface.canvas.focus({ preventScroll: true }),
      invalidate: () => this.invalidate(),
    });
    this.strip = new ShapeStrip(c => this.editing.applyShape(c), c => this.editing.tweakShape(c));
    this.surface.canvas.tabIndex = 0;
    const grip = el('div', { className: 'mod-lane-grip', title: 'Drag to change the lane\'s height' });
    this.element.append(this.surface.canvas, grip, this.strip.element);
    this.bindHeight(grip);
    new ResizeObserver(() => {
      this.surface.resize(this.element.clientWidth, this.element.clientHeight);
      this.placeCurve();
    }).observe(this.element);
    this.bind(this.surface.canvas);
    host.drawMode.onChange(on => {
      this.onDrawMode(on);
      this.invalidate();
    });
  }

  private bindHeight(grip: HTMLElement): void {
    const saved = Number(readPref(LANE_HEIGHT.key));
    if (saved) setLaneHeight(saved);
    grip.addEventListener('pointerdown', e => {
      e.preventDefault();
      const start = this.element.offsetHeight;
      let height = start;
      dragPointer(e, grip, (_, dy) => {
        height = Math.max(LANE_HEIGHT.min, Math.min(LANE_HEIGHT.max, start - dy));
        setLaneHeight(height);
      }, () => writePref(LANE_HEIGHT.key, String(height)));
    });
  }

  setTarget(target: ModTarget | null): void {
    this.editing.setTarget(target);
    this.element.hidden = target === null;
    this.invalidate();
  }

  get draw(): boolean {
    return this.editing.draw;
  }

  setDraw(on: boolean): void {
    this.editing.setDraw(on);
  }

  get shapes(): boolean {
    return !this.strip.element.hidden;
  }

  setShapes(on: boolean): void {
    this.strip.element.hidden = !on;
    this.placeCurve();
    this.onShapes(on);
  }

  private placeCurve(): void {
    const { offsetTop, offsetHeight } = this.strip.element;
    this.top = this.shapes ? offsetTop + offsetHeight + LANE_PAD : LANE_PAD;
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
  }

  /** Redraws if something changed (to call at every frame of the editor). */
  frame(): void {
    if (!this.editing.target || this.element.hidden) return;
    const state = { axis: this.host.axis, curves: this.host.curves(), playhead: this.host.playhead(), grid: this.host.grid() };
    const l = this.last;
    if (!this.dirty && l?.axis === state.axis && l.curves === state.curves && l.playhead === state.playhead && l.grid === state.grid) return;
    this.dirty = false;
    this.last = state;
    this.paint(state.curves, state.playhead);
  }

  private geometry(): LaneGeometry {
    return new LaneGeometry(this.host.axis, scaleOf(this.editing.target!), this.top, this.surface.height, this.host.grid());
  }

  private bind(canvas: HTMLCanvasElement): void {
    const pos = (e: MouseEvent) => localPoint(e, canvas);
    const editing = this.editing;
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !editing.target || !this.host.curves()) return;
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(e.pointerId);
      const { x, y } = pos(e);
      editing.press(x, y, e.shiftKey, e.altKey);
    });
    canvas.addEventListener('pointermove', e => {
      this.hover = pos(e);
      editing.move(this.hover.x, this.hover.y, e.altKey, e.shiftKey);
      canvas.style.cursor = editing.cursor(this.hover.x, this.hover.y, e.shiftKey);
      this.invalidate();
    });
    canvas.addEventListener('pointerup', () => editing.finish(true));
    canvas.addEventListener('pointercancel', () => editing.finish(false));
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.invalidate(); });
    canvas.addEventListener('dblclick', e => {
      const { x, y } = pos(e);
      editing.deleteAt(x, y);
    });
    canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      const { x, y } = pos(e), items = editing.menu(x, y);
      if (items) showContextMenu(e.clientX, e.clientY, items);
    });
    canvas.addEventListener('keydown', e => {
      if (!editing.key(e.key.toLowerCase(), e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
    });
    canvas.addEventListener('wheel', e => this.host.wheel(e, pos(e).x), { passive: false });
  }

  private paint(curves: LaneCurves | null, playhead: Beats | null): void {
    const { g, width, height } = this.surface;
    if (!curves) return paintLaneBackground(g, width, height);
    paintLane({
      g, width, height, geo: this.geometry(), target: this.editing.target!, signature: this.host.signature(), span: this.host.span?.(),
      range: this.editing.range, points: this.editing.points(), color: curves.color, draw: this.draw, hover: this.hover,
      dragging: !!this.editing.drag, chain: this.host.chain?.() ?? null, playhead,
    });
  }
}
