/* La cornice comune agli editor delle clip (audio e piano roll): asse dei battiti, righello
 * con loop e bandierine, griglia, e i gesti che li modificano. Ogni editor ci aggiunge il
 * suo contenuto (forma d'onda, note). */
import type { Beats, TimeSignature } from '../../core/music-time';
import type { Clip } from '../../model/clip';
import { dragLoop, LOOP_CURSOR, loopPartAt, type BeatRange, type LoopPart } from '../loop-drag';
import type { Pointer } from '../timeline/gestures';
import { snapTo } from '../timeline/geometry';
import { COLORS } from '../timeline/painters';
import { withLoopSafe, withRegionSafe, type BeatAxis } from './clip-geometry';

/** Fasce del righello, dall'alto. */
export const FRAME = { loopBand: 10, ruler: 28 } as const;

/** Ciò che i gesti della cornice usano dell'editor. */
export interface ClipHost<C extends Clip> {
  readonly axis: BeatAxis;
  /** Passo di aggancio per questo puntatore, o null se l'aggancio è spento. */
  snapStep(p: Pointer): Beats | null;
  /** Applica una modifica alla clip (un passo di annullamento). */
  commit(label: string, fn: (c: C) => C): void;
  /** Sposta il cursore della timeline dove la clip suona il battito `content`. */
  seekContent(content: Beats): void;
  setAxis(axis: BeatAxis): void;
  invalidate(): void;
}

/** Un trascinamento in un editor: `preview` mostra la clip come sarebbe al rilascio. */
export interface ClipGesture<C extends Clip> {
  readonly cursor: string;
  move(p: Pointer): void;
  end(p: Pointer): void;
  cancel(): void;
  preview(clip: C): C;
}

export type FrameHit =
  | { readonly kind: 'loop'; readonly part: LoopPart }
  | { readonly kind: 'flag'; readonly edge: 'start' | 'end' }
  | { readonly kind: 'ruler' };

const FLAG_PX = 8, CLICK_PX = 3;
/** Lunghezza delle tacche del righello per livello (battuta, battito, mezzo, il resto). */
const TICK_PX = [18, 8, 5, 3];

/** Cosa c'è sotto il puntatore nel righello, o null se il puntatore è più in basso. */
export function frameHit(axis: BeatAxis, clip: Clip, x: number, y: number): FrameHit | null {
  if (y < FRAME.loopBand) return { kind: 'loop', part: loopPartAt(clip.loop, x, b => axis.beatToX(b)) };
  if (y >= FRAME.ruler) return null;
  const xs = axis.beatToX(clip.region.start), xe = axis.beatToX(clip.region.end);
  if (Math.abs(xs - x) < FLAG_PX && x >= xs - 2) return { kind: 'flag', edge: 'start' };
  if (Math.abs(xe - x) < FLAG_PX) return { kind: 'flag', edge: 'end' };
  return { kind: 'ruler' };
}

export const moved = (a: Pointer, b: Pointer): boolean => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) >= CLICK_PX;

export const snappedBeat = <C extends Clip>(host: ClipHost<C>, p: Pointer, b: Beats): Beats => {
  const s = host.snapStep(p);
  return s ? snapTo(b, s) : b;
};

/** Trascinare la bandierina di inizio o di fine della clip. */
export class FlagGesture<C extends Clip> implements ClipGesture<C> {
  readonly cursor = 'ew-resize';
  private beat: Beats | null = null;

  constructor(private readonly host: ClipHost<C>, private readonly edge: 'start' | 'end') {}

  move(p: Pointer): void {
    this.beat = snappedBeat(this.host, p, this.host.axis.xToBeat(p.x));
    this.host.invalidate();
  }

  end(): void {
    if (this.beat === null) return;
    this.host.commit(this.edge === 'start' ? 'Inizio della clip' : 'Fine della clip', c => this.apply(c));
  }

  cancel(): void {
    this.beat = null;
    this.host.invalidate();
  }

  preview(clip: C): C {
    return this.beat === null ? clip : this.apply(clip);
  }

  private apply(c: C): C {
    const b = this.beat!;
    return this.edge === 'start' ? withRegionSafe(c, b, c.region.end) : withRegionSafe(c, c.region.start, b);
  }
}

/** Fascia del loop della clip: bordi, corpo e fuori come sul righello della timeline; un clic lo accende o spegne. */
export class LoopBandGesture<C extends Clip> implements ClipGesture<C> {
  readonly cursor: string;
  private dragged = false;
  private range: BeatRange | null = null;
  private readonly anchor: Beats;

