/* La corsia di una modulazione, sotto l'editor della clip (piano roll o audio) e allineata al
 * suo asse dei battiti: la curva con i suoi punti, la linea neutra, la griglia. Gesti: clic nel
 * vuoto aggiunge un punto e lo trascina, trascinare un punto lo sposta (Alt: senza griglia,
 * Maiusc: fine), doppio clic lo elimina; in modo disegno si dipingono scalini sulla griglia.
 * Ogni gesto è un passo di annullamento. */
import type { Beats, TimeSignature } from '../../core/music-time';
import type { Clip } from '../../model/clip';
import { envelopeValueAt, scaleOf, type EnvelopePoint, type ModScale, type ModTarget } from '../../model/envelope';
import type { BeatAxis } from '../clip-editor/clip-geometry';
import { paintBeatGrid } from '../clip-editor/clip-frame';
import { SEPARATOR, showContextMenu } from '../context-menu';
import { el } from '../dom';
import { Surface } from '../surface';
import { snapTo } from '../timeline/geometry';
import { COLORS, withAlpha } from '../timeline/painters';
import { formatModValue } from './mod-targets';

/** Ciò che la corsia usa dell'editor che la ospita. */
export interface LaneHost {
  readonly axis: BeatAxis;
  clip(): Clip | null;
  /** Il passo della griglia (e dell'aggancio). */
  grid(): Beats;
  signature(): TimeSignature;
  /** Il battito della clip che suona adesso, se suona. */
  playhead(): Beats | null;
  /** Modifica la clip (un passo di annullamento). */
  commit(label: string, fn: (c: Clip) => Clip): void;
  /** La rotella sulla corsia scorre e zooma il tempo come nell'editor. */
  wheel(e: WheelEvent, x: number): void;
}

/** La rotella sulla corsia: Ctrl zooma il tempo, altrimenti lo scorre. */
export function wheelTime(e: WheelEvent, x: number, axis: BeatAxis): BeatAxis {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) return axis.zoomed(axis.pxPerBeat * Math.exp(-e.deltaY * 0.0025), x);
  return axis.scrolled(axis.startBeat + (e.deltaX || e.deltaY) / axis.pxPerBeat);
}

/** Margine sopra e sotto la curva. */
const PAD = 9;
const HIT_PX = 6;
const EPS = 1e-9;

/** Il valore subito prima di `beat` (su uno scalino, quello di sinistra). */
export function valueBefore(points: readonly EnvelopePoint[], beat: Beats, neutral: number): number {
  if (!points.length) return neutral;
  let i = -1;
  while (i + 1 < points.length && points[i + 1].beat < beat - EPS) i++;
  if (i < 0) return points[0].value;
  const a = points[i], b = points[i + 1];
  if (!b) return a.value;
  return a.value + ((b.value - a.value) * (beat - a.beat)) / (b.beat - a.beat);
}

/** Uno scalino al valore `value` in [from, to]: fuori la curva resta com'era (ai bordi si salta). */
export function paintStep(points: readonly EnvelopePoint[], from: Beats, to: Beats, value: number, neutral: number): EnvelopePoint[] {
  const before = valueBefore(points, from, neutral);
  const after = points.length ? envelopeValueAt(points, to) : neutral;
  const out = [
    ...points.filter(p => p.beat < from - EPS),
    { beat: from, value: before }, { beat: from, value }, { beat: to, value }, { beat: to, value: after },
    ...points.filter(p => p.beat > to + EPS),
  ];
  return simplify(out);
}

/** Toglie i punti che non cambiano la curva: i doppioni, quelli in mezzo a due con lo stesso
 *  valore, e il primo se ne ha un altro allo stesso battito (prima del primo punto la curva vale
 *  comunque il primo). */
export function simplify(points: readonly EnvelopePoint[]): EnvelopePoint[] {
  const out: EnvelopePoint[] = [];
  for (const p of points) {
    const a = out[out.length - 1], b = out[out.length - 2];
    if (a && a.beat === p.beat && a.value === p.value) continue;
    if (a && b && a.value === p.value && b.value === p.value) out.pop();
    out.push(p);
  }
  if (out.length > 1 && out[0].beat === out[1].beat) out.shift();
  return out;
}

