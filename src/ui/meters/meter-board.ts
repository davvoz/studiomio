/* I misuratori di livello nell'interfaccia: un ciclo di disegno per tutti (a ogni fotogramma
 * legge i livelli di ogni traccia una volta sola e aggiorna chi li mostra). */
import type { MeterReading } from '../../engine/meters';
import { SILENT } from '../../engine/meters';
import type { ChainOwner } from '../../model/project';
import { Ballistics, FLOOR_DB, meterPosition } from './ballistics';

/** Qualcosa che mostra un misuratore: la barra, o il numero del master. */
export interface MeterView {
  /** Fuori dalla pagina non si disegna (e la vista si stacca da sola). */
  readonly element: HTMLElement;
  draw(b: Ballistics): void;
}

interface Entry {
  readonly ballistics: Ballistics;
  readonly views: Set<MeterView>;
  /** Disegnato vuoto l'ultima volta: finché resta vuoto non serve ridisegnare. */
  drawnIdle: boolean;
}

/** Legge i livelli e li distribuisce. `levels` dà i livelli dall'ultima lettura (null se mancano). */
export class MeterBoard {
  private readonly entries = new Map<ChainOwner, Entry>();
  private last = 0;

  constructor(private readonly levels: (owner: ChainOwner) => MeterReading | null) {
    const frame = (t: number) => {
      this.frame(t);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** Mostra i livelli di `owner` in `view`; restituisce come staccarla. */
  attach(owner: ChainOwner, view: MeterView): () => void {
    let e = this.entries.get(owner);
    if (!e) this.entries.set(owner, (e = { ballistics: new Ballistics(), views: new Set(), drawnIdle: false }));
    e.views.add(view);
    e.drawnIdle = false;
    const entry = e;
    return () => {
      entry.views.delete(view);
      if (!entry.views.size && this.entries.get(owner) === entry) this.entries.delete(owner);
    };
  }

  /** Spegne il clip (e il massimo) di `owner`. */
  resetClip(owner: ChainOwner): void {
    const e = this.entries.get(owner);
    if (!e) return;
    e.ballistics.resetClip();
    e.drawnIdle = false;
  }

  private frame(t: number): void {
    const dt = this.last ? Math.min(0.25, (t - this.last) / 1000) : 0;
    this.last = t;
    for (const [owner, e] of this.entries) {
      e.ballistics.update(this.levels(owner) ?? SILENT, dt);
      const idle = e.ballistics.idle && !e.ballistics.clip;
      if (idle && e.drawnIdle) continue;
      for (const v of e.views) if (v.element.isConnected) v.draw(e.ballistics);
      e.drawnIdle = idle;
    }
  }
}

/** I colori lungo la scala: verde, giallo verso −6 dB, arancio e rosso vicino allo 0. */
const STOPS: readonly (readonly [db: number, color: string])[] = [
  [FLOOR_DB, '#2f9e5a'], [-18, '#3ec46d'], [-6, '#e5c84a'], [-1, '#ff9d2e'], [0, '#ff4d4d'],
];

/** Barra verticale stereo: RMS pieno, picco più chiaro, segno del massimo, spia del clip in
 *  cima (un clic la spegne). */
export class LevelMeter implements MeterView {
  readonly element: HTMLCanvasElement;
  private gradient: { height: number; fill: CanvasGradient } | null = null;

  constructor(className: string, onReset: () => void) {
    this.element = Object.assign(document.createElement('canvas'), { className: `level-meter ${className}`, title: 'Livello (un clic spegne il clip)' });
    this.element.addEventListener('pointerdown', e => {
      e.stopPropagation();
      onReset();
    });
  }

  draw(b: Ballistics): void {
    const c = this.element, dpr = window.devicePixelRatio || 1;
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) Object.assign(c, { width: w, height: h });
    const g = c.getContext('2d')!;
    const clipH = Math.round(3 * dpr), gap = Math.max(1, Math.round(dpr));
    const top = clipH + gap, span = h - top;
    const y = (db: number) => top + span * (1 - meterPosition(db));
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(0, 0, 0, 0.4)';
    g.fillRect(0, 0, w, h);
    g.fillStyle = this.fill(g, top, h);
    const barW = Math.floor((w - gap) / 2);
    for (const ch of [0, 1]) {
      const x = ch * (barW + gap);
      g.globalAlpha = 0.45;
      g.fillRect(x, y(b.peak[ch]), barW, h - y(b.peak[ch]));
      g.globalAlpha = 1;
      g.fillRect(x, y(b.rms[ch]), barW, h - y(b.rms[ch]));
      if (b.hold[ch] > FLOOR_DB) g.fillRect(x, Math.round(y(b.hold[ch])), barW, gap);
    }
    // lo zero e la spia del clip
    g.fillStyle = 'rgba(255, 255, 255, 0.25)';
    g.fillRect(0, Math.round(y(0)), w, gap);
    g.fillStyle = b.clip ? '#ff4d4d' : 'rgba(255, 255, 255, 0.08)';
    g.fillRect(0, 0, w, clipH);
  }

  private fill(g: CanvasRenderingContext2D, top: number, height: number): CanvasGradient {
    if (this.gradient?.height !== height) {
      const fill = g.createLinearGradient(0, height, 0, top);
      for (const [db, color] of STOPS) fill.addColorStop(meterPosition(db), color);
      this.gradient = { height, fill };
    }
    return this.gradient.fill;
  }
}

/** Il picco massimo in numero (sul master): rosso se ha toccato 0 dB, un clic lo azzera. */
export class PeakReadout implements MeterView {
  readonly element: HTMLElement;
  private shown = '';

  constructor(onReset: () => void) {
    this.element = Object.assign(document.createElement('button'), { className: 'peak-readout', title: 'Picco massimo (un clic lo azzera)' });
    this.element.addEventListener('click', e => {
      e.stopPropagation();
      onReset();
    });
    this.draw(new Ballistics());
  }

  draw(b: Ballistics): void {
    const text = b.max <= FLOOR_DB ? '−∞' : `${b.max > 0 ? '+' : b.max < 0 ? '−' : ''}${Math.abs(b.max).toFixed(1)}`;
    if (text === this.shown && this.element.classList.contains('clip') === b.clip) return;
    this.shown = text;
    this.element.textContent = text;
    this.element.classList.toggle('clip', b.clip);
  }
}