  constructor(private readonly host: ClipHost<C>, private readonly original: BeatRange, private readonly part: LoopPart, private readonly origin: Pointer) {
    this.anchor = snappedBeat(host, origin, host.axis.xToBeat(origin.x));
    this.cursor = part === 'body' ? 'grabbing' : LOOP_CURSOR[part];
  }

  move(p: Pointer): void {
    if (!this.dragged && !moved(p, this.origin)) return;
    this.dragged = true;
    this.range = dragLoop(this.part, this.original, this.anchor, snappedBeat(this.host, p, this.host.axis.xToBeat(p.x))) ?? this.range;
    this.host.invalidate();
  }

  end(): void {
    const r = this.range;
    if (!this.dragged) return this.host.commit('Loop della clip', c => withLoopSafe(c, c.loop.start, c.loop.end, !c.loop.enabled));
    if (r) this.host.commit('Loop della clip', c => withLoopSafe(c, r.start, r.end));
  }

  cancel(): void {
    this.range = null;
    this.host.invalidate();
  }

  preview(clip: C): C {
    const r = this.range;
    return r ? withLoopSafe(clip, r.start, r.end) : clip;
  }
}

/** Trascinare sposta la vista. Sul righello (`seekOnClick`) un clic porta lì il cursore
 *  della timeline; altrove un clic non fa nulla, per non interrompere la riproduzione. */
export class PanGesture<C extends Clip> implements ClipGesture<C> {
  readonly cursor = 'grabbing';
  private dragged = false;
  private readonly start: BeatAxis;

  constructor(private readonly host: ClipHost<C>, private readonly origin: Pointer, private readonly seekOnClick = false) {
    this.start = host.axis;
  }

  move(p: Pointer): void {
    if (!this.dragged && !moved(p, this.origin)) return;
    this.dragged = true;
    this.host.setAxis(this.start.scrolled(this.start.startBeat - (p.x - this.origin.x) / this.start.pxPerBeat));
  }

  end(p: Pointer): void {
    if (!this.dragged && this.seekOnClick) this.host.seekContent(this.host.axis.xToBeat(p.x));
  }

  cancel(): void { /* niente */ }

  preview(clip: C): C {
    return clip;
  }
}

/** Nessun effetto. */
export class IdleGesture<C extends Clip> implements ClipGesture<C> {
  readonly cursor = 'default';
  move(): void { /* niente */ }
  end(): void { /* niente */ }
  cancel(): void { /* niente */ }
  preview(clip: C): C {
    return clip;
  }
}

/** Il gesto che parte premendo su ciascuna parte del righello. */
export const frameGestureFor: { readonly [K in FrameHit['kind']]: <C extends Clip>(host: ClipHost<C>, clip: C, hit: Extract<FrameHit, { kind: K }>, p: Pointer) => ClipGesture<C> } = {
  loop: (h, c, hit, p) => new LoopBandGesture(h, c.loop, hit.part, p),
  flag: (h, _c, hit) => new FlagGesture(h, hit.edge),
  ruler: (h, _c, _hit, p) => new PanGesture(h, p, true),
};

export const frameCursor: { readonly [K in FrameHit['kind']]: (hit: Extract<FrameHit, { kind: K }>) => string } = {
  loop: hit => LOOP_CURSOR[hit.part],
  flag: () => 'ew-resize',
  ruler: () => 'pointer',
};

// ------------------------------------------------------------------ disegno

/** Intensità delle linee della griglia, come in Live: battuta, battito (il quarto), mezzo
 *  battito, suddivisioni più fini. */
const GRID_LINE = ['rgba(255,255,255,0.24)', 'rgba(255,255,255,0.13)', 'rgba(255,255,255,0.075)', 'rgba(255,255,255,0.04)'];
/** Le fasce alternate, una sì e una no. */
const GRID_BAND = 'rgba(255,255,255,0.045)';

/** Livello del battito `b` nella griglia: 0 battuta, 1 battito, 2 mezzo battito, 3 il resto. */
export function beatLevel(b: Beats, beatsPerBar: number): 0 | 1 | 2 | 3 {
  const on = (step: number) => Math.abs(b / step - Math.round(b / step)) < 1e-6;
  return on(beatsPerBar) ? 0 : on(1) ? 1 : on(0.5) ? 2 : 3;
}

/** Larghezza delle fasce alternate per una griglia di passo `grid`: il battito finché la
 *  griglia lo divide, poi la battuta, poi gruppi di 4 battute. */
