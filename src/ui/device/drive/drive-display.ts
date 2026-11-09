/* The Drive's panel: on the left the curve (how the sound bends it: drive, bias, makeup
 * and mix, computed with the same maths as the engine), next to it the spectrum before (faint line) and
 * after (filled) — you see the harmonics being born —, below the shapes as buttons with their
 * little curve and the knobs generated from the parameters. */
import { paramActive, paramSpec, resolveParams } from '../../../devices/device-type';
import { autoGain, SHAPES, transfer } from '../../../devices/effects/drive/drive-math';
import { dbToGain } from '../../../devices/dsp/core';
import type { DeviceSettings, ParamValues } from '../../../model/device';
import { el } from '../../dom';
import { controlFor, setActive, type ParamControl } from '../controls';
import type { DeviceDisplay, DisplayContext, SpectrumTap } from '../displays';
import { EqScale, FREQ_GRID, spectrumColumns, SPECTRUM_BOTTOM } from '../eq/eq-scale';

/** The controls under the graph, in groups (the shape has its buttons). */
const GROUPS: readonly (readonly string[])[] = [['drive', 'bias', 'color'], ['low', 'split'], ['tone', 'auto', 'output', 'mix'], ['oversampling']];

/** How much is visible vertically in the curve's graph (beyond ±1 the curve can rise with the makeup). */
const CURVE_RANGE = 1.3;
const ACCENT = '#ff9d2e';

/** A sharp canvas, resized to its place. */
function fit(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return null;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) Object.assign(c, { width: Math.round(w * dpr), height: Math.round(h * dpr) });
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

/** The curve y(x) for x in −1…1 in a w×h box (y in ±range). */
function curvePath(fn: (x: number) => number, w: number, h: number, range: number, steps = 160): Path2D {
  const p = new Path2D();
  for (let i = 0; i <= steps; i++) {
    const x = -1 + (2 * i) / steps, y = Math.max(-range, Math.min(range, fn(x)));
    const px = ((x + 1) / 2) * w, py = h / 2 - (y / range) * (h / 2);
    if (i) p.lineTo(px, py);
    else p.moveTo(px, py);
  }
  return p;
}

export class DriveDisplay implements DeviceDisplay {
  readonly element = el('div', { className: 'drive-display' });
  private readonly curve = el<HTMLCanvasElement>('canvas', { className: 'drive-curve' });
  private readonly spectrum = el<HTMLCanvasElement>('canvas', { className: 'drive-spectrum' });
  private readonly shapeButtons: HTMLButtonElement[];
  private readonly controls = new Map<string, { control: ParamControl; spec: NonNullable<ReturnType<typeof paramSpec>> }>();
  private readonly tap: SpectrumTap;
  private readonly pre: Float32Array<ArrayBuffer>;
  private readonly post: Float32Array<ArrayBuffer>;
  private columnsPre = new Float32Array(0);
  private columnsPost = new Float32Array(0);
  private values: Record<string, number> = {};
  private params: ParamValues | null = null;
  private enabled = true;
  private dirty = true;
  private spectrumShown = false;

  constructor(private readonly ctx: DisplayContext) {
    this.tap = ctx.openSpectrum();
    this.pre = new Float32Array(this.tap.binCount);
    this.post = new Float32Array(this.tap.binCount);
    this.values = resolveParams(ctx.type, ctx.settings.params);
    this.shapeButtons = SHAPES.map((s, i) => {
      const icon = el<HTMLCanvasElement>('canvas', { className: 'drive-shape-icon' });
      const b = el<HTMLButtonElement>('button', { className: 'drive-shape', title: `Shape: ${s.label}` }, icon, el('span', { textContent: s.label }));
      b.onclick = () => this.ctx.setParams({ shape: i }, true);
      return b;
    });
    const groups = GROUPS.flatMap((ids, i) => [
      ...(i ? [el('div', { className: 'eq-sep' })] : []),
      ...ids.map(id => this.control(id)),
    ]);
    this.element.append(
      el('div', { className: 'drive-top' }, this.curve, this.spectrum),
      el('div', { className: 'drive-shapes' }, ...this.shapeButtons),
      el('div', { className: 'drive-controls' }, ...groups));
    this.update(ctx.settings, true);
    // the graphs take the height left in the panel: they're redrawn when it changes
    const resized = new ResizeObserver(() => { this.dirty = true; });
    resized.observe(this.curve);
    resized.observe(this.spectrum);
    requestAnimationFrame(() => this.icons());
    requestAnimationFrame(this.frame);
  }

  update(settings: DeviceSettings, enabled: boolean): void {
    if (settings.params !== this.params) {
      this.params = settings.params;
      this.values = resolveParams(this.ctx.type, settings.params);
    }
    this.enabled = enabled;
    this.shapeButtons.forEach((b, i) => b.classList.toggle('on', i === this.values.shape));
    if (this.element.isConnected) this.icons(); // the chosen shape's colour changes
    for (const { control, spec } of this.controls.values()) {
      control.set(this.values[spec.id]);
      setActive(control, paramActive(spec, this.values));
    }
    this.dirty = true;
  }

  private control(id: string): HTMLElement {
    const spec = paramSpec(this.ctx.type, id)!;
    const control = controlFor(spec, this.values[id], (v, final) => this.ctx.setParams({ [id]: v }, final));
    this.controls.set(id, { control, spec });
    return control.element;
  }

