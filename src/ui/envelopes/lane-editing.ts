/* What a modulation lane does to its curve, without the DOM: the drag in progress and its end, the
 * chosen range, copy, cut, paste (also onto another scale), clear, the ready-made shapes and their
 * tweaks, the keys and the context menu. Each change is an undo step (the host's commit). */
import type { Beats } from '../../core/music-time';
import { scaleOf, type EnvelopePoint, type ModScale, type ModTarget } from '../../model/envelope';
import { KEY, SEPARATOR, type MenuItem } from '../context-menu';
import { snapTo } from '../timeline/geometry';
import { clearRange, EPS, placeShape, replaceRange, rescalePoints, sliceRange } from './envelope-points';
import { SHAPES, shapePoints, type ShapeChoice } from './envelope-shapes';
import { laneCursor, pressLane, type LaneDrag, type LaneRange } from './lane-drags';
import type { LaneGeometry } from './lane-geometry';
import type { LaneHost } from './envelope-lane';

/** What the editing uses of the lane's view. */
export interface LaneView {
  readonly host: LaneHost;
  /** The geometry now (axis, scale, where the curve is, grid). */
  geometry(): LaneGeometry;
  /** The lane's width. */
  width(): number;
  readonly shapes: boolean;
  setShapes(on: boolean): void;
  /** Gives the keyboard back to the lane (after a shape's button). */
  focus(): void;
  invalidate(): void;
}

export class LaneEditing {
  target: ModTarget | null = null;
  drag: LaneDrag | null = null;
  range: LaneRange | null = null;
  /** The last shape placed, until something else is touched: where it went and what selection there was then. */
  shaped: { readonly range: LaneRange; readonly selection: LaneRange | null } | null = null;

  constructor(private readonly view: LaneView) {}

  /** Another parameter: the drag, the range and the shape are left behind. */
  setTarget(target: ModTarget | null): void {
    this.target = target;
    this.drag = null;
    this.range = null;
    this.shaped = null;
  }

  get draw(): boolean {
    return this.view.host.drawMode.on;
  }

  setDraw(on: boolean): void {
    this.view.host.drawMode.set(on);
  }

  get scale(): ModScale {
    return scaleOf(this.target!);
  }

  /** The curve, as the drag in progress leaves it. */
  points(): readonly EnvelopePoint[] {
    if (this.drag) return this.drag.points;
    return (this.target && this.view.host.curves()?.envelope(this.target)?.points) || [];
  }

  // ---------------------------------------------------------------- the pointer

  /** A press at (x, y): the drag it starts. */
  press(x: number, y: number, shift: boolean, alt: boolean): void {
    const press = { x, y, shift, alt, draw: this.draw, points: this.points(), range: this.range };
    this.drag = pressLane(() => this.view.geometry(), press, r => { this.range = r; });
    this.view.invalidate();
  }

  move(x: number, y: number, alt: boolean, shift: boolean): void {
    if (!this.drag) return;
    this.drag.move(x, y, alt, shift);
    if (!this.drag.sweep) this.drag.changed = true;
  }

  /** Released (`apply`) or cancelled. */
  finish(apply: boolean): void {
    const d = this.drag;
    this.drag = null;
    if (apply && d?.changed) this.commit(d.label, d.points);
    if (!apply) d?.cancel?.();
    // a click with Shift chooses nothing
    if (d?.sweep && this.range && this.range.to - this.range.from < EPS) this.range = null;
    this.view.invalidate();
  }

  /** Double click: the point under it goes (not while drawing). */
  deleteAt(x: number, y: number): void {
    if (this.draw) return;
    const i = this.view.geometry().pointAt(this.points(), x, y);
    if (i >= 0) this.commit('Delete modulation point', this.points().filter((_, k) => k !== i));
  }

  cursor(x: number, y: number, shift: boolean): string {
    return laneCursor(this.view.geometry(), this.points(), this.range, x, y, shift, this.draw);
  }

  // ---------------------------------------------------------------- shapes

  /** Where a shape goes if nothing is chosen: what plays, or on the master what's visible. */
  private whole(): LaneRange | null {
    const span = this.view.host.span?.();
    if (span) return span.end > span.start ? { from: span.start, to: span.end } : null;
    const { axis } = this.view.host, grid = this.view.host.grid();
    const from = Math.max(0, snapTo(axis.xToBeat(0), grid)), to = snapTo(axis.xToBeat(this.view.width()), grid);
    return to > from ? { from, to } : null;
  }

