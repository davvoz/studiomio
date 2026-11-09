/* A drawn Prisma envelope, with the handles: the end of the attack, of the hold and of the
 * release are dragged horizontally (the time), the decay's also vertically (the
 * sustain); the dots halfway through attack, decay and release are dragged vertically to
 * curve them. The time is drawn as a square root: the short times stay wide. With `fit` the
 * time scale adapts to the envelope, which fills the width (still while dragging). */
import { bend } from '../../../devices/instruments/prisma/shapes';
import type { ParamValues } from '../../../model/device';
import { el } from '../../dom';
import { ACCENT, BACKGROUND, drag, fit, GRID, LABEL } from './canvas';

const MAX_TIME = 10, MIN_TIME = 0.001;
const PAD = 8, HANDLE = 4, HIT = 9;
/** With `fit`: the sum of the times' roots that fills the width at least (a 1 s decay),
 *  so a very short envelope doesn't become huge, and the margin left on the right. */
const FIT_MIN = 1, FIT_ROOM = 1.1;

type Handle = 'A' | 'H' | 'D' | 'R' | 'Ac' | 'Dc' | 'Rc';

/** The pointer over a handle: curves drag up and down, the decay moves both ways, times sideways. */
function handleCursor(h: Handle | null): string {
  if (!h) return 'default';
  if (h.endsWith('c')) return 'ns-resize';
  return h === 'D' ? 'move' : 'ew-resize';
}

export class EnvView {
  readonly canvas = el<HTMLCanvasElement>('canvas', {
    className: 'prisma-env', title: 'Drag the handles: times and sustain; the dots halfway through the segments curve them (double click: straight)',
  });
  private env = 1;
  private hot: Handle | null = null;
  /** The time scale, still while a handle is dragged (with `fit`). */
  private frozen: number | null = null;

