/* La corsia di una modulazione, sotto l'editor della clip (piano roll o audio) e allineata al
 * suo asse dei battiti, o sotto il master e allineata alla timeline: la curva con i suoi punti,
 * la linea neutra, la griglia. Gesti: clic nel
 * vuoto aggiunge un punto e lo trascina, trascinare un punto lo sposta (Alt: senza griglia,
 * Maiusc: fine), doppio clic lo elimina; in modo disegno (B) si dipingono scalini sulla griglia,
 * con Alt a mano libera. Maiusc+trascina sceglie un tratto: si trascina tutto insieme, e con
 * Ctrl+C/X/V si copia, anche su un altro parametro o in un'altra clip (senza un tratto, la curva
 * intera). F apre le forme pronte, che vanno nel tratto scelto o su tutto ciò che suona. Il bordo
 * in alto cambia l'altezza della corsia.
 * Ogni gesto è un passo di annullamento. */
import type { Beats, TimeSignature } from '../../core/music-time';
import type { Color } from '../../model/clip';
import type { Clipboard } from '../../store/clipboard';
import { envelopeValueAt, scaleOf, type ClipEnvelope, type EnvelopePoint, type ModScale, type ModTarget } from '../../model/envelope';
import type { BeatAxis } from '../clip-editor/clip-geometry';
import { paintBeatGrid } from '../clip-editor/clip-frame';
import { KEY, SEPARATOR, showContextMenu } from '../context-menu';
import { drag as dragPointer } from '../device/prisma/canvas';
import { el } from '../dom';
import { Surface } from '../surface';
import { snapTo } from '../timeline/geometry';
import { COLORS, withAlpha } from '../timeline/painters';
import { SHAPES, shapePoints, type ShapeChoice } from './envelope-shapes';
import { choiceTarget, formatModValue, type ModChain } from './mod-targets';
import { ShapeStrip } from './shape-strip';

/** Le curve che la corsia mostra: quelle di una clip, o quelle del master. */
export interface LaneCurves {
  readonly color: Color;
  readonly envelopes: readonly ClipEnvelope[];
  envelope(target: ModTarget): ClipEnvelope | undefined;
}

