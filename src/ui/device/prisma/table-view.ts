/* La tabella di un oscillatore di Prisma, disegnata come in Serum: tutte le forme in fila una
 * dietro l'altra e quella che suona alla posizione attuale in evidenza, piegata dal warp.
 * Trascinarla in verticale sposta la posizione (Maiusc: fine); un file audio lasciato sopra
 * diventa la tabella dell'oscillatore. */
import type { SampleData } from '../../../devices/dsp/core';
import { WARP, type OscKey } from '../../../devices/instruments/prisma/prisma';
import { cyclesOf, FRAMES, LEVELS, STRIDE, TABLE_SIZE, wavetable } from '../../../devices/instruments/wavetable/tables';
import type { ParamValues } from '../../../model/device';
import { el } from '../../dom';
import { ACCENT, BACKGROUND, fit, LABEL } from './canvas';

/** Punti per forma nel disegno, e forme disegnate al massimo (di una tabella lunga se ne
 *  saltano alcune). */
const POINTS = 96;
const MAX_DRAWN = 24;
/** Quanta altezza vale tutta la posizione, trascinando. */
const DRAG_PIXELS = 150;

/** Le forme di una tabella, da leggere per disegnarle. */
export interface Frames {
  readonly count: number;
  /** Il campione della forma `f` a `t` (0…1). */
  sample(f: number, t: number): number;
}

export function builtInFrames(index: number): Frames {
  const data = wavetable(index);
  return { count: FRAMES, sample: (f, t) => data[f * LEVELS * STRIDE + Math.min(TABLE_SIZE - 1, Math.floor(t * TABLE_SIZE))] };
}

const imported = new WeakMap<SampleData, Frames>();

/** Le forme di un file importato, come le legge il motore (ognuna portata a ±1). */
export function importedFrames(sample: SampleData): Frames {
  let frames = imported.get(sample);
  if (!frames) {
    const cycles = cyclesOf(sample.channels).map(c => {
      const peak = c.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      return peak > 1e-9 ? c.map(v => v / peak) : c;
    });
    frames = { count: cycles.length, sample: (f, t) => cycles[f]?.[Math.min(TABLE_SIZE - 1, Math.floor(t * TABLE_SIZE))] ?? 0 };
    imported.set(sample, frames);
  }
  return frames;
}

const frac = (x: number) => x - Math.floor(x);

/** La forma piegata dal warp, come la legge il motore (quelli che prendono l'altro
 *  oscillatore si disegnano senza: dipendono da lui). */
export function warped(read: (p: number) => number, warp: number, a: number, p: number): number {
  switch (warp) {
    case WARP.sync: return read(frac(p * (1 + 15 * a)));
    case WARP.softSync: return read(frac(p * (1 + 15 * a))) * 4 * p * (1 - p);
    case WARP.bendUp: case WARP.bendDown: {
      const e = Math.pow(2, warp === WARP.bendUp ? -4 * a : 4 * a);
      return read(p / (p + (1 - p) * e));
    }
    case WARP.bendBoth: {
      const k = Math.pow(2, -4 * a), h = p < 0.5 ? 2 * p : 2 * p - 1, e = p < 0.5 ? k : 1 / k;
      return read(Math.min(0.99999, (p < 0.5 ? 0 : 0.5) + 0.5 * (h / (h + (1 - h) * e))));
    }
    case WARP.pwm: {
      const w = 1 - 0.95 * a;
      return p < w ? read(p / w) : 0;
    }
    case WARP.asymUp: case WARP.asymDown: {
      const m = warp === WARP.asymUp ? 0.5 + 0.48 * a : 0.5 - 0.48 * a;
      return read(p < m ? (0.5 * p) / m : 0.5 + (0.5 * (p - m)) / (1 - m));
    }
    case WARP.mirror: return read(p) * (1 - a) + read(Math.min(0.99999, p < 0.5 ? 2 * p : 2 - 2 * p)) * a;
    case WARP.flip: return p >= 1 - a ? -read(p) : read(p);
    case WARP.quantize: {
      const k = Math.pow(2, 10 - 9 * a);
      return Math.round(read(p) * k) / k;
    }
    default: return read(p);
  }
}

export class TableView {
  readonly canvas = el<HTMLCanvasElement>('canvas', {
    className: 'prisma-table', title: 'Trascina in verticale per spostare la posizione (Maiusc: fine) · lascia qui un file WAV per importarlo',
  });
  private drag: { y: number; pos: number } | null = null;