  constructor(
    private readonly values: () => Readonly<Record<string, number>>, private readonly set: (values: ParamValues, final: boolean) => void,
    /** The name of envelope `env`, written in the corner (empty: no name, and the drawing rises). */
    private readonly label: (env: number) => string = env => (env === 1 ? 'Env 1 · volume' : `Env ${env}`),
    private readonly fit = false,
  ) {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => this.press(e));
    c.addEventListener('pointermove', e => {
      if (e.buttons) return;
      const h = this.hit(e);
      if (h !== this.hot) {
        this.hot = h;
        this.paint(true);
      }
      c.style.cursor = handleCursor(h);
    });
    c.addEventListener('dblclick', e => {
      const h = this.hit(e);
      if (h?.endsWith('c')) this.set({ [this.param(h)]: 0 }, true);
    });
  }

  /** Which envelope (1…4) is drawn. */
  show(env: number): void {
    this.env = env;
    this.paint(true);
  }

  private param(h: Handle): string {
    return `e${this.env}${h}`;
  }

  /** The drawing's measurements: where the points are, with these values. */
  private layout(v: Readonly<Record<string, number>>) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const e = (p: string) => v[`e${this.env}${p}`];
    const sustainW = w * 0.12, room = w - 2 * PAD - sustainW;
    // pixels per root of a second: four segments of MAX_TIME, or as much as needed to fill
    const roots = Math.sqrt(e('A')) + Math.sqrt(e('H')) + Math.sqrt(e('D')) + Math.sqrt(e('R'));
    const k = this.frozen ?? (this.fit ? room / (Math.max(FIT_MIN, roots) * FIT_ROOM) : room / (4 * Math.sqrt(MAX_TIME)));
    const px = (t: number) => k * Math.sqrt(Math.max(0, t));
    const top = PAD + (this.label(this.env) ? 12 : 0), bottom = h - PAD, height = bottom - top;
    const xA = PAD + px(e('A')), xH = xA + px(e('H')), xD = xH + px(e('D')), xS = xD + sustainW, xR = xS + px(e('R'));
    const yS = bottom - (e('S') / 100) * height;
    return { w, h, k, top, bottom, height, xA, xH, xD, xS, xR, yS, e };
  }

  private handles(v: Readonly<Record<string, number>>): [Handle, number, number][] {
    const L = this.layout(v);
    const mid = (x0: number, x1: number, y0: number, y1: number, curve: number) =>
      [(x0 + x1) / 2, y0 + (y1 - y0) * bend(0.5, curve)] as const;
    return [
      ['A', L.xA, L.top], ['H', L.xH, L.top], ['D', L.xD, L.yS], ['R', L.xR, L.bottom],
      ['Ac', ...mid(PAD, L.xA, L.bottom, L.top, L.e('Ac'))],
      ['Dc', ...mid(L.xH, L.xD, L.top, L.yS, L.e('Dc'))],
      ['Rc', ...mid(L.xS, L.xR, L.yS, L.bottom, L.e('Rc'))],
    ];
  }

  private hit(e: MouseEvent): Handle | null {
    const r = this.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best: Handle | null = null, dist = HIT;
    for (const [h, hx, hy] of this.handles(this.values())) {
      const d = Math.hypot(hx - x, hy - y);
      if (d < dist) {
        dist = d;
        best = h;
      }
    }
    return best;
  }

  private press(e: PointerEvent): void {
    const h = this.hit(e);
    if (!h || e.button !== 0) return;
    e.preventDefault();
    const v0 = this.values(), L = this.layout(v0), curve0 = v0[this.param(h)];
    // the time is read from the start of the segment whose end is being dragged
    let x0 = L.xS;
    if (h === 'A') x0 = PAD;
    else if (h === 'H') x0 = L.xA;
    else if (h === 'D') x0 = L.xH;
    const r = this.canvas.getBoundingClientRect();
    const timeAt = (clientX: number) => {
      const dx = Math.max(0, clientX - r.left - x0) / L.k;
      return Math.max(MIN_TIME, Math.min(MAX_TIME, dx * dx));
    };
    if (this.fit) this.frozen = L.k;
    let last: ParamValues = {};
    drag(e, this.canvas, (_dx, dy, m) => {
      const fine = m.shiftKey ? 0.25 : 1;
      if (h.endsWith('c')) {
        // going up the segment bulges upwards: for the attack it's running at the start, for
        // decay and release (which go down) it's staying up longer
        const sign = h === 'Ac' ? 1 : -1;
        last = { [this.param(h)]: Math.round(Math.max(-100, Math.min(100, curve0 - dy * 1.2 * fine * sign))) };
      } else {
        last = { [this.param(h)]: round(timeAt(m.clientX)) };
        if (h === 'D') {
          const s = Math.round(Math.max(0, Math.min(100, ((L.bottom - (m.clientY - r.top)) / L.height) * 100)));
          last = { ...last, [`e${this.env}S`]: s };
        }
      }
      this.set(last, false);
    }, () => {
      this.frozen = null;
      this.set(last, true);
      this.paint(true);
    });
  }

  paint(enabled: boolean): void {
    const g = fit(this.canvas);
    if (!g) return;
    const v = this.values(), L = this.layout(v);
    g.fillStyle = BACKGROUND;
    g.fillRect(0, 0, L.w, L.h);
    g.strokeStyle = GRID;
    g.lineWidth = 1;
    for (const y of [L.top, (L.top + L.bottom) / 2, L.bottom]) {
      g.beginPath();
      g.moveTo(PAD, y + 0.5);
      g.lineTo(L.w - PAD, y + 0.5);
      g.stroke();
    }
    const curve = new Path2D();
    const segment = (x0: number, x1: number, y0: number, y1: number, c: number, first = false) => {
      const steps = 32;
      for (let i = first ? 0 : 1; i <= steps; i++) {
        const t = i / steps, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * bend(t, c);
        if (first && !i) curve.moveTo(x, y);
        else curve.lineTo(x, y);
      }
    };
    segment(PAD, L.xA, L.bottom, L.top, L.e('Ac'), true);
    curve.lineTo(L.xH, L.top);
    segment(L.xH, L.xD, L.top, L.yS, L.e('Dc'));
    curve.lineTo(L.xS, L.yS);
    segment(L.xS, L.xR, L.yS, L.bottom, L.e('Rc'));
    g.globalAlpha = enabled ? 1 : 0.5;
    const fill = new Path2D(curve);
    fill.lineTo(L.xR, L.bottom);
    fill.lineTo(PAD, L.bottom);
    g.fillStyle = 'rgba(255,157,46,0.12)';
    g.fill(fill);
    g.strokeStyle = ACCENT;
    g.lineWidth = 2;
    g.stroke(curve);
    // the released note: where the sustain ends
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(L.xS + 0.5, L.top);
    g.lineTo(L.xS + 0.5, L.bottom);
    g.stroke();
    g.setLineDash([]);
    for (const [h, x, y] of this.handles(v)) {
      g.beginPath();
      g.arc(x, y, h.endsWith('c') ? HANDLE - 1 : HANDLE, 0, 2 * Math.PI);
      if (h === this.hot) g.fillStyle = '#fff';
      else g.fillStyle = h.endsWith('c') ? 'rgba(255,255,255,0.45)' : ACCENT;
      g.fill();
    }
    g.globalAlpha = 1;
    const label = this.label(this.env);
    if (!label) return;
    g.font = '10px system-ui, sans-serif';
    g.fillStyle = LABEL;
    g.fillText(label, 6, 12);
  }
}

const round = (t: number) => (t < 0.1 ? Math.round(t * 10000) / 10000 : Math.round(t * 1000) / 1000);