/** Ciò che la corsia usa dell'editor che la ospita. */
export interface LaneHost {
  readonly axis: BeatAxis;
  /** Le curve (null: niente di aperto); lo stesso oggetto finché non cambiano. */
  curves(): LaneCurves | null;
  /** La parte che suona, nei battiti dell'asse: fuori è più scura (assente: tutta). */
  span?(): { readonly start: Beats; readonly end: Beats } | null;
  /** Il passo della griglia (e dell'aggancio). */
  grid(): Beats;
  signature(): TimeSignature;
  /** Il battito che suona adesso, se suona. */
  playhead(): Beats | null;
  /** Sostituisce i punti della curva su `target`; senza punti la toglie (un passo di annullamento). */
  commit(label: string, target: ModTarget, points: readonly EnvelopePoint[]): void;
  /** La rotella sulla corsia scorre e zooma il tempo come nell'editor. */
  wheel(e: WheelEvent, x: number): void;
  /** La catena modulata: per una scelta la corsia mostra l'opzione che si sente. */
  chain?(): ModChain | null;
  /** Gli appunti dell'app: una curva si incolla anche altrove. */
  readonly clipboard: Clipboard;
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
/** Sotto questa distanza i quadratini dei punti non si disegnano: su una forma fitta sono un muro. */
const HANDLE_GAP_PX = 8;
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

/** La curva con i punti `inner` al posto del tratto [from, to]: fuori resta com'era (ai bordi si
 *  salta). Su una curva vuota ci sono solo loro: prima e dopo la curva resta piatta. */
export function replaceRange(points: readonly EnvelopePoint[], from: Beats, to: Beats, inner: readonly EnvelopePoint[], neutral: number): EnvelopePoint[] {
  if (!points.length) return simplify(inner);
  const before = valueBefore(points, from, neutral);
  const after = points.length ? envelopeValueAt(points, to) : neutral;
  return simplify([
    ...points.filter(p => p.beat < from - EPS),
    { beat: from, value: before }, ...inner, { beat: to, value: after },
    ...points.filter(p => p.beat > to + EPS),
  ]);
}

/** La curva con una forma al posto del tratto [from, to]. Su una curva vuota fuori dal tratto resta
 *  la linea neutra. */
export function placeShape(points: readonly EnvelopePoint[], from: Beats, to: Beats, inner: readonly EnvelopePoint[], neutral: number): EnvelopePoint[] {
  return replaceRange(points.length ? points : [{ beat: 0, value: neutral }, { beat: to, value: neutral }], from, to, inner, neutral);
}

/** Uno scalino al valore `value` in [from, to]: fuori la curva resta com'era (ai bordi si salta). */
export const paintStep = (points: readonly EnvelopePoint[], from: Beats, to: Beats, value: number, neutral: number): EnvelopePoint[] =>
  replaceRange(points.length ? points : [{ beat: from, value: neutral }, { beat: to, value: neutral }], from, to, [{ beat: from, value }, { beat: to, value }], neutral);

/** Il tratto [from, to] della curva, con i battiti relativi a `from`. */
export function sliceRange(points: readonly EnvelopePoint[], from: Beats, to: Beats, neutral: number): EnvelopePoint[] {
  if (!points.length) return [];
  const inside = points.filter(p => p.beat > from + EPS && p.beat < to - EPS);
  return simplify([
    { beat: from, value: envelopeValueAt(points, from) }, ...inside, { beat: to, value: valueBefore(points, to, neutral) },
  ].map(p => ({ beat: p.beat - from, value: p.value })));
}

/** Nel tratto [from, to] nessuna modulazione. Se non resta altro, la curva sparisce. */
export function clearRange(points: readonly EnvelopePoint[], from: Beats, to: Beats, neutral: number): EnvelopePoint[] {
  if (points.every(p => p.beat >= from - EPS && p.beat <= to + EPS)) return [];
  const out = paintStep(points, from, to, neutral, neutral);
  return out.every(p => Math.abs(p.value - neutral) < EPS) ? [] : out;
}

/** I valori di una curva portati su un'altra scala: la linea neutra resta neutra, gli estremi
 *  vanno sugli estremi. */
export function rescalePoints(points: readonly EnvelopePoint[], from: ModScale, to: ModScale): EnvelopePoint[] {
  if (from === to) return [...points];
  const up = (from.max - from.neutral) || 1, down = (from.neutral - from.min) || 1;
  return points.map(p => {
    const d = p.value - from.neutral;
    return { beat: p.beat, value: to.neutral + (d >= 0 ? (d / up) * (to.max - to.neutral) : (d / down) * (to.neutral - to.min)) };
  });
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
  /** Sceglie un tratto: non tocca la curva. */
  readonly sweep?: boolean;
  move(x: number, y: number, alt: boolean, shift: boolean): void;
  /** Annullato: rimette a posto ciò che ha toccato oltre ai punti. */
  cancel?(): void;
}

/** Un tratto di tempo scelto nella corsia. */
interface LaneRange {
  readonly from: Beats;
  readonly to: Beats;
}

/** Quanto può essere fitto il disegno a mano libera, in parti di griglia. */
const FREEHAND_STEPS = 8;

/** Altezza della corsia (trascinando il suo bordo in alto), ricordata da questo browser: sta in
 *  una variabile CSS, perché anche l'editor che la ospita deve crescere con lei. */
const LANE_HEIGHT = { key: 'studiomio.mod-lane.height', variable: '--lane-h', min: 60, max: 360 } as const;
const setLaneHeight = (px: number) => document.documentElement.style.setProperty(LANE_HEIGHT.variable, `${px}px`);

export class EnvelopeLane {
  readonly element = el('div', { className: 'mod-lane', hidden: true });
  private readonly surface = new Surface('mod-canvas');
  private target: ModTarget | null = null;
  private drag: LaneDrag | null = null;
  private range: LaneRange | null = null;
  /** L'ultima forma messa, finché non si tocca altro: dove è andata e che scelta c'era allora. */
  private shaped: { readonly range: LaneRange; readonly selection: LaneRange | null } | null = null;
  private readonly strip = new ShapeStrip(c => this.applyShape(c), c => this.tweakShape(c));
  private hover: { x: number; y: number } | null = null;
  /** Dove comincia la curva: con le forme aperte, sotto la loro barretta. */
  private top = PAD;
  private drawMode = false;
  private dirty = true;
  private last: { axis: BeatAxis; curves: LaneCurves | null; playhead: Beats | null } | null = null;

