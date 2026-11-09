/* The panel of the Compressor and the Noise Gate: the curve's graph (what goes in
 * horizontally, what comes out vertically, with the engine's maths) and next to it the knobs
 * generated from the parameters. While the sound passes, the dot marks where it's working: on a steady
 * sound it sits on the curve. On the right the bar of how much it reduces. The threshold is dragged on the graph. */
import { paramActive, paramSpec, resolveParams } from '../../../devices/device-type';
import { autoMakeup, curveDb, type Curve } from '../../../devices/effects/compressor/compressor-math';
import type { DeviceSettings, ParamValues } from '../../../model/device';
import { el } from '../../dom';
import { controlFor, setActive, type ParamControl } from '../controls';
import type { DeviceDisplay, DisplayContext, DynamicsTap } from '../displays';
import { ACCENT, BACKGROUND, drag, fit, GRID, LABEL } from '../prisma/canvas';

/** What changes from one effect to another. */
export interface DynamicsGraph {
  /** How many dB the graph starts from (it always reaches 0). */
  readonly floor: number;
  /** How many dB of reduction fill the bar. */
  readonly meterRange: number;
  /** The dB out for `x` dB in, with the parameters `v`. */
  transfer(v: Readonly<Record<string, number>>, x: number): number;
  /** How much is added after the reduction (output gain): needed to place the dot. */
  gain(v: Readonly<Record<string, number>>): number;
}

const curveOf = (v: Readonly<Record<string, number>>): Curve => ({ threshold: v.threshold, ratio: Math.max(1, v.ratio), knee: v.knee });
const makeup = (v: Readonly<Record<string, number>>) => v.makeup + (v.auto ? autoMakeup(curveOf(v)) : 0);

export const COMPRESSOR_GRAPH: DynamicsGraph = {
  floor: -60, meterRange: 24,
  transfer: (v, x) => curveDb(curveOf(v), x) + makeup(v),
  gain: makeup,
};

export const NOISE_GATE_GRAPH: DynamicsGraph = {
  floor: -80, meterRange: 80,
  transfer: (v, x) => ((x >= v.threshold) !== (v.flip >= 0.5) ? x : x + v.floor),
  gain: () => 0,
};

const METER = 12;
const PAD = 4;
const GRID_DB = 12;
/** How much the dot moves towards the new reading, at every frame. */
const SMOOTH = 0.35;
/** The dot disappears with the sound. */
const SILENT = -100;

export class DynamicsDisplay implements DeviceDisplay {
  readonly element = el('div', { className: 'dynamics-display' });
  private readonly canvas = el<HTMLCanvasElement>('canvas', {
    className: 'dynamics-graph', title: 'The curve: the dot is where it\'s working now · drag to move the threshold',
  });
  private readonly controls = new Map<string, { control: ParamControl; spec: NonNullable<ReturnType<typeof paramSpec>> }>();
  private readonly tap: DynamicsTap | undefined;
  private values: Record<string, number>;
  private params: ParamValues | null = null;
  private dirty = true;
  /** The height changed: the width follows at the next frame (inside the observer it can't). */
  private resized = true;
  private input = -120;
  private reduction = 0;

  constructor(private readonly ctx: DisplayContext, private readonly graph: DynamicsGraph) {
    this.values = resolveParams(ctx.type, ctx.settings.params);
    this.tap = ctx.openDynamics?.();
    const sections = ctx.type.sections.map(s => el('div', { className: 'device-section' },
      el('div', { className: 'device-section-title', textContent: s.label }),
      el('div', { className: 'device-controls' }, ...s.params.map(p => this.control(p.id)))));
    this.element.append(this.canvas, el('div', { className: 'dynamics-controls' }, ...sections));
    this.canvas.addEventListener('pointerdown', e => this.press(e));
    new ResizeObserver(() => { this.resized = this.dirty = true; }).observe(this.canvas);
    this.update(ctx.settings, true);
    requestAnimationFrame(this.frame);
  }

  update(settings: DeviceSettings, _enabled: boolean): void {
    if (settings.params !== this.params) {
      this.params = settings.params;
      this.values = resolveParams(this.ctx.type, settings.params);
    }
    for (const { control, spec } of this.controls.values()) {
      control.set(this.values[spec.id]);
      setActive(control, paramActive(spec, this.values));
    }
    this.dirty = true;
  }

  /** The curve sits in a square: the panel gives the height, the width follows it, plus
   *  the bar of how much it reduces. */
  private square(): void {
    const height = this.canvas.offsetHeight;
    if (height) this.canvas.style.width = `${height + METER}px`;
  }

