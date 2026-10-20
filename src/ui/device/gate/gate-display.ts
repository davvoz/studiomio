/* Il pannello del Gate: sopra la fila degli step, sotto le manopole. Ogni step è una barra alta
 * quanto il suo livello e larga quanto resta aperto (Gate), spostata dallo swing; i quarti si
 * riconoscono dallo sfondo. Clic su uno step: lo apre o lo chiude; trascinare in verticale ne
 * sceglie il livello, e passando sugli altri li disegna allo stesso modo. Tasto destro: tutti
 * aperti o chiusi, inverti, casuale, sposta. */
import { paramActive, paramSpec, resolveParams } from '../../../devices/device-type';
import { MAX_STEPS, STEP_RATES, stepParam } from '../../../devices/effects/gate/gate';
import type { DeviceSettings, ParamValues } from '../../../model/device';
import { showContextMenu, SEPARATOR, type MenuItem } from '../../context-menu';
import { el } from '../../dom';
import { controlFor, setActive, type ParamControl } from '../controls';
import type { DeviceDisplay, DisplayContext } from '../displays';
import { ACCENT, BACKGROUND, drag, fit, GRID } from '../prisma/canvas';

const PAD = 4;
/** Di quanti pixel ci si deve muovere perché un clic diventi un trascinamento. */
const DRAG_START = 3;
const MAX_SWING_DELAY = 0.5;

export class GateDisplay implements DeviceDisplay {
  readonly element = el('div', { className: 'gate-display' });
  private readonly canvas = el<HTMLCanvasElement>('canvas', {
    className: 'gate-steps', title: 'Clic: apri o chiudi uno step · trascina: il livello (anche su più step) · tasto destro: altri comandi',
  });
  private readonly controls = new Map<string, { control: ParamControl; spec: NonNullable<ReturnType<typeof paramSpec>> }>();
  private values: Record<string, number>;
  private params: ParamValues | null = null;
  private dirty = true;

  constructor(private readonly ctx: DisplayContext) {
    this.values = resolveParams(ctx.type, ctx.settings.params);
    const sections = ctx.type.sections.filter(s => s.params.some(p => !p.hidden)).map(s => el('div', { className: 'device-section' },
      el('div', { className: 'device-section-title', textContent: s.label }),
      el('div', { className: 'device-controls' }, ...s.params.filter(p => !p.hidden).map(p => this.control(p.id)))));
    this.element.append(this.canvas, el('div', { className: 'gate-controls' }, ...sections));
    this.canvas.addEventListener('pointerdown', e => this.press(e));
    this.canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, this.menu());
    });
    new ResizeObserver(() => { this.dirty = true; }).observe(this.canvas);
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

  private control(id: string): HTMLElement {
    const spec = paramSpec(this.ctx.type, id)!;
    const control = controlFor(spec, this.values[id], (v, final) => this.ctx.setParams({ [id]: v }, final));
    this.controls.set(id, { control, spec });
    return control.element;
  }

  private get length(): number {
    return Math.max(1, Math.min(MAX_STEPS, Math.round(this.values.length)));
  }

  private levels(): number[] {
    return Array.from({ length: this.length }, (_, i) => this.values[stepParam(i)]);
  }

  /** Cambia i livelli degli step (dal primo); `final` chiude il passo di annullamento. */
  private write(levels: readonly number[], final: boolean): void {
    this.ctx.setParams(Object.fromEntries(levels.map((v, i) => [stepParam(i), Math.round(Math.max(0, Math.min(100, v)))])), final);
  }

  /** Lo step sotto il punto x del canvas e il livello che corrisponde all'altezza y. */
  private at(e: PointerEvent): { step: number; level: number } {
    const r = this.canvas.getBoundingClientRect(), w = r.width - 2 * PAD, h = r.height - 2 * PAD;
    const step = Math.max(0, Math.min(this.length - 1, Math.floor(((e.clientX - r.left - PAD) / w) * this.length)));
    const level = Math.max(0, Math.min(100, (1 - (e.clientY - r.top - PAD) / h) * 100));
    return { step, level };
  }

  private press(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = this.at(e);
    let painting = false;
    drag(e, this.canvas, (dx, dy, m) => {
      if (!painting && Math.hypot(dx, dy) < DRAG_START) return;
      painting = true;
      const { step, level } = this.at(m);
      // dal primo step toccato fino a quello sotto il puntatore, tutti allo stesso livello
      const levels = this.levels(), from = Math.min(start.step, step), to = Math.max(start.step, step);
      for (let i = from; i <= to; i++) levels[i] = level;
      this.write(levels, false);
    }, () => {
      if (painting) {
        this.write(this.levels(), true);
        return;
      }
      const levels = this.levels();
      levels[start.step] = levels[start.step] > 0 ? 0 : 100;
      this.write(levels, true);
    });
  }

  private menu(): MenuItem[] {
    const levels = this.levels(), n = levels.length;
    return [
      { label: 'Tutti aperti', run: () => this.write(levels.map(() => 100), true) },
      { label: 'Tutti chiusi', run: () => this.write(levels.map(() => 0), true) },
      { label: 'Inverti', run: () => this.write(levels.map(v => 100 - v), true) },
      { label: 'Casuale', run: () => this.write(levels.map(() => (Math.random() < 0.5 ? 100 : 0)), true) },
      SEPARATOR,
      { label: 'Sposta a sinistra', run: () => this.write(levels.map((_, i) => levels[(i + 1) % n]), true) },
      { label: 'Sposta a destra', run: () => this.write(levels.map((_, i) => levels[(i - 1 + n) % n]), true) },
    ];
  }

  private readonly frame = () => {
    if (!this.element.isConnected) return;
    if (this.dirty) this.paint();
    requestAnimationFrame(this.frame);
  };

  private paint(): void {
    const g = fit(this.canvas);
    if (!g) return;
    this.dirty = false;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight, w = W - 2 * PAD, h = H - 2 * PAD;
    const n = this.length, cell = w / n, v = this.values;
    const perBeat = Math.max(1, Math.round(1 / (STEP_RATES[v.rate] ?? STEP_RATES[3])[1]));
    const split = 1 + (v.swing / 100) * MAX_SWING_DELAY, gate = v.gate / 100;
    g.fillStyle = BACKGROUND;
    g.fillRect(0, 0, W, H);
    // un quarto sì e uno no un po' più chiaro
    for (let s = 0; s < n; s += perBeat) {
      if ((s / perBeat) % 2) continue;
      g.fillStyle = GRID;
      g.fillRect(PAD + s * cell, PAD, Math.min(perBeat, n - s) * cell, h);
    }
    for (let i = 0; i < n; i++) {
      // dove comincia e quanto dura lo step con lo swing (come in dsp/steps.ts)
      const paired = (i | 1) < n;
      const start = !paired || i % 2 === 0 ? i : i - 1 + split;
      const length = !paired ? 1 : i % 2 === 0 ? split : 2 - split;
      const x = PAD + start * cell + 1, bw = Math.max(2, length * gate * cell - 2);
      const level = v[stepParam(i)] / 100;
      g.strokeStyle = 'rgba(255,255,255,0.14)';
      g.strokeRect(PAD + i * cell + 0.5, PAD + 0.5, cell - 1, h - 1);
      if (level > 0) {
        g.fillStyle = ACCENT;
        g.globalAlpha = 0.35 + 0.65 * level;
        g.fillRect(x, PAD + h * (1 - level), bw, h * level);
        g.globalAlpha = 1;
      } else {
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(x, PAD + h - 3, bw, 2);
      }
    }
  }
}