  constructor(private readonly host: LaneHost, private readonly onDrawMode: (on: boolean) => void, private readonly onShapes: (on: boolean) => void) {
    this.surface.canvas.tabIndex = 0;
    const grip = el('div', { className: 'mod-lane-grip', title: 'Trascina per cambiare l\'altezza della corsia' });
    this.element.append(this.surface.canvas, grip, this.strip.element);
    this.bindHeight(grip);
    new ResizeObserver(() => {
      this.surface.resize(this.element.clientWidth, this.element.clientHeight);
      this.placeCurve();
    }).observe(this.element);
    this.bind(this.surface.canvas);
  }

  private bindHeight(grip: HTMLElement): void {
    try {
      const saved = Number(localStorage.getItem(LANE_HEIGHT.key));
      if (saved) setLaneHeight(saved);
    } catch { /* niente preferenza */ }
    grip.addEventListener('pointerdown', e => {
      e.preventDefault();
      const start = this.element.offsetHeight;
      let height = start;
      dragPointer(e, grip, (_, dy) => {
        height = Math.max(LANE_HEIGHT.min, Math.min(LANE_HEIGHT.max, start - dy));
        setLaneHeight(height);
      }, () => {
        try { localStorage.setItem(LANE_HEIGHT.key, String(height)); } catch { /* resta per adesso */ }
      });
    });
  }

  setTarget(target: ModTarget | null): void {
    this.target = target;
    this.drag = null;
    this.range = null;
    this.shaped = null;
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
    this.top = this.shapes ? offsetTop + offsetHeight + PAD : PAD;
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
  }

  /** Ridisegna se qualcosa è cambiato (da chiamare a ogni fotogramma dell'editor). */
  frame(): void {
    if (!this.target || this.element.hidden) return;
    const state = { axis: this.host.axis, curves: this.host.curves(), playhead: this.host.playhead() };
    const l = this.last;
    if (!this.dirty && l && l.axis === state.axis && l.curves === state.curves && l.playhead === state.playhead) return;
    this.dirty = false;
    this.last = state;
    this.paint(state.curves, state.playhead);
  }

  // ---------------------------------------------------------------- geometria

  private get scale(): ModScale {
    return scaleOf(this.target!);
  }

  private get curveHeight(): number {
    return Math.max(1, this.surface.height - this.top - PAD);
  }

  private valueToY(v: number): number {
    const { min, max } = this.scale;
    return this.top + (1 - (v - min) / (max - min)) * this.curveHeight;
  }

  private yToValue(y: number): number {
    const { min, max } = this.scale;
    const u = 1 - (y - this.top) / this.curveHeight;
    return Math.max(min, Math.min(max, min + u * (max - min)));
  }