/** Un trascinamento nella corsia: i punti come saranno al rilascio. */
interface LaneDrag {
  points: EnvelopePoint[];
  changed: boolean;
  readonly label: string;
  move(x: number, y: number, alt: boolean, shift: boolean): void;
}

export class EnvelopeLane {
  readonly element = el('div', { className: 'mod-lane', hidden: true });
  private readonly surface = new Surface('mod-canvas');
  private target: ModTarget | null = null;
  private drag: LaneDrag | null = null;
  private hover: { x: number; y: number } | null = null;
  private drawMode = false;
  private dirty = true;
  private last: { axis: BeatAxis; clip: Clip | null; playhead: Beats | null } | null = null;

  constructor(private readonly host: LaneHost, private readonly onDrawMode: (on: boolean) => void) {
    this.element.append(this.surface.canvas);
    new ResizeObserver(() => {
      this.surface.resize(this.element.clientWidth, this.element.clientHeight);
      this.invalidate();
    }).observe(this.element);
    this.bind(this.surface.canvas);
  }

  setTarget(target: ModTarget | null): void {
    this.target = target;
    this.drag = null;
    this.element.hidden = target === null;
    this.invalidate();
  }

  get draw(): boolean {
    return this.drawMode;
  }

  setDraw(on: boolean): void {
    this.drawMode = on;
    this.onDrawMode(on);
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
  }

  /** Ridisegna se qualcosa è cambiato (da chiamare a ogni fotogramma dell'editor). */
  frame(): void {
    if (!this.target || this.element.hidden) return;
    const state = { axis: this.host.axis, clip: this.host.clip(), playhead: this.host.playhead() };
    const l = this.last;
    if (!this.dirty && l && l.axis === state.axis && l.clip === state.clip && l.playhead === state.playhead) return;
    this.dirty = false;
    this.last = state;
    this.paint(state.clip, state.playhead);
  }

  // ---------------------------------------------------------------- geometria

  private get scale(): ModScale {
    return scaleOf(this.target!);
  }

  private valueToY(v: number): number {
    const { min, max } = this.scale;
    return PAD + (1 - (v - min) / (max - min)) * (this.surface.height - 2 * PAD);
  }

  private yToValue(y: number): number {
    const { min, max } = this.scale;
    const u = 1 - (y - PAD) / Math.max(1, this.surface.height - 2 * PAD);
    return Math.max(min, Math.min(max, min + u * (max - min)));
  }

  private points(): readonly EnvelopePoint[] {
    if (this.drag) return this.drag.points;
    return (this.target && this.host.clip()?.envelope(this.target)?.points) || [];
  }

  private pointAt(x: number, y: number): number {
    const pts = this.points(), a = this.host.axis;
    for (let i = pts.length - 1; i >= 0; i--) {
      if (Math.abs(a.beatToX(pts[i].beat) - x) <= HIT_PX && Math.abs(this.valueToY(pts[i].value) - y) <= HIT_PX) return i;
    }
    return -1;
  }

  private snap(beat: Beats, alt: boolean): Beats {
    return Math.max(0, alt ? beat : snapTo(beat, this.host.grid()));
  }

  // ---------------------------------------------------------------- gesti

  /** Trascina il punto `index` di `start`. */
  private pointDrag(start: readonly EnvelopePoint[], index: number, label: string, changed: boolean): LaneDrag {
    const prev = start[index - 1]?.beat ?? 0, next = start[index + 1]?.beat ?? Infinity;
    const origin = start[index];
    let fineY: number | null = null, fineValue = origin.value;
    const drag: LaneDrag = {
      points: [...start], changed, label,
      move: (x, y, alt, shift) => {
        const beat = Math.max(prev, Math.min(next, this.snap(this.host.axis.xToBeat(x), alt)));
        // con Maiusc il valore si muove 10 volte più piano, da dove era
        if (shift) {
          fineY ??= y;
          const span = this.scale.max - this.scale.min;
          fineValue = Math.max(this.scale.min, Math.min(this.scale.max, fineValue - ((y - fineY) / (this.surface.height - 2 * PAD)) * span * 0.1));
          fineY = y;
        } else {
          fineY = null;
          fineValue = this.yToValue(y);
        }
        const p = { beat, value: fineValue };
        drag.points = start.map((q, i) => (i === index ? p : q));
        drag.changed = true;
      },
    };
    return drag;
  }