  /** The curve as it's heard with the current values: drive, bias, makeup, mix and output. */
  private heard(): (x: number) => number {
    const v = this.values, s = { shape: v.shape, drive: dbToGain(v.drive), bias: v.bias / 100 };
    const t = transfer(s), comp = v.auto ? autoGain(s) : 1, mix = v.mix / 100, out = dbToGain(v.output);
    return x => (x * (1 - mix) + t(x) * comp * mix) * out;
  }

  /** The little curves of the shape buttons, in the button's colour. */
  private icons(): void {
    this.shapeButtons.forEach((b, i) => {
      const c = b.querySelector('canvas')!, g = fit(c);
      if (!g) return;
      const w = c.clientWidth, h = c.clientHeight, t = transfer({ shape: i, drive: 3, bias: 0 });
      g.clearRect(0, 0, w, h);
      g.strokeStyle = getComputedStyle(b).color;
      g.lineWidth = 1.5;
      g.stroke(curvePath(x => t(x) * 0.9, w, h, 1.15, 48));
    });
  }

  private readonly frame = (): void => {
    if (!this.element.isConnected) {
      this.tap.dispose();
      return;
    }
    requestAnimationFrame(this.frame);
    if (this.element.offsetParent === null) return; // hidden panel
    const live = this.tap.read(this.pre, this.post) && this.post.some(v => v > SPECTRUM_BOTTOM - 10);
    if (this.dirty) this.paintCurve();
    if (live || this.spectrumShown || this.dirty) this.paintSpectrum(live);
    this.spectrumShown = live;
    this.dirty = false;
  };

  private paintCurve(): void {
    const g = fit(this.curve);
    if (!g) return;
    const w = this.curve.clientWidth, h = this.curve.clientHeight;
    g.fillStyle = '#15181c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 1;
    for (const v of [-1, -0.5, 0.5, 1]) {
      const x = Math.round(((v + 1) / 2) * w) + 0.5, y = Math.round(h / 2 - (v / CURVE_RANGE) * (h / 2)) + 0.5;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.2)';
    g.beginPath(); g.moveTo(w / 2 + 0.5, 0); g.lineTo(w / 2 + 0.5, h); g.moveTo(0, h / 2 + 0.5); g.lineTo(w, h / 2 + 0.5); g.stroke();
    // the clean sound: the diagonal
    g.setLineDash([3, 3]);
    g.stroke(curvePath(x => x, w, h, CURVE_RANGE, 2));
    g.setLineDash([]);
    const path = curvePath(this.heard(), w, h, CURVE_RANGE);
    g.globalAlpha = this.enabled ? 1 : 0.4;
    g.strokeStyle = ACCENT;
    g.lineWidth = 2;
    g.stroke(path);
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.font = '10px system-ui, sans-serif';
    g.fillText(SHAPES[this.values.shape]?.label ?? '', 6, 13);
    g.textAlign = 'right';
    g.fillText(`${this.values.drive > 0 ? '+' : ''}${this.values.drive.toFixed(1)} dB`, w - 6, 13);
    g.textAlign = 'left';
  }

  private paintSpectrum(live: boolean): void {
    const g = fit(this.spectrum);
    if (!g) return;
    const w = this.spectrum.clientWidth, h = this.spectrum.clientHeight, scale = new EqScale(w, h);
    g.fillStyle = '#15181c';
    g.fillRect(0, 0, w, h);
    g.font = '10px system-ui, sans-serif';
    g.textBaseline = 'bottom';
    for (const [freq, label] of FREQ_GRID) {
      const x = Math.round(scale.freqToX(freq)) + 0.5;
      g.strokeStyle = label ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.035)';
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      if (label) {
        g.fillStyle = 'rgba(255,255,255,0.32)';
        g.fillText(label, x + 3, h - 2);
      }
    }
    g.textBaseline = 'alphabetic';
    if (!live) {
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.fillText('Spectrum: before (line) and after the Drive (filled), while playing', 8, 16);
      return;
    }
    const n = Math.ceil(w / 2) + 1;
    if (this.columnsPre.length !== n) [this.columnsPre, this.columnsPost] = [new Float32Array(n), new Float32Array(n)];
    spectrumColumns(this.pre, this.tap.sampleRate, scale, this.columnsPre);
    spectrumColumns(this.post, this.tap.sampleRate, scale, this.columnsPost);
    const step = w / n;
    const path = (cols: Float32Array) => {
      const p = new Path2D();
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) * step, y = Math.min(h, scale.spectrumToY(Math.max(SPECTRUM_BOTTOM - 20, cols[i]), scale.xToFreq(x)));
        if (i) p.lineTo(x, y);
        else p.moveTo(x, y);
      }
      return p;
    };
    const post = path(this.columnsPost);
    g.strokeStyle = 'rgba(255,170,90,0.7)';
    g.lineWidth = 1;
    g.stroke(post);
    post.lineTo((n - 0.5) * step, h);
    post.lineTo(0.5 * step, h);
    post.closePath();
    g.fillStyle = 'rgba(255,157,46,0.16)';
    g.fill(post);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.stroke(path(this.columnsPre));
  }
}