  private points(): readonly EnvelopePoint[] {
    if (this.drag) return this.drag.points;
    return (this.target && this.host.curves()?.envelope(this.target)?.points) || [];
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
          fineValue = Math.max(this.scale.min, Math.min(this.scale.max, fineValue - ((y - fineY) / this.curveHeight) * span * 0.1));
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
      move: (x, y, alt) => {
        const grid = this.host.grid(), beat = Math.max(0, this.host.axis.xToBeat(x)), value = this.yToValue(y);
        if (alt) {
          // a mano libera: una linea dal punto di prima
          const at = snapTo(beat, grid / FREEHAND_STEPS);
          if (last && at !== last.beat) {
            const [a, b] = at > last.beat ? [last, { beat: at, value }] : [{ beat: at, value }, last];
            drag.points = replaceRange(drag.points, a.beat, b.beat, [a, b], this.scale.neutral);
          }
          last = { beat: at, value };
          drag.changed = true;
          return;
        }
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

  /** Sceglie un tratto trascinando (sulla griglia; Alt: senza). */
  private sweepDrag(start: readonly EnvelopePoint[], x0: number): LaneDrag {
    const from = this.snap(this.host.axis.xToBeat(x0), false);
    return {
      points: [...start], changed: false, label: '', sweep: true,
      move: (x, _y, alt) => {
        const at = this.snap(this.host.axis.xToBeat(x), alt);
        this.range = { from: Math.min(from, at), to: Math.max(from, at) };
      },
      cancel: () => { this.range = null; },
    };
  }

  /** Trascina il tratto scelto: nel tempo sulla griglia (Alt: senza), nel valore tutto insieme. */
  private rangeDrag(start: readonly EnvelopePoint[], range: LaneRange, x0: number, y0: number): LaneDrag {
    const { neutral, min, max } = this.scale, axis = this.host.axis;
    const inner = sliceRange(start, range.from, range.to, neutral), base = clearRange(start, range.from, range.to, neutral);
    const beat0 = axis.xToBeat(x0), value0 = this.yToValue(y0), length = range.to - range.from;
    const drag: LaneDrag = {
      points: [...start], changed: false, label: 'Sposta tratto della modulazione',
      move: (x, y, alt) => {
        const raw = axis.xToBeat(x) - beat0, dt = Math.max(-range.from, alt ? raw : snapTo(raw, this.host.grid()));
        const dv = this.yToValue(y) - value0, from = range.from + dt;
        const moved = inner.map(p => ({ beat: from + p.beat, value: Math.max(min, Math.min(max, p.value + dv)) }));
        drag.points = replaceRange(base, from, from + length, moved, neutral);
        this.range = { from, to: from + length };
      },
      cancel: () => { this.range = range; },
    };
    return drag;
  }

  /** Dove va una forma se non è scelto niente: ciò che suona, o sul master ciò che si vede. */
  private whole(): LaneRange | null {
    const span = this.host.span?.();
    if (span) return span.end > span.start ? { from: span.start, to: span.end } : null;
    const { axis } = this.host, grid = this.host.grid();
    const from = Math.max(0, snapTo(axis.xToBeat(0), grid)), to = snapTo(axis.xToBeat(this.surface.width), grid);
    return to > from ? { from, to } : null;
  }

  private applyShape(choice: ShapeChoice, range = this.range ?? this.whole()): void {
    if (!range || !this.target) return;
    const shape = SHAPES.find(s => s.id === choice.shape)!, { neutral } = this.scale;
    const inner = shapePoints(choice, range.from, range.to, this.scale);
    this.commit(`Forma: ${shape.label}`, placeShape(this.points(), range.from, range.to, inner, neutral));
    this.shaped = { range, selection: this.range };
    this.surface.canvas.focus({ preventScroll: true });
    this.invalidate();
  }

  /** Ciclo, ampiezza o verso cambiati: se la forma è ancora lì si rifà, nello stesso tratto. */
  private tweakShape(choice: ShapeChoice): void {
    const { shaped } = this;
    if (shaped && shaped.selection === this.range) this.applyShape(choice, shaped.range);
    else this.surface.canvas.focus({ preventScroll: true });
  }

  /** Il tratto su cui lavorano i comandi: quello scelto, o tutta la curva. */
  private rangeOrAll(): LaneRange | null {
    const pts = this.points();
    return this.range ?? (pts.length ? { from: pts[0].beat, to: pts[pts.length - 1].beat } : null);
  }

  private copy(): boolean {
    const range = this.rangeOrAll();
    if (!range || !this.target) return false;
    this.host.clipboard.content = {
      kind: 'envelope', points: sliceRange(this.points(), range.from, range.to, this.scale.neutral),
      span: range.to - range.from, origin: range.from, scale: this.scale,
    };
    return true;
  }

  private clear(label: string): void {
    const { range } = this;
    if (!range) return this.commit(label, []);
    this.commit(label, clearRange(this.points(), range.from, range.to, this.scale.neutral));
    this.range = null;
    this.invalidate();
  }

  /** Incolla al battito `at`; senza, all'inizio del tratto scelto o dov'era quando è stata copiata. */
  private paste(at?: Beats): void {
    const copied = this.host.clipboard.envelope;
    if (!copied || !this.target) return;
    const from = at ?? this.range?.from ?? copied.origin, to = from + copied.span;
    const inner = rescalePoints(copied.points, copied.scale, this.scale).map(p => ({ beat: from + p.beat, value: p.value }));
    this.commit('Incolla modulazione', replaceRange(this.points(), from, to, inner, this.scale.neutral));
    this.range = copied.span > EPS ? { from, to } : null;
    this.invalidate();
  }

  private key(e: KeyboardEvent): void {
    const ctrl = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    const run = (): boolean => {
      if (ctrl && key === 'c') return this.copy();
      if (ctrl && key === 'x') { if (this.copy()) this.clear('Taglia modulazione'); return true; }
      if (ctrl && key === 'v') { this.paste(); return true; }
      if (ctrl) return false;
      if (key === 'b') { this.setDraw(!this.drawMode); return true; }
      if (key === 'f') { this.setShapes(!this.shapes); return true; }
      if ((key === 'delete' || key === 'backspace') && this.range) { this.clear('Cancella tratto della modulazione'); return true; }
      if (key === 'escape' && this.range) { this.range = null; this.invalidate(); return true; }
      return false;
    };
    if (run()) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  private commit(label: string, points: readonly EnvelopePoint[]): void {
    const target = this.target;
    this.shaped = null;
    if (target) this.host.commit(label, target, points);
  }

  private bind(canvas: HTMLCanvasElement): void {
    const pos = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !this.target || !this.host.curves()) return;
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(e.pointerId);
      const { x, y } = pos(e), pts = this.points();
      const hit = this.pointAt(x, y), beat = this.host.axis.xToBeat(x), range = this.range;
      const inRange = !!range && beat >= range.from && beat <= range.to;
      if (range && !inRange && !e.shiftKey) {
        // un clic fuori dal tratto lo lascia e basta
        this.range = null;
        this.invalidate();
        if (!this.drawMode) return;
      }
      if (this.drawMode) this.drag = this.drawDrag(pts);
      else if (e.shiftKey) this.drag = this.sweepDrag(pts, x);
      else if (inRange) this.drag = this.rangeDrag(pts, range!, x, y);
      else if (hit >= 0) this.drag = this.pointDrag(pts, hit, 'Sposta punto della modulazione', false);
      else {
        // un punto nuovo dove si è premuto, già da trascinare
        const p = { beat: this.snap(this.host.axis.xToBeat(x), e.altKey), value: this.yToValue(y) };
        const i = pts.filter(q => q.beat <= p.beat).length;
        this.drag = this.pointDrag([...pts.slice(0, i), p, ...pts.slice(i)], i, 'Aggiungi punto della modulazione', true);
      }
      this.drag.move(x, y, e.altKey, false);
      if (!this.drawMode && (hit >= 0 || inRange)) this.drag.changed = false; // un clic su un punto non lo sposta
      this.invalidate();
    });
    canvas.addEventListener('pointermove', e => {
      this.hover = pos(e);
      if (this.drag) {
        this.drag.move(this.hover.x, this.hover.y, e.altKey, e.shiftKey);
        if (!this.drag.sweep) this.drag.changed = true;
      }
      canvas.style.cursor = this.cursor(this.hover.x, this.hover.y, e.shiftKey);
      this.invalidate();
    });
    const finish = (apply: boolean) => {
      const d = this.drag;
      this.drag = null;
      if (apply && d?.changed) this.commit(d.label, d.points);
      if (!apply) d?.cancel?.();
      // un clic con Maiusc non sceglie niente
      if (d?.sweep && this.range && this.range.to - this.range.from < EPS) this.range = null;
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
      const beat = this.snap(this.host.axis.xToBeat(x), false), copied = !!this.host.clipboard.envelope;
      const what = this.range ? 'il tratto' : 'la curva';
      showContextMenu(e.clientX, e.clientY, [
        { label: `Taglia ${what}`, shortcut: KEY.cut, disabled: !pts.length, run: () => { if (this.copy()) this.clear('Taglia modulazione'); } },
        { label: `Copia ${what}`, shortcut: KEY.copy, disabled: !pts.length, run: () => this.copy() },
        { label: 'Incolla qui', disabled: !copied, run: () => this.paste(beat) },
        { label: 'Incolla nello stesso punto', shortcut: KEY.paste, disabled: !copied, run: () => this.paste() },
        SEPARATOR,
        { label: 'Elimina il punto', disabled: i < 0, run: () => this.commit('Elimina punto della modulazione', pts.filter((_, k) => k !== i)) },
        { label: this.range ? 'Cancella il tratto' : 'Cancella la modulazione', disabled: !pts.length, run: () => this.clear('Cancella modulazione') },
        SEPARATOR,
        { label: 'Disegno a scalini', shortcut: KEY.draw, checked: this.drawMode, run: () => this.setDraw(!this.drawMode) },
        { label: 'Forme pronte', shortcut: KEY.shapes, checked: this.shapes, run: () => this.setShapes(!this.shapes) },
      ]);
    });
    canvas.addEventListener('keydown', e => this.key(e));
    canvas.addEventListener('wheel', e => this.host.wheel(e, pos(e).x), { passive: false });
  }

