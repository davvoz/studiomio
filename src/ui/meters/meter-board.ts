/* The level meters in the interface: one drawing loop for all (at every frame
 * it reads each track's levels once and updates whoever shows them). */
import type { MeterReading } from '../../engine/meters';
import { SILENT } from '../../engine/meters';
import type { ChainOwner } from '../../model/project';
import { Ballistics, FLOOR_DB, meterPosition } from './ballistics';

/** Something showing a meter: the bar, or the master's number. */
export interface MeterView {
  /** Outside the page it isn't drawn (and the view detaches by itself). */
  readonly element: HTMLElement;
  draw(b: Ballistics): void;
}

interface Entry {
  readonly ballistics: Ballistics;
  readonly views: Set<MeterView>;
  /** Drawn empty last time: while it stays empty there's no need to redraw. */
  drawnIdle: boolean;
}

/** Reads the levels and distributes them. `levels` gives the levels since the last read (null if missing). */
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

  /** Shows `owner`'s levels in `view`; returns how to detach it. */
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

  /** Turns off `owner`'s clip (and maximum). */
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

/** The colours along the scale: green, yellow towards −6 dB, orange and red near 0. */
const STOPS: readonly (readonly [db: number, color: string])[] = [
  [FLOOR_DB, '#2f9e5a'], [-18, '#3ec46d'], [-6, '#e5c84a'], [-1, '#ff9d2e'], [0, '#ff4d4d'],
];

/** Vertical stereo bar: full RMS, lighter peak, maximum mark, clip light at the
 *  top (a click turns it off). */
export class LevelMeter implements MeterView {
  readonly element: HTMLCanvasElement;
  private gradient: { height: number; fill: CanvasGradient } | null = null;

  constructor(className: string, onReset: () => void) {
    this.element = Object.assign(document.createElement('canvas'), { className: `level-meter ${className}`, title: 'Level (a click turns off the clip)' });
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
    // the zero and the clip light
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

/** The maximum peak as a number (on the master): red if it touched 0 dB, a click resets it. */
export class PeakReadout implements MeterView {
  readonly element: HTMLElement;
  private shown = '';

  constructor(onReset: () => void) {
    this.element = Object.assign(document.createElement('button'), { className: 'peak-readout', title: 'Maximum peak (a click resets it)' });
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
