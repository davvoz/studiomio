/* La forma di un LFO di Prisma, da disegnare come in Serum. Un clic nel vuoto aggiunge un punto
 * (e lo si può subito trascinare), un punto si trascina, il doppio clic su un punto lo toglie;
 * il pallino a metà di un tratto si trascina in verticale per curvarlo (doppio clic: diritto).
 * La griglia aggancia i punti (Maiusc: libero). Toccare una forma fissa (seno, quadra…) la
 * trasforma in punti, e si continua da lì; le forme casuali si guardano soltanto. */
import { LFO_POINTS, LFO_SHAPE, LFO_SHAPES, bend, drawnValue, isRandomShape, pointsForShape, pointsOf, pointValues, randomValue, shapeValue, type LfoPoint } from '../../../devices/instruments/prisma/shapes';
import type { ParamValues } from '../../../model/device';
import { showContextMenu, SEPARATOR, type MenuItem } from '../../context-menu';
import { el } from '../../dom';
import { ACCENT, BACKGROUND, drag, fit, GRID, LABEL } from './canvas';

const PAD = 7, POINT = 4, HIT = 8;
export const GRIDS = [0, 4, 8, 16, 32] as const;
let grid: number = 8;

type Target = { kind: 'point'; index: number } | { kind: 'curve'; index: number };

/** La forma percorsa dalla fine all'inizio: il tratto nuovo da i a i+1 è quello vecchio da
 *  n−2−i a n−1−i rovesciato nel tempo, quindi con la curva opposta. */
function reversed(points: readonly LfoPoint[]): LfoPoint[] {
  const n = points.length;
  return points.map((_, i) => ({ x: 1 - points[n - 1 - i].x, y: points[n - 1 - i].y, curve: i < n - 1 ? -points[n - 2 - i].curve : 0 }));
}

export class LfoEditor {
  readonly canvas = el<HTMLCanvasElement>('canvas', {
    className: 'prisma-lfo', title: 'Clic: aggiungi un punto · trascina punti e pallini (curve) · doppio clic: togli il punto o raddrizza il tratto · Maiusc: senza griglia',
  });
  readonly gridSelect = el<HTMLSelectElement>('select', { className: 'prisma-grid', title: 'Griglia del disegno' },
    ...GRIDS.map(g => el('option', { value: String(g), textContent: g ? `Griglia ${g}` : 'Libero' })));
  readonly menuButton = el<HTMLButtonElement>('button', { className: 'mini', textContent: '≡', title: 'Forme e trasformazioni' });
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

  /** I punti della forma disegnata, o null se la forma è fissa o casuale. */
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

  /** Il punto del disegno sotto il puntatore, in 0…1 (con la griglia, se non c'è Maiusc). */
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

  /** Il pallino del tratto `i`: a metà, sulla curva. */
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
      // un punto nuovo dove si è cliccato, fra quelli che ha accanto
      if (points.length >= LFO_POINTS) return;
      const p = this.at(e), after = points.findIndex(q => q.x > p.x);
      // mai prima del primo; se nessuno è più a destra, subito prima dell'ultimo
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
        // salendo il tratto si gonfia verso l'alto: se sale vuol dire correre all'inizio
        const sign = b.y >= a.y ? 1 : -1;
        const curve = Math.max(-100, Math.min(100, a.curve - dy * 1.2 * sign * (m.shiftKey ? 0.25 : 1)));
        last = start.map((p, i) => (i === t.index ? { ...p, curve } : p));
      } else {
        const p = this.at(m), i = t.index, n = start.length;
        // il primo e l'ultimo restano ai bordi; gli altri non scavalcano i vicini
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
      { label: 'Disegna da qui (in punti)', disabled: isRandomShape(this.shape), run: () => this.write(points, true) },
      { label: 'Capovolgi (sopra ↔ sotto)', disabled: isRandomShape(this.shape), run: () => this.write(points.map(p => ({ ...p, y: 1 - p.y })), true) },
      { label: 'Al contrario (fine ↔ inizio)', disabled: isRandomShape(this.shape), run: () => this.write(reversed(points), true) },
      { label: 'Ricomincia (triangolo)', run: () => this.write(pointsForShape(LFO_SHAPE.triangle), true) },
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
      // gli scalini (due punti alla stessa x) si disegnano verticali
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
    g.fillText(`LFO ${this.lfo} · ${LFO_SHAPES[shape] ?? ''}${points ? ` · ${points.length} punti` : ''}`, 6, 12);
  }
}