  private cursor(x: number, y: number, shift: boolean): string {
    if (this.drawMode) return 'crosshair';
    if (shift) return 'text';
    const beat = this.host.axis.xToBeat(x), r = this.range;
    if (r && beat >= r.from && beat <= r.to) return 'move';
    return this.pointAt(x, y) >= 0 ? 'move' : 'copy';
  }

  // ---------------------------------------------------------------- disegno

  private paint(curves: LaneCurves | null, playhead: Beats | null): void {
    const { g, width: w, height: h } = this.surface;
    const target = this.target!, axis = this.host.axis, scale = this.scale;
    g.fillStyle = '#15171a';
    g.fillRect(0, 0, w, h);
    if (!curves) return;
    paintBeatGrid(g, axis, w, 0, h, this.host.grid(), this.host.signature());
    // fuori da ciò che suona: più scuro
    const span = this.host.span?.();
    if (span) {
      const x0 = axis.beatToX(span.start), x1 = axis.beatToX(span.end);
      g.fillStyle = 'rgba(0,0,0,0.42)';
      g.fillRect(0, 0, Math.max(0, x0), h);
      g.fillRect(x1, 0, Math.max(0, w - x1), h);
    }
    // la linea neutra (nessuna modulazione)
    const ny = Math.round(this.valueToY(scale.neutral)) + 0.5;
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(0, ny);
    g.lineTo(w, ny);
    g.stroke();
    g.setLineDash([]);
    if (this.range) {
      const x0 = axis.beatToX(this.range.from), x1 = axis.beatToX(this.range.to);
      g.fillStyle = 'rgba(255,255,255,0.1)';
      g.fillRect(x0, 0, x1 - x0, h);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillRect(Math.round(x0), 0, 1, h);
      g.fillRect(Math.round(x1), 0, 1, h);
    }
    const pts = this.points(), color = curves.color;
    g.font = '10.5px system-ui, sans-serif';
    if (!pts.length) {
      g.fillStyle = COLORS.rulerText;
      g.fillText(this.drawMode ? 'Trascina per disegnare a scalini · con Alt a mano libera · B per uscire' : 'Clic: un punto · B: disegna · F: forme pronte · Maiusc+trascina: scegli un tratto · Ctrl+V: incolla', 8, h - 8);
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
      this.paintHeardChoice(pts, w);
      const hot = this.hover ? this.pointAt(this.hover.x, this.hover.y) : -1;
      let shown: { x: number; y: number } | null = null;
      xs.forEach((x, i) => {
        if (x < -4 || x > w + 4) return;
        if (i !== hot && shown && Math.hypot(x - shown.x, ys[i] - shown.y) < HANDLE_GAP_PX) return;
        shown = { x, y: ys[i] };
        g.fillStyle = i === hot ? '#ffffff' : color;
        g.fillRect(Math.round(x) - 3, Math.round(ys[i]) - 3, 7, 7);
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.strokeRect(Math.round(x) - 2.5, Math.round(ys[i]) - 2.5, 6, 6);
      });
    }
    // il valore sotto il puntatore (o del punto trascinato)
    if (this.hover) {
      const v = this.drag ? null : this.yToValue(this.hover.y);
      const chain = this.host.chain?.() ?? null;
      const text = formatModValue(target, v ?? envelopeValueAt(pts, axis.xToBeat(this.hover.x)), chain);
      g.fillStyle = '#e8eaee';
      g.fillText(text, Math.min(w - 110, this.hover.x + 10), Math.max(12, Math.min(h - 4, this.hover.y - 6)));
    }
    if (playhead !== null) {
      g.fillStyle = COLORS.playhead;
      g.fillRect(Math.round(axis.beatToX(playhead)) - 0.5, 0, 2, h);
    }
  }

  /** Per una scelta (un interruttore, un menu): a scalini, l'opzione che si sente davvero con la
   *  curva e la manopola dov'è, all'altezza in cui quell'opzione è esatta. */
  private paintHeardChoice(pts: readonly EnvelopePoint[], w: number): void {
    const chain = this.host.chain?.(), target = this.target;
    const choice = chain && target ? choiceTarget(chain, target) : null;
    if (!choice) return;
    const { g } = this.surface, axis = this.host.axis, last = choice.spec.options.length - 1;
    const yOf = (option: number) => this.valueToY((last ? option / last : 0) - choice.baseUnit);
    g.beginPath();
    let prev = -1;
    for (let x = 0; x <= w; x += 2) {
      const option = choice.heard(envelopeValueAt(pts, axis.xToBeat(x)));
      if (prev < 0) g.moveTo(x, yOf(option));
      else if (option !== prev) g.lineTo(x, yOf(prev));
      g.lineTo(x, yOf(option));
      prev = option;
    }
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.setLineDash([3, 3]);
    g.stroke();
    g.setLineDash([]);
  }
}