  /** Dipinge scalini sulla griglia: ogni cella toccata prende il valore sotto il puntatore; se
   *  il puntatore salta delle celle, quelle in mezzo prendono i valori tra i due punti. */
  private drawDrag(start: readonly EnvelopePoint[]): LaneDrag {
    let last: { beat: Beats; value: number } | null = null;
    const drag: LaneDrag = {
      points: [...start], changed: false, label: 'Disegna modulazione',
      move: (x, y) => {
        const grid = this.host.grid(), beat = Math.max(0, this.host.axis.xToBeat(x)), value = this.yToValue(y);
        const a = last ?? { beat, value };
        const c0 = Math.floor(Math.min(a.beat, beat) / grid + EPS), c1 = Math.floor(Math.max(a.beat, beat) / grid + EPS);
        for (let c = c0; c <= c1; c++) {
          const u = beat === a.beat ? 1 : Math.max(0, Math.min(1, ((c + 0.5) * grid - a.beat) / (beat - a.beat)));
          drag.points = paintStep(drag.points, c * grid, (c + 1) * grid, a.value + (value - a.value) * u, this.scale.neutral);
        }
        last = { beat, value };
        drag.changed = true;
      },
    };
    return drag;
  }

  private commit(label: string, points: readonly EnvelopePoint[]): void {
    const target = this.target;
    if (target) this.host.commit(label, c => c.withEnvelope(target, points));
  }

