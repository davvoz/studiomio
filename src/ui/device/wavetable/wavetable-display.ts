/* Wavetable's panel: for each oscillator its table drawn as in Live, all
 * the shapes in a row one behind the other, and the one playing at the current position highlighted.
 * Dragging the table vertically moves the position (Shift for fine adjustment).
 * Below and beside it, the knobs of the other sections, generated from the parameters as in the normal
 * panel. */
import { paramActive, paramSpec, resolveParams } from '../../../devices/device-type';
import { FRAMES, LEVELS, STRIDE, TABLE_NAMES, TABLE_SIZE, wavetable } from '../../../devices/instruments/wavetable/tables';
import type { DeviceSettings, ParamValues } from '../../../model/device';
import { el } from '../../dom';
import { controlFor, setActive, type ParamControl } from '../controls';
import type { DeviceDisplay, DisplayContext } from '../displays';

const ACCENT = '#ff9d2e';
/** Points per shape in the drawing. */
const POINTS = 96;
/** How much of the drawing's height the whole position is worth, when dragging. */
const DRAG_PIXELS = 150;

/** A sharp canvas, resized to its place. */
function fit(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return null;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) Object.assign(c, { width: Math.round(w * dpr), height: Math.round(h * dpr) });
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

/** A table's drawing, with its draggable position. */
class TableView {
  readonly canvas = el<HTMLCanvasElement>('canvas', { className: 'wt-view', title: 'Drag vertically to move the position (Shift: fine)' });
  private drag: { y: number; pos: number } | null = null;

  constructor(private readonly osc: 'A' | 'B', private readonly ctx: DisplayContext, private readonly values: () => Record<string, number>) {
    const c = this.canvas;
    c.onpointerdown = e => {
      c.setPointerCapture(e.pointerId);
      this.drag = { y: e.clientY, pos: this.values()[`pos${osc}`] };
    };
    c.onpointermove = e => {
      if (!this.drag) return;
      const scale = e.shiftKey ? 0.2 : 1;
      this.drag = { y: e.clientY, pos: Math.max(0, Math.min(100, this.drag.pos + ((this.drag.y - e.clientY) / DRAG_PIXELS) * 100 * scale)) };
      this.ctx.setParams({ [`pos${osc}`]: Math.round(this.drag.pos) }, false);
    };
    c.onpointerup = c.onpointercancel = () => {
      if (!this.drag) return;
      this.drag = null;
      this.ctx.setParams({ [`pos${osc}`]: this.values()[`pos${osc}`] }, true);
    };
  }

  paint(enabled: boolean): void {
    const g = fit(this.canvas);
    if (!g) return;
    const v = this.values(), w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const table = wavetable(v[`table${this.osc}`]), pos = v[`pos${this.osc}`] / 100;
    const heard = v[`level${this.osc}`] > 0;
    // the shapes in a row: the first in front at the bottom left, the last behind at the top right
    const waveW = w * 0.7, amp = h * 0.2, dx = (w - waveW - 16) / (FRAMES - 1), dy = (h * 0.42) / (FRAMES - 1);
    const x0 = 8, y0 = h * 0.7;
    const sample = (frame: number, t: number) => table[frame * LEVELS * STRIDE + Math.min(TABLE_SIZE - 1, Math.floor(t * TABLE_SIZE))];
    const path = (at: number, value: (t: number) => number) => {
      const p = new Path2D(), ox = x0 + at * dx, oy = y0 - at * dy;
      for (let i = 0; i <= POINTS; i++) {
        const t = i / POINTS, x = ox + t * waveW, y = oy - value(t) * amp;
        if (i) p.lineTo(x, y);
        else p.moveTo(x, y);
      }
      return p;
    };
    g.fillStyle = '#15181c';
    g.fillRect(0, 0, w, h);
    g.globalAlpha = enabled ? 1 : 0.5;
    g.lineWidth = 1;
    for (let f = FRAMES - 1; f >= 0; f--) {
      g.strokeStyle = `rgba(255,255,255,${0.07 + 0.08 * (1 - f / (FRAMES - 1))})`;
      g.stroke(path(f, t => sample(f, t)));
    }
    // the playing shape: between the two neighbours, as the engine reads it
    const x = pos * (FRAMES - 1), f = Math.min(FRAMES - 2, Math.floor(x)), mix = x - f;
    g.strokeStyle = heard ? ACCENT : 'rgba(255,157,46,0.45)';
    g.lineWidth = 2;
    g.stroke(path(x, t => sample(f, t) * (1 - mix) + sample(f + 1, t) * mix));
    g.globalAlpha = 1;
    g.font = '10px system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillText(TABLE_NAMES[v[`table${this.osc}`]] ?? '', 6, 13);
    g.textAlign = 'right';
    g.fillText(`${Math.round(pos * 100)} %`, w - 6, 13);
    g.textAlign = 'left';
  }
}

export class WavetableDisplay implements DeviceDisplay {
  readonly element = el('div', { className: 'wt-display' });
  private readonly controls = new Map<string, { control: ParamControl; spec: NonNullable<ReturnType<typeof paramSpec>> }>();
  private readonly views: TableView[] = [];
  private values: Record<string, number>;
  private params: ParamValues | null = null;
  private enabled = true;

  constructor(private readonly ctx: DisplayContext) {
    this.values = resolveParams(ctx.type, ctx.settings.params);
    const sections = ctx.type.sections.map((section, i) => {
      const controls = el('div', { className: 'device-controls' }, ...section.params.map(p => this.control(p.id)));
      const title = el('div', { className: 'device-section-title', textContent: section.label });
      // the two oscillators (the first two sections) have the table drawing
      if (i < 2) {
        const view = new TableView(i ? 'B' : 'A', ctx, () => this.values);
        this.views.push(view);
        return el('div', { className: 'device-section wt-osc' }, title, view.canvas, controls);
      }
      return el('div', { className: 'device-section' }, title, controls);
    });
    this.element.append(...sections);
    this.update(ctx.settings, true);
    // it's redrawn when the drawing takes its size (panel opened, reopened, widened)
    const resized = new ResizeObserver(() => this.paint());
    for (const v of this.views) resized.observe(v.canvas);
  }

  update(settings: DeviceSettings, enabled: boolean): void {
    if (settings.params !== this.params) {
      this.params = settings.params;
      this.values = resolveParams(this.ctx.type, settings.params);
    }
    this.enabled = enabled;
    for (const { control, spec } of this.controls.values()) {
      control.set(this.values[spec.id]);
      setActive(control, paramActive(spec, this.values));
    }
    this.paint();
  }

  private control(id: string): HTMLElement {
    const spec = paramSpec(this.ctx.type, id)!;
    const control = controlFor(spec, this.values[id], (v, final) => this.ctx.setParams({ [id]: v }, final));
    this.controls.set(id, { control, spec });
    return control.element;
  }

  private paint(): void {
    for (const v of this.views) v.paint(this.enabled);
  }
}
