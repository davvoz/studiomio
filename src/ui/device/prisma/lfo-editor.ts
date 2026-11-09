/* The shape of a Prisma LFO, to draw as in Serum. A click in empty space adds a point
 * (and it can be dragged right away), a point is dragged, a double click on a point removes it;
 * the dot halfway through a segment is dragged vertically to curve it (double click: straight).
 * The grid snaps the points (Shift: free). Touching a fixed shape (sine, square…)
 * turns it into points, and you continue from there; the random shapes can only be looked at. */
import { LFO_POINTS, LFO_SHAPE, LFO_SHAPES, bend, drawnValue, isRandomShape, pointsForShape, pointsOf, pointValues, randomValue, shapeValue, type LfoPoint } from '../../../devices/instruments/prisma/shapes';
import type { ParamValues } from '../../../model/device';
import { showContextMenu, SEPARATOR, type MenuItem } from '../../context-menu';
import { el } from '../../dom';
import { ACCENT, BACKGROUND, drag, fit, GRID, LABEL } from './canvas';

const PAD = 7, POINT = 4, HIT = 8;
export const GRIDS = [0, 4, 8, 16, 32] as const;
let grid: number = 8;

type Target = { kind: 'point'; index: number } | { kind: 'curve'; index: number };

/** The shape traversed from the end to the start: the new segment from i to i+1 is the old one from
 *  n−2−i to n−1−i reversed in time, so with the opposite curve. */
function reversed(points: readonly LfoPoint[]): LfoPoint[] {
  const n = points.length;
  return points.map((_, i) => ({ x: 1 - points[n - 1 - i].x, y: points[n - 1 - i].y, curve: i < n - 1 ? -points[n - 2 - i].curve : 0 }));
}

export class LfoEditor {
  readonly canvas = el<HTMLCanvasElement>('canvas', {
    className: 'prisma-lfo', title: 'Click: add a point · drag points and dots (curves) · double click: remove the point or straighten the segment · Shift: without grid',
  });
  readonly gridSelect = el<HTMLSelectElement>('select', { className: 'prisma-grid', title: 'Drawing grid' },
    ...GRIDS.map(g => el('option', { value: String(g), textContent: g ? `Grid ${g}` : 'Free' })));
  readonly menuButton = el<HTMLButtonElement>('button', { className: 'mini', textContent: '≡', title: 'Shapes and transformations' });
  private lfo = 1;
  private hot: Target | null = null;

  constructor(private readonly values: () => Readonly<Record<string, number>>, private readonly set: (values: ParamValues, final: boolean) => void) {
    const c = this.canvas;
    this.gridSelect.value = String(grid);
    this.gridSelect.onchange = () => {
      grid = Number(this.gridSelect.value);
      this.paint(true);
    };
    this.menuButton.onclick = () => {
      const r = this.menuButton.getBoundingClientRect();
      showContextMenu(r.left, r.bottom + 2, this.menu());
    };
    c.addEventListener('pointerdown', e => this.press(e));
    c.addEventListener('pointermove', e => {
      if (e.buttons) return;
      const t = this.hit(e);
      if (t?.kind !== this.hot?.kind || t?.index !== this.hot?.index) {
        this.hot = t;
        this.paint(true);
      }
    });
    c.addEventListener('dblclick', e => {
      const t = this.hit(e), points = this.points();
      if (!t || !points) return;
      if (t.kind === 'point' && t.index > 0 && t.index < points.length - 1) this.write(points.filter((_, i) => i !== t.index), true);
      if (t.kind === 'curve') this.write(points.map((p, i) => (i === t.index ? { ...p, curve: 0 } : p)), true);
    });
  }

  show(lfo: number): void {
    this.lfo = lfo;
    this.paint(true);
  }

  private get shape(): number {
    return this.values()[`l${this.lfo}Shape`];
  }

  /** The points of the drawn shape, or null if the shape is fixed or random. */
  private points(): LfoPoint[] | null {
    return this.shape === LFO_SHAPE.drawn ? pointsOf(this.values(), this.lfo) : null;
  }