  private bind(canvas: HTMLCanvasElement): void {
    const pos = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !this.target || !this.host.clip()) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const { x, y } = pos(e), pts = this.points();
      const hit = this.pointAt(x, y);
      if (this.drawMode) this.drag = this.drawDrag(pts);
      else if (hit >= 0) this.drag = this.pointDrag(pts, hit, 'Sposta punto della modulazione', false);
      else {
        // un punto nuovo dove si è premuto, già da trascinare
        const p = { beat: this.snap(this.host.axis.xToBeat(x), e.altKey), value: this.yToValue(y) };
        const i = pts.filter(q => q.beat <= p.beat).length;
        this.drag = this.pointDrag([...pts.slice(0, i), p, ...pts.slice(i)], i, 'Aggiungi punto della modulazione', true);
      }
      this.drag.move(x, y, e.altKey, false);
      if (!this.drawMode && hit >= 0) this.drag.changed = false; // un clic su un punto non lo sposta
      this.invalidate();
    });
    canvas.addEventListener('pointermove', e => {
      this.hover = pos(e);
      if (this.drag) {
        this.drag.move(this.hover.x, this.hover.y, e.altKey, e.shiftKey);
        this.drag.changed = true;
      }
      canvas.style.cursor = this.drawMode ? 'crosshair' : this.pointAt(this.hover.x, this.hover.y) >= 0 ? 'move' : 'copy';
      this.invalidate();
    });
    const finish = (apply: boolean) => {
      const d = this.drag;
      this.drag = null;
      if (apply && d?.changed) this.commit(d.label, d.points);
      this.invalidate();
    };
    canvas.addEventListener('pointerup', () => finish(true));
    canvas.addEventListener('pointercancel', () => finish(false));
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.invalidate(); });
    canvas.addEventListener('dblclick', e => {
      if (this.drawMode) return;
      const { x, y } = pos(e), i = this.pointAt(x, y);
      if (i >= 0) this.commit('Elimina punto della modulazione', this.points().filter((_, k) => k !== i));
    });
    canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (!this.target || this.drag) return;
      const { x, y } = pos(e), i = this.pointAt(x, y), pts = this.points();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Elimina il punto', disabled: i < 0, run: () => this.commit('Elimina punto della modulazione', pts.filter((_, k) => k !== i)) },
        { label: 'Cancella la modulazione', disabled: !pts.length, run: () => this.commit('Cancella modulazione', []) },
        SEPARATOR,
        { label: 'Disegno a scalini', checked: this.drawMode, run: () => this.setDraw(!this.drawMode) },
      ]);
    });
    canvas.addEventListener('wheel', e => this.host.wheel(e, pos(e).x), { passive: false });
  }

  // ---------------------------------------------------------------- disegno

  private paint(clip: Clip | null, playhead: Beats | null): void {
    const { g, width: w, height: h } = this.surface;
    const target = this.target!, axis = this.host.axis, scale = this.scale;
    g.fillStyle = '#15171a';
    g.fillRect(0, 0, w, h);
    if (!clip) return;
    paintBeatGrid(g, axis, w, 0, h, this.host.grid(), this.host.signature());
    // fuori da ciò che suona: più scuro
    const end = clip.loop.enabled ? clip.loop.end : clip.region.end;
    const x0 = axis.beatToX(clip.region.start), x1 = axis.beatToX(end);
    g.fillStyle = 'rgba(0,0,0,0.42)';
    g.fillRect(0, 0, Math.max(0, x0), h);
    g.fillRect(x1, 0, Math.max(0, w - x1), h);
    // la linea neutra (nessuna modulazione)
    const ny = Math.round(this.valueToY(scale.neutral)) + 0.5;
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(0, ny);
    g.lineTo(w, ny);
    g.stroke();
    g.setLineDash([]);
    const pts = this.points(), color = clip.color;
    g.font = '10.5px system-ui, sans-serif';
    if (!pts.length) {
      g.fillStyle = COLORS.rulerText;
      g.fillText(this.drawMode ? 'Trascina per disegnare la modulazione' : 'Clic per aggiungere un punto · ✎ per disegnare', 8, h - 8);
    } else {
      // la curva: piatta prima del primo punto e dopo l'ultimo
      const xs = pts.map(p => axis.beatToX(p.beat)), ys = pts.map(p => this.valueToY(p.value));
      g.beginPath();
      g.moveTo(Math.min(0, xs[0]), ys[0]);
      xs.forEach((x, i) => g.lineTo(x, ys[i]));
      g.lineTo(Math.max(w, xs[xs.length - 1]), ys[ys.length - 1]);
      g.lineTo(Math.max(w, xs[xs.length - 1]), ny);
      g.lineTo(Math.min(0, xs[0]), ny);
      g.closePath();
      g.fillStyle = withAlpha(color, 0.18);
      g.fill();
      g.beginPath();
      g.moveTo(Math.min(0, xs[0]), ys[0]);
      xs.forEach((x, i) => g.lineTo(x, ys[i]));
      g.lineTo(Math.max(w, xs[xs.length - 1]), ys[ys.length - 1]);
      g.strokeStyle = color;
      g.lineWidth = 1.5;
      g.stroke();
      g.lineWidth = 1;
      const hot = this.hover ? this.pointAt(this.hover.x, this.hover.y) : -1;
      xs.forEach((x, i) => {
        if (x < -4 || x > w + 4) return;
        g.fillStyle = i === hot ? '#ffffff' : color;
        g.fillRect(Math.round(x) - 3, Math.round(ys[i]) - 3, 7, 7);
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.strokeRect(Math.round(x) - 2.5, Math.round(ys[i]) - 2.5, 6, 6);
      });
    }
    // il valore sotto il puntatore (o del punto trascinato)
    if (this.hover) {
      const v = this.drag ? null : this.yToValue(this.hover.y);
      const text = v === null ? formatModValue(target, envelopeValueAt(pts, axis.xToBeat(this.hover.x))) : formatModValue(target, v);
      g.fillStyle = '#e8eaee';
      g.fillText(text, Math.min(w - 110, this.hover.x + 10), Math.max(12, Math.min(h - 4, this.hover.y - 6)));
    }
    if (playhead !== null) {
      g.fillStyle = COLORS.playhead;
      g.fillRect(Math.round(axis.beatToX(playhead)) - 0.5, 0, 2, h);
    }
  }
}