  applyShape(choice: ShapeChoice, range = this.range ?? this.whole()): void {
    if (!range || !this.target) return;
    const shape = SHAPES.find(s => s.id === choice.shape)!, { neutral } = this.scale;
    const inner = shapePoints(choice, range.from, range.to, this.scale);
    this.commit(`Shape: ${shape.label}`, placeShape(this.points(), range.from, range.to, inner, neutral));
    this.shaped = { range, selection: this.range };
    this.view.focus();
    this.view.invalidate();
  }

  /** Cycle, amplitude or direction changed: if the shape is still there it's redone, in the same range. */
  tweakShape(choice: ShapeChoice): void {
    const { shaped } = this;
    if (shaped?.selection === this.range) this.applyShape(choice, shaped.range);
    else this.view.focus();
  }

  // ---------------------------------------------------------------- clipboard

  /** The range the commands work on: the chosen one, or the whole curve. */
  private rangeOrAll(): LaneRange | null {
    const pts = this.points();
    return this.range ?? (pts.length ? { from: pts[0].beat, to: pts.at(-1)!.beat } : null);
  }

  copy(): boolean {
    const range = this.rangeOrAll();
    if (!range || !this.target) return false;
    this.view.host.clipboard.content = {
      kind: 'envelope', points: sliceRange(this.points(), range.from, range.to, this.scale.neutral),
      span: range.to - range.from, origin: range.from, scale: this.scale,
    };
    return true;
  }

  cut(): void {
    if (this.copy()) this.clear('Cut modulation');
  }

  clear(label: string): void {
    const { range } = this;
    if (!range) return this.commit(label, []);
    this.commit(label, clearRange(this.points(), range.from, range.to, this.scale.neutral));
    this.range = null;
    this.view.invalidate();
  }

  /** Pastes at beat `at`; without, at the start of the chosen range or where it was when copied. */
  paste(at?: Beats): void {
    const copied = this.view.host.clipboard.envelope;
    if (!copied || !this.target) return;
    const from = at ?? this.range?.from ?? copied.origin, to = from + copied.span;
    const inner = rescalePoints(copied.points, copied.scale, this.scale).map(p => ({ beat: from + p.beat, value: p.value }));
    this.commit('Paste modulation', replaceRange(this.points(), from, to, inner, this.scale.neutral));
    this.range = copied.span > EPS ? { from, to } : null;
    this.view.invalidate();
  }

  // ---------------------------------------------------------------- keys and menu

  /** A key on the lane (`key` in lower case); true if it was the lane's. */
  key(key: string, ctrl: boolean): boolean {
    if (ctrl) return this.ctrlKey(key);
    if (key === 'b') this.setDraw(!this.draw);
    else if (key === 'f') this.view.setShapes(!this.view.shapes);
    else if ((key === 'delete' || key === 'backspace') && this.range) this.clear('Clear modulation range');
    else if (key === 'escape' && this.range) {
      this.range = null;
      this.view.invalidate();
    } else return false;
    return true;
  }

  private ctrlKey(key: string): boolean {
    if (key === 'c') return this.copy();
    if (key === 'x') this.cut();
    else if (key === 'v') this.paste();
    else return false;
    return true;
  }

  /** The context menu at (x, y); null while dragging or with nothing open. */
  menu(x: number, y: number): MenuItem[] | null {
    if (!this.target || this.drag) return null;
    const g = this.view.geometry(), pts = this.points(), i = g.pointAt(pts, x, y);
    const beat = g.snap(g.axis.xToBeat(x), false), copied = !!this.view.host.clipboard.envelope;
    const what = this.range ? 'the range' : 'the curve';
    return [
      { label: `Cut ${what}`, shortcut: KEY.cut, disabled: !pts.length, run: () => this.cut() },
      { label: `Copy ${what}`, shortcut: KEY.copy, disabled: !pts.length, run: () => this.copy() },
      { label: 'Paste here', disabled: !copied, run: () => this.paste(beat) },
      { label: 'Paste in the same place', shortcut: KEY.paste, disabled: !copied, run: () => this.paste() },
      SEPARATOR,
      { label: 'Delete the point', disabled: i < 0, run: () => this.commit('Delete modulation point', pts.filter((_, k) => k !== i)) },
      { label: this.range ? 'Clear the range' : 'Clear the modulation', disabled: !pts.length, run: () => this.clear('Clear modulation') },
      SEPARATOR,
      { label: 'Step drawing', shortcut: KEY.draw, checked: this.draw, run: () => this.setDraw(!this.draw) },
      { label: 'Ready-made shapes', shortcut: KEY.shapes, checked: this.view.shapes, run: () => this.view.setShapes(!this.view.shapes) },
    ];
  }

  private commit(label: string, points: readonly EnvelopePoint[]): void {
    const target = this.target;
    this.shaped = null;
    if (target) this.view.host.commit(label, target, points);
  }
}