  private write(points: readonly LfoPoint[], final: boolean): void {
    this.set({ [`l${this.lfo}Shape`]: LFO_SHAPE.drawn, ...pointValues(this.lfo, points) }, final);
  }

  private box() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return { w, h, x: (u: number) => PAD + u * (w - 2 * PAD), y: (v: number) => h - PAD - v * (h - 2 * PAD - 10) };
  }

  /** The drawing's point under the pointer, in 0…1 (with the grid, if there's no Shift). */
  private at(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect(), b = this.box();
    let x = (e.clientX - r.left - PAD) / (b.w - 2 * PAD), y = (b.h - PAD - (e.clientY - r.top)) / (b.h - 2 * PAD - 10);
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));
    if (grid && !e.shiftKey) {
      x = Math.round(x * grid) / grid;
      y = Math.round(y * 16) / 16;
    }
    return { x, y };
  }

  private hit(e: MouseEvent): Target | null {
    const points = this.points() ?? (isRandomShape(this.shape) ? null : pointsForShape(this.shape));
    if (!points) return null;
    const r = this.canvas.getBoundingClientRect(), b = this.box(), mx = e.clientX - r.left, my = e.clientY - r.top;
    let best: Target | null = null, dist = HIT;
    points.forEach((p, i) => {
      const d = Math.hypot(b.x(p.x) - mx, b.y(p.y) - my);
      if (d < dist) {
        dist = d;
        best = { kind: 'point', index: i };
      }
    });
    if (best) return best;
    for (let i = 0; i < points.length - 1; i++) {
      const [cx, cy] = this.curveHandle(points, i);
      const d = Math.hypot(b.x(cx) - mx, b.y(cy) - my);
      if (d < dist) {
        dist = d;
        best = { kind: 'curve', index: i };
      }
    }
    return best;
  }

  /** The dot of segment `i`: halfway, on the curve. */
  private curveHandle(points: readonly LfoPoint[], i: number): [number, number] {
    const a = points[i], b = points[i + 1];
    return [(a.x + b.x) / 2, a.y + (b.y - a.y) * bend(0.5, a.curve)];
  }

  private press(e: PointerEvent): void {
    if (e.button !== 0 || isRandomShape(this.shape)) return;
    e.preventDefault();
    let points = this.points() ?? pointsForShape(this.shape);
    let target = this.hit(e);
    if (!target) {
      // a new point where it was clicked, among those next to it
      if (points.length >= LFO_POINTS) return;
      const p = this.at(e), after = points.findIndex(q => q.x > p.x);
      // never before the first; if nobody is further right, right before the last
      const index = after < 1 ? (after === 0 ? 1 : points.length - 1) : after;
      points = [...points.slice(0, index), { x: p.x, y: p.y, curve: 0 }, ...points.slice(index)];
      target = { kind: 'point', index };
      this.write(points, false);
    }
    const t = target, start = points;
    let last = points;
    drag(e, this.canvas, (_dx, dy, m) => {
      if (t.kind === 'curve') {
        const a = start[t.index], b = start[t.index + 1];
        // going up the segment bulges upwards: if it rises it means running at the start
        const sign = b.y >= a.y ? 1 : -1;
        const curve = Math.max(-100, Math.min(100, a.curve - dy * 1.2 * sign * (m.shiftKey ? 0.25 : 1)));
        last = start.map((p, i) => (i === t.index ? { ...p, curve } : p));
      } else {
        const p = this.at(m), i = t.index, n = start.length;
        // the first and the last stay at the edges; the others don't jump over their neighbours
        const x = i === 0 ? 0 : i === n - 1 ? 1 : Math.max(start[i - 1].x, Math.min(start[i + 1].x, p.x));
        last = start.map((q, j) => (j === i ? { ...q, x, y: p.y } : q));
      }
      this.write(last, false);
    }, () => this.write(last, true));
  }

  private menu(): MenuItem[] {
    const points = this.points() ?? pointsForShape(this.shape);
    const fixed = [LFO_SHAPE.sine, LFO_SHAPE.triangle, LFO_SHAPE.sawUp, LFO_SHAPE.sawDown, LFO_SHAPE.square];
    return [
      ...fixed.map(s => ({ label: LFO_SHAPES[s], checked: this.shape === s, run: () => this.set({ [`l${this.lfo}Shape`]: s }, true) })),
      ...[LFO_SHAPE.sampleHold, LFO_SHAPE.smoothRandom].map(s => ({ label: LFO_SHAPES[s], checked: this.shape === s, run: () => this.set({ [`l${this.lfo}Shape`]: s }, true) })),
      SEPARATOR,
      { label: 'Draw from here (in points)', disabled: isRandomShape(this.shape), run: () => this.write(points, true) },
      { label: 'Flip (top ↔ bottom)', disabled: isRandomShape(this.shape), run: () => this.write(points.map(p => ({ ...p, y: 1 - p.y })), true) },
      { label: 'Reverse (end ↔ start)', disabled: isRandomShape(this.shape), run: () => this.write(reversed(points), true) },
      { label: 'Restart (triangle)', run: () => this.write(pointsForShape(LFO_SHAPE.triangle), true) },
    ];
  }

  paint(enabled: boolean): void {
    const g = fit(this.canvas);
    if (!g) return;
    const b = this.box(), shape = this.shape, points = this.points();
    g.fillStyle = BACKGROUND;
    g.fillRect(0, 0, b.w, b.h);
    g.lineWidth = 1;
    g.strokeStyle = GRID;
    const columns = grid || 4;
    for (let i = 0; i <= columns; i++) {
      const x = Math.round(b.x(i / columns)) + 0.5;
      g.beginPath();
      g.moveTo(x, b.y(1));
      g.lineTo(x, b.y(0));
      g.stroke();
    }
    for (const v of [0, 0.5, 1]) {
      const y = Math.round(b.y(v)) + 0.5;
      g.beginPath();
      g.moveTo(b.x(0), y);
      g.lineTo(b.x(1), y);
      g.stroke();
    }
    g.globalAlpha = enabled ? 1 : 0.5;
    const value = points ? (p: number) => drawnValue(points, p)
      : isRandomShape(shape) ? (p: number) => randomValue(shape, Math.floor(p * 8) + 11, (p * 8) % 1) : (p: number) => shapeValue(shape, p);
    const line = new Path2D(), steps = Math.max(64, Math.round(b.w));
    for (let i = 0; i <= steps; i++) {
      // the steps (two points at the same x) are drawn vertical
      const p = Math.min(0.99999, i / steps), x = b.x(p), y = b.y(value(p));
      if (i) line.lineTo(x, y);
      else line.moveTo(x, y);
    }
    const fill = new Path2D(line);
    fill.lineTo(b.x(1), b.y(0));
    fill.lineTo(b.x(0), b.y(0));
    g.fillStyle = 'rgba(76,184,255,0.12)';
    g.fill(fill);
    g.strokeStyle = '#4cb8ff';
    g.lineWidth = 2;
    g.stroke(line);
    const shown = points ?? (isRandomShape(shape) ? null : pointsForShape(shape));
    if (shown) {
      shown.forEach((p, i) => {
        const hot = this.hot?.kind === 'point' && this.hot.index === i;
        g.beginPath();
        g.arc(b.x(p.x), b.y(p.y), POINT, 0, 2 * Math.PI);
        g.fillStyle = hot ? '#fff' : points ? ACCENT : 'rgba(255,157,46,0.4)';
        g.fill();
      });
      if (points) {
        for (let i = 0; i < points.length - 1; i++) {
          const [cx, cy] = this.curveHandle(points, i), hot = this.hot?.kind === 'curve' && this.hot.index === i;
          g.beginPath();
          g.arc(b.x(cx), b.y(cy), POINT - 1.5, 0, 2 * Math.PI);
          g.fillStyle = hot ? '#fff' : 'rgba(255,255,255,0.4)';
          g.fill();
        }
      }
    }
    g.globalAlpha = 1;
    g.font = '10px system-ui, sans-serif';
    g.fillStyle = LABEL;
    g.fillText(`LFO ${this.lfo} · ${LFO_SHAPES[shape] ?? ''}${points ? ` · ${points.length} points` : ''}`, 6, 12);
  }
}