  constructor(
    private readonly osc: OscKey,
    private readonly values: () => Readonly<Record<string, number>>,
    private readonly set: (values: ParamValues, final: boolean) => void,
    private readonly frames: () => Frames,
    importFile: (file: File) => void,
  ) {
    const c = this.canvas, pos = `${osc}Pos`;
    c.onpointerdown = e => {
      if (e.button !== 0 || e.altKey) return;
      c.setPointerCapture(e.pointerId);
      this.drag = { y: e.clientY, pos: this.values()[pos] };
    };
    c.onpointermove = e => {
      if (!this.drag) return;
      const scale = e.shiftKey ? 0.2 : 1;
      this.drag = { y: e.clientY, pos: Math.max(0, Math.min(100, this.drag.pos + ((this.drag.y - e.clientY) / DRAG_PIXELS) * 100 * scale)) };
      this.set({ [pos]: Math.round(this.drag.pos) }, false);
    };
    c.onpointerup = c.onpointercancel = () => {
      if (!this.drag) return;
      this.drag = null;
      this.set({ [pos]: this.values()[pos] }, true);
    };
    const files = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    c.addEventListener('dragover', e => {
      if (!files(e)) return;
      e.preventDefault();
      c.classList.add('drop');
    });
    c.addEventListener('dragleave', () => c.classList.remove('drop'));
    c.addEventListener('drop', e => {
      c.classList.remove('drop');
      const file = [...(e.dataTransfer?.files ?? [])].find(f => f.type.startsWith('audio') || /\.(wav|aiff?|flac|mp3|ogg)$/i.test(f.name));
      if (!file) return;
      e.preventDefault();
      importFile(file);
    });
  }

  /** `hint`: una riga in basso (es. come importare un file). */
  paint(enabled: boolean, tableName: string, hint = ''): void {
    const g = fit(this.canvas);
    if (!g) return;
    const v = this.values(), o = this.osc, w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const frames = this.frames(), pos = v[`${o}Pos`] / 100, on = v[`${o}On`] === 1;
    const count = frames.count, last = Math.max(1, count - 1);
    // le forme in fila: la prima davanti in basso a sinistra, l'ultima dietro in alto a destra
    const waveW = w * 0.68, amp = h * 0.2, x0 = 8, y0 = h * 0.7;
    const dx = (w - waveW - 16) / last, dy = (h * 0.42) / last;
    const path = (at: number, value: (t: number) => number) => {
      const p = new Path2D(), ox = x0 + at * dx, oy = y0 - at * dy;
      for (let i = 0; i <= POINTS; i++) {
        const t = i / POINTS, x = ox + t * waveW, y = oy - value(Math.min(0.9999, t)) * amp;
        if (i) p.lineTo(x, y);
        else p.moveTo(x, y);
      }
      return p;
    };
    g.fillStyle = BACKGROUND;
    g.fillRect(0, 0, w, h);
    g.globalAlpha = enabled && on ? 1 : 0.45;
    g.lineWidth = 1;
    const every = Math.max(1, Math.ceil(count / MAX_DRAWN));
    for (let f = count - 1; f >= 0; f--) {
      if (f % every && f !== count - 1) continue;
      g.strokeStyle = `rgba(255,255,255,${0.06 + 0.08 * (1 - f / last)})`;
      g.stroke(path(f, t => frames.sample(f, t)));
    }
    // la forma che suona: fra le due vicine, piegata dal warp
    const x = pos * last, f = Math.min(Math.max(0, count - 2), Math.floor(x)), mix = count > 1 ? x - f : 0;
    const read = (t: number) => frames.sample(f, t) * (1 - mix) + (count > 1 ? frames.sample(f + 1, t) * mix : 0);
    const warp = v[`${o}Warp`], amount = v[`${o}WarpAmt`] / 100;
    g.strokeStyle = v[`${o}Level`] > 0 ? ACCENT : 'rgba(255,157,46,0.45)';
    g.lineWidth = 2;
    g.stroke(path(x, t => warped(read, warp, amount, t)));
    g.globalAlpha = 1;
    g.font = '10px system-ui, sans-serif';
    g.fillStyle = LABEL;
    g.fillText(tableName, 6, 13);
    g.textAlign = 'right';
    const frame = count > 1 ? ` · ${Math.round(x) + 1}/${count}` : '';
    g.fillText(`${Math.round(pos * 100)} %${frame}`, w - 6, 13);
    if (hint) {
      g.textAlign = 'center';
      g.fillText(hint, w / 2, h - 8);
    }
    g.textAlign = 'left';
  }
}