export function gridBand(grid: Beats, beatsPerBar: number): Beats {
  const bands = [1, beatsPerBar, 4 * beatsPerBar, 16 * beatsPerBar, 64 * beatsPerBar];
  return bands.find(s => s >= 2 * grid - 1e-9) ?? bands[bands.length - 1];
}

/** Griglia verticale da `top` in giù, come in Live: fasce alternate (i battiti, o le battute
 *  da lontano) e linee più marcate per battute, battiti e mezzi battiti. */
export function paintBeatGrid(
  g: CanvasRenderingContext2D, axis: BeatAxis, width: number, top: number, height: number, grid: Beats, signature: TimeSignature,
): void {
  const bar = signature.beatsPerBar, band = gridBand(grid, bar);
  g.fillStyle = GRID_BAND;
  for (let i = Math.floor(axis.xToBeat(0) / band); axis.beatToX(i * band) < width; i++) {
    if (i % 2 === 0) continue;
    const x0 = Math.round(axis.beatToX(i * band)), x1 = Math.round(axis.beatToX((i + 1) * band));
    g.fillRect(x0, top, x1 - x0, height - top);
  }
  for (let i = Math.floor(axis.xToBeat(0) / grid); axis.beatToX(i * grid) < width; i++) {
    g.fillStyle = GRID_LINE[beatLevel(i * grid, bar)];
    g.fillRect(Math.round(axis.beatToX(i * grid)), top, 1, height - top);
  }
}

/** Righello: loop della clip, numeri di battuta, bandierine di inizio e fine. */
export function paintClipRuler(g: CanvasRenderingContext2D, axis: BeatAxis, width: number, clip: Clip, signature: TimeSignature): void {
  g.fillStyle = COLORS.ruler;
  g.fillRect(0, 0, width, FRAME.ruler);
  const lx0 = axis.beatToX(clip.loop.start), lx1 = axis.beatToX(clip.loop.end);
  g.fillStyle = clip.loop.enabled ? COLORS.loop : COLORS.loopOff;
  g.fillRect(lx0, 1, lx1 - lx0, FRAME.loopBand - 2);
  // tacche sotto i numeri: più lunghe sui battiti che sulle suddivisioni
  const bar = signature.beatsPerBar;
  const tick = [0.25, 0.5, 1, bar].find(s => s * axis.pxPerBeat >= 6) ?? bar;
  g.fillStyle = '#4a4f58';
  for (let i = Math.floor(axis.xToBeat(0) / tick); axis.beatToX(i * tick) < width; i++) {
    const h = TICK_PX[beatLevel(i * tick, bar)];
    g.fillRect(Math.round(axis.beatToX(i * tick)), FRAME.ruler - h, 1, h);
  }
  // numeri di battuta (o battuta.tempo se lo zoom lo permette)
  const label = [0.25, 1, bar, 2 * bar, 4 * bar, 8 * bar, 16 * bar, 32 * bar].find(s => s * axis.pxPerBeat >= 44) ?? 32 * bar;
  g.font = '10.5px system-ui, sans-serif';
  for (let b = Math.floor(axis.xToBeat(0) / label) * label; axis.beatToX(b) < width; b += label) {
    const x = Math.round(axis.beatToX(b));
    g.fillStyle = '#5d636d';
    g.fillRect(x, FRAME.loopBand, 1, FRAME.ruler - FRAME.loopBand);
    const text = label >= bar ? String(Math.floor(b / bar + 1e-9) + 1) : signature.format(b).split('.').slice(0, label >= 1 ? 2 : 3).join('.');
    g.fillStyle = COLORS.rulerText;
    g.fillText(text, x + 3, FRAME.ruler - 6);
  }
  flag(g, axis.beatToX(clip.region.start), 1);
  flag(g, axis.beatToX(clip.region.end), -1);
}

/** Triangolo che punta verso l'interno della regione (dir 1 = inizio, −1 = fine). */
function flag(g: CanvasRenderingContext2D, x: number, dir: 1 | -1): void {
  const y0 = FRAME.loopBand, y1 = FRAME.ruler;
  g.fillStyle = '#e8eaee';
  g.beginPath();
  g.moveTo(x, y0);
  g.lineTo(x + 9 * dir, y0 + (y1 - y0) / 2);
  g.lineTo(x, y1);
  g.closePath();
  g.fill();
  g.fillRect(Math.round(x) - (dir > 0 ? 0 : 1), y0, 1, y1 - y0);
}