  private control(id: string): HTMLElement {
    const spec = paramSpec(this.ctx.type, id)!;
    const control = controlFor(spec, this.values[id], (v, final) => this.ctx.setParams({ [id]: v }, final));
    this.controls.set(id, { control, spec });
    return control.element;
  }

  private get plotWidth(): number {
    return this.canvas.clientWidth - METER - 2 * PAD;
  }

  private xOf(db: number): number {
    return PAD + ((db - this.graph.floor) / -this.graph.floor) * this.plotWidth;
  }

  private yOf(db: number, h: number): number {
    return PAD + (-db / -this.graph.floor) * (h - 2 * PAD);
  }

  /** The threshold is dragged horizontally, from where it was pressed. */
  private press(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const { floor } = this.graph;
    const dbAt = (x: number) => floor + ((x - PAD) / this.plotWidth) * -floor;
    const set = (x: number, final: boolean) =>
      this.ctx.setParams({ threshold: Math.max(floor, Math.min(0, Math.round(dbAt(x) * 10) / 10)) }, final);
    const left = this.canvas.getBoundingClientRect().left, start = e.clientX - left;
    let at = start;
    set(at, false);
    drag(e, this.canvas, dx => { at = start + dx; set(at, false); }, () => set(at, true));
  }

  private readonly frame = (): void => {
    if (!this.element.isConnected) {
      this.tap?.dispose();
      return;
    }
    requestAnimationFrame(this.frame);
    const reading = this.tap?.read();
    if (reading) {
      // rises right away, falls calmly: it reads better
      this.input = reading.input > this.input ? reading.input : this.input + (reading.input - this.input) * SMOOTH;
      this.reduction = reading.reduction > this.reduction ? reading.reduction : this.reduction + (reading.reduction - this.reduction) * SMOOTH;
      this.dirty = true;
    }
    if (this.resized) {
      this.resized = false;
      this.square();
    }
    if (this.dirty) this.paint();
  };

  private paint(): void {
    const g = fit(this.canvas);
    if (!g) return;
    this.dirty = false;
    const { floor, transfer, meterRange } = this.graph, v = this.values;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, right = PAD + this.plotWidth;
    g.fillStyle = BACKGROUND;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = GRID;
    g.beginPath();
    for (let db = 0; db > floor; db -= GRID_DB) {
      g.moveTo(this.xOf(db), PAD);
      g.lineTo(this.xOf(db), h - PAD);
      g.moveTo(PAD, this.yOf(db, h));
      g.lineTo(right, this.yOf(db, h));
    }
    g.stroke();
    // the diagonal: the sound passing as it is
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(this.xOf(floor), this.yOf(floor, h));
    g.lineTo(this.xOf(0), this.yOf(0, h));
    g.stroke();
    // the threshold
    const tx = this.xOf(Math.max(floor, v.threshold));
    g.strokeStyle = 'rgba(255,255,255,0.4)';
    g.beginPath();
    g.moveTo(tx, PAD);
    g.lineTo(tx, h - PAD);
    g.stroke();
    g.setLineDash([]);
    // the curve, inside the graph
    g.save();
    g.beginPath();
    g.rect(PAD, PAD, right - PAD, h - 2 * PAD);
    g.clip();
    g.strokeStyle = ACCENT;
    g.lineWidth = 1.5;
    g.beginPath();
    for (let px = 0; px <= this.plotWidth; px++) {
      const x = floor + (px / this.plotWidth) * -floor, y = this.yOf(transfer(v, x), h);
      if (px) g.lineTo(PAD + px, y);
      else g.moveTo(PAD + px, y);
    }
    g.stroke();
    if (this.input > Math.max(SILENT, floor)) {
      const out = Math.min(this.input, 0) - this.reduction + this.graph.gain(v);
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(this.xOf(Math.min(this.input, 0)), this.yOf(out, h), 3, 0, 2 * Math.PI);
      g.fill();
    }
    g.restore();
    // how much it lowers
    const meterX = w - METER - 1, reduced = Math.min(1, this.reduction / meterRange) * (h - 2 * PAD);
    g.fillStyle = GRID;
    g.fillRect(meterX, PAD, METER - 3, h - 2 * PAD);
    g.fillStyle = ACCENT;
    g.fillRect(meterX, PAD, METER - 3, reduced);
    g.fillStyle = LABEL;
    g.font = '10px system-ui, sans-serif';
    g.textAlign = 'right';
    if (this.reduction >= 0.05) g.fillText(`−${this.reduction.toFixed(1)} dB`, right - 2, h - PAD - 3);
    g.textAlign = 'left';
  }
}
