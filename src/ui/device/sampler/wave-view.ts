/* The Sampler's waveform, as in Simpler: the playing region (Start…End) lit and the
 * rest dark, the loop as a band with its two markers at the bottom and the crossfade drawn,
 * the slices numbered, and a cursor for each playing voice. The markers are dragged (Shift: fine);
 * the loop band is dragged all together. The wheel zooms around the pointer,
 * Shift+wheel scrolls; double click on empty space goes back to the whole sample. In Slice a click on a
 * slice plays it; with the slices at the transients double click adds one (or, on a marker,
 * removes it). With Reverse the sample is shown reversed and the positions apply there. */
import { clamp01 } from '../../../core/math';
import type { SampleData } from '../../../devices/dsp/core';
import { LOOP, MODE, SLICE, SLICE_COUNT, sliceParam, sliceStarts, sliceValues } from '../../../devices/instruments/sampler/sampler';
import type { ParamValues } from '../../../model/device';
import { Peaks } from '../../waveform';
import { BACKGROUND, drag, fit, GRID, LABEL } from '../prisma/canvas';

const START_COLOR = '#ff9d2e';
const LOOP_COLOR = '#f2d14b';
const SLICE_COLOR = '#4fd1e0';
const WAVE_ON = 'rgba(255,190,120,0.9)';
const WAVE_OFF = 'rgba(255,255,255,0.16)';
/** The marker strip at the top (Start, End, slices) and the loop's at the bottom. */
const TOP = 15, BOTTOM = 13;
const HIT = 6;
/** The tightest zoom: this fraction of the sample. */
const MIN_SPAN = 0.0005;

/** A marker: a position with its parameter (the slices: the parameter's number). */
type Marker = { readonly kind: 'start' | 'end' | 'loopStart' | 'loopEnd' } | { readonly kind: 'slice'; readonly param: number };

export interface WaveHost {
  values(): Readonly<Record<string, number>>;
  audio(): SampleData | undefined;
  /** The sample's name, or null if there isn't one. */
  name(): string | null;
  set(values: ParamValues, final: boolean): void;
  /** Plays slice `index` (from 0). */
  playSlice(index: number): void;
  playheads(): readonly number[];
  menu(x: number, y: number): void;
}

const round = (pct: number) => Math.round(pct * 1000) / 1000;

export class WaveView {
  readonly canvas = document.createElement('canvas');
  private v0 = 0;
  private v1 = 1;
  private peaks: { data: SampleData; forward: Peaks; reversed: Peaks } | null = null;
  private hot: Marker | 'loop' | null = null;
  private heads: readonly number[] = [];
  private enabled = true;

  constructor(private readonly host: WaveHost) {
    const c = this.canvas;
    c.className = 'smp-wave';
    c.title = 'Drag the markers (Shift: fine) · wheel: zoom · Shift+wheel: scroll · double click: the whole sample';
    c.addEventListener('pointerdown', e => this.press(e));
    c.addEventListener('pointermove', e => {
      if (e.buttons) return;
      const h = this.hit(e);
      if (!same(h, this.hot)) {
        this.hot = h;
        this.paint();
      }
      if (h === 'loop') c.style.cursor = 'grab';
      else if (h) c.style.cursor = 'ew-resize';
      else c.style.cursor = this.sliced() ? 'pointer' : 'default';
    });
    c.addEventListener('pointerleave', () => {
      if (this.hot) {
        this.hot = null;
        this.paint();
      }
    });
    c.addEventListener('dblclick', e => this.doubleClick(e));
    c.addEventListener('wheel', e => this.wheel(e), { passive: false });
    c.addEventListener('contextmenu', e => {
      e.preventDefault();
      this.host.menu(e.clientX, e.clientY);
    });
  }

  /** Goes back to showing the whole sample. */
  zoomAll(): void {
    this.v0 = 0;
    this.v1 = 1;
    this.paint();
  }

  /** Redraws if the voices moved (at every frame). */
  tick(): void {
    const heads = this.host.playheads();
    if (heads.length || this.heads.length) {
      this.heads = heads;
      this.paint();
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  // ---------------------------------------------------------------- measures

  private get width(): number {
    return this.canvas.clientWidth;
  }

  private xOf(frac: number): number {
    return ((frac - this.v0) / (this.v1 - this.v0)) * this.width;
  }

  private fracAt(clientX: number): number {
    const r = this.canvas.getBoundingClientRect();
    return this.v0 + ((clientX - r.left) / Math.max(1, r.width)) * (this.v1 - this.v0);
  }

  private sliced(): boolean {
    return this.host.values().mode === MODE.slice && !!this.host.audio();
  }

  private looping(v: Readonly<Record<string, number>>): boolean {
    return v.mode === MODE.classic && v.loop !== LOOP.off;
  }

  /** The visible markers, with their position (fraction). */
  private markers(v: Readonly<Record<string, number>>): [Marker, number][] {
    const out: [Marker, number][] = [[{ kind: 'start' }, v.start / 100], [{ kind: 'end' }, v.end / 100]];
    if (this.looping(v)) out.push([{ kind: 'loopStart' }, v.loopStart / 100], [{ kind: 'loopEnd' }, v.loopEnd / 100]);
    if (v.mode === MODE.slice && v.sliceBy === SLICE.transients) {
      const a = v.start / 100, b = v.end / 100;
      for (let k = 1; k <= v[SLICE_COUNT]; k++) {
        const x = v[sliceParam(k)];
        if (x > a && x < b) out.push([{ kind: 'slice', param: k }, x]);
      }
    }
    return out;
  }

  private hit(e: MouseEvent): Marker | 'loop' | null {
    if (!this.host.audio()) return null;
    const r = this.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, h = r.height;
    const v = this.host.values();
    let best: Marker | null = null, dist = HIT;
    for (const [m, frac] of this.markers(v)) {
      // the loop markers are grabbed at the bottom, the others at the top (or along the line, if far)
      const loopMarker = m.kind === 'loopStart' || m.kind === 'loopEnd';
      if (loopMarker ? y < TOP : y > h - BOTTOM) continue;
      const d = Math.abs(this.xOf(frac) - x);
      if (d < dist || (d === dist && loopMarker === y > h / 2)) {
        dist = d;
        best = m;
      }
    }
    if (best) return best;
    if (this.looping(v) && y > h - BOTTOM && x > this.xOf(v.loopStart / 100) && x < this.xOf(v.loopEnd / 100)) return 'loop';
    return null;
  }

  // ---------------------------------------------------------------- gestures

  private press(e: PointerEvent): void {
    if (e.button !== 0) return;
    const h = this.hit(e);
    const v0 = { ...this.host.values() };
    if (!h) {
      // in Slice a click on a slice plays it
      if (this.sliced()) {
        const at = this.fracAt(e.clientX), starts = sliceStarts(v0);
        const i = starts.filter(s => s <= at).length - 1;
        if (i >= 0 && at < v0.end / 100) this.host.playSlice(i);
      }
      return;
    }
    e.preventDefault();
    const scale = (this.v1 - this.v0) / Math.max(1, this.width);
    let last: ParamValues | null = null, fine = 0, prevX = e.clientX;
    drag(e, this.canvas, (_dx, _dy, m) => {
      // with Shift the marker goes at a quarter of the speed
      fine += (m.clientX - prevX) * (m.shiftKey ? 0.25 : 1);
      prevX = m.clientX;
      last = this.moved(h, v0, fine * scale);
      if (last) this.host.set(last, false);
    }, () => { if (last) this.host.set(last, true); });
  }

  /** The values after moving `h` by `delta` (fraction of the sample). */
  private moved(h: Marker | 'loop', v: Readonly<Record<string, number>>, delta: number): ParamValues | null {
    const pct = (x: number) => round(clamp01(x) * 100), gap = 0.0005;
    if (h === 'loop') {
      const a = v.loopStart / 100, b = v.loopEnd / 100, d = Math.max(-a, Math.min(1 - b, delta));
      return { loopStart: pct(a + d), loopEnd: pct(b + d) };
    }
    switch (h.kind) {
      case 'start': return { start: pct(Math.min(v.end / 100 - gap, v.start / 100 + delta)) };
      case 'end': return { end: pct(Math.max(v.start / 100 + gap, v.end / 100 + delta)) };
      case 'loopStart': return { loopStart: pct(Math.min(v.loopEnd / 100 - gap, v.loopStart / 100 + delta)) };
      case 'loopEnd': return { loopEnd: pct(Math.max(v.loopStart / 100 + gap, v.loopEnd / 100 + delta)) };
      case 'slice': {
        const x = v[sliceParam(h.param)] + delta;
        return { [sliceParam(h.param)]: Math.round(Math.max(v.start / 100, Math.min(v.end / 100, x)) * 1e6) / 1e6 };
      }
    }
  }

  private doubleClick(e: MouseEvent): void {
    const v = this.host.values();
    const h = this.hit(e);
    if (v.mode === MODE.slice && v.sliceBy === SLICE.transients && this.host.audio()) {
      const points = Array.from({ length: v[SLICE_COUNT] }, (_, i) => v[sliceParam(i + 1)]);
      if (h && h !== 'loop' && h.kind === 'slice') points.splice(h.param - 1, 1);
      else if (!h) points.push(clamp01(this.fracAt(e.clientX)));
      else return;
      this.host.set(sliceValues(points.sort((a, b) => a - b)), true);
      return;
    }
    if (!h) this.zoomAll();
  }

  private wheel(e: WheelEvent): void {
    if (!this.host.audio()) return;
    e.preventDefault();
    const span = this.v1 - this.v0;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const d = ((e.shiftKey ? e.deltaY : e.deltaX) / Math.max(1, this.width)) * span;
      const v0 = Math.max(0, Math.min(1 - span, this.v0 + d));
      this.v0 = v0;
      this.v1 = v0 + span;
    } else {
      const at = this.fracAt(e.clientX), k = Math.pow(1.0015, e.deltaY);
      const next = Math.max(MIN_SPAN, Math.min(1, span * k));
      let v0 = at - ((at - this.v0) / span) * next;
      v0 = Math.max(0, Math.min(1 - next, v0));
      this.v0 = v0;
      this.v1 = v0 + next;
    }
    this.paint();
  }

  // ---------------------------------------------------------------- drawing

  private peaksOf(data: SampleData, reverse: boolean): Peaks {
    if (this.peaks?.data !== data) {
      const forward = Peaks.from({ sampleRate: data.sampleRate, channels: [...data.channels] });
      this.peaks = { data, forward, reversed: forward.reversed() };
    }
    return reverse ? this.peaks.reversed : this.peaks.forward;
  }

  paint(): void {
    const g = fit(this.canvas);
    if (!g) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    g.fillStyle = BACKGROUND;
    g.fillRect(0, 0, w, h);
    const data = this.host.audio();
    if (!data) return this.empty(g, w, h);
    const v = this.host.values();
    const top = TOP, bottom = h - BOTTOM, mid = (top + bottom) / 2, amp = (bottom - top) / 2 - 1;
    const a = v.start / 100, b = v.end / 100;
    g.globalAlpha = this.enabled ? 1 : 0.5;

    // the marker strips and the zero line
    g.fillStyle = 'rgba(255,255,255,0.03)';
    g.fillRect(0, 0, w, top);
    g.fillRect(0, bottom, w, BOTTOM);
    g.strokeStyle = GRID;
    g.beginPath();
    g.moveTo(0, Math.round(mid) + 0.5);
    g.lineTo(w, Math.round(mid) + 0.5);
    g.stroke();

    // the loop under the waveform
    const looping = this.looping(v);
    if (looping) {
      const la = Math.max(a, v.loopStart / 100), lb = Math.min(b, v.loopEnd / 100);
      const x0 = this.xOf(la), x1 = this.xOf(lb);
      if (x1 > x0) {
        g.fillStyle = 'rgba(242,209,75,0.08)';
        g.fillRect(x0, top, x1 - x0, bottom - top);
        g.fillStyle = this.hot === 'loop' ? 'rgba(242,209,75,0.55)' : 'rgba(242,209,75,0.32)';
        g.fillRect(x0, bottom + 2, x1 - x0, BOTTOM - 4);
        if (v.loop === LOOP.forward && v.xfade > 0) {
          // the crossfade: the end of the loop falls while the piece before the start rises
          const span = lb - la, xf = Math.min((v.xfade / 100) * span, la - a);
          if (xf > 0) {
            g.strokeStyle = 'rgba(242,209,75,0.6)';
            g.setLineDash([3, 3]);
            g.beginPath();
            g.moveTo(this.xOf(lb - xf), top);
            g.lineTo(x1, bottom);
            g.moveTo(this.xOf(la - xf), bottom);
            g.lineTo(x0, top);
            g.stroke();
            g.setLineDash([]);
          }
        }
      }
    }

    // the waveform: lit in the playing region
    const peaks = this.peaksOf(data, v.reverse === 1), seconds = data.channels[0].length / data.sampleRate;
    const spanX = (this.v1 - this.v0) / Math.max(1, w);
    for (let x = 0; x < w; x++) {
      const f0 = this.v0 + x * spanX, f1 = f0 + spanX;
      const [lo, hi] = peaks.range(f0 * seconds, f1 * seconds);
      const y0 = mid - Math.min(1, hi) * amp, y1 = mid - Math.max(-1, lo) * amp;
      g.fillStyle = f1 > a && f0 < b ? WAVE_ON : WAVE_OFF;
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
    // outside the region, a veil
    g.fillStyle = 'rgba(0,0,0,0.25)';
    const xa = this.xOf(a), xb = this.xOf(b);
    if (xa > 0) g.fillRect(0, top, xa, bottom - top);
    if (xb < w) g.fillRect(xb, top, w - xb, bottom - top);

    // the slices
    if (v.mode === MODE.slice) {
      const starts = sliceStarts(v);
      g.font = '9px system-ui, sans-serif';
      starts.forEach((s, i) => {
        const x = Math.round(this.xOf(s)) + 0.5;
        if (x < -40 || x > w + 1) return;
        const hot = this.hot && this.hot !== 'loop' && this.hot.kind === 'slice' && Math.abs(v[sliceParam(this.hot.param)] - s) < 1e-9;
        if (hot) g.strokeStyle = '#fff';
        else g.strokeStyle = i === 0 ? 'rgba(79,209,224,0.35)' : 'rgba(79,209,224,0.7)';
        g.beginPath();
        g.moveTo(x, top);
        g.lineTo(x, bottom);
        g.stroke();
        if (i > 0) {
          g.fillStyle = hot ? '#fff' : SLICE_COLOR;
          g.fillRect(x - 0.5, 1, 1, top - 2);
        }
        g.fillStyle = 'rgba(79,209,224,0.9)';
        g.fillText(String(i + 1), x + 3, top + 10);
      });
    }

    // Start and End, then the loop markers
    this.flag(g, 'start', xa, top, bottom, START_COLOR, 'S', 'top');
    this.flag(g, 'end', xb, top, bottom, START_COLOR, 'E', 'top');
    if (looping) {
      this.flag(g, 'loopStart', this.xOf(v.loopStart / 100), top, bottom, LOOP_COLOR, 'L', 'bottom');
      this.flag(g, 'loopEnd', this.xOf(v.loopEnd / 100), top, bottom, LOOP_COLOR, 'L', 'bottom');
    }

    // the playing voices
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    for (const p of this.heads) {
      const x = Math.round(this.xOf(p)) + 0.5;
      if (x < 0 || x > w) continue;
      g.beginPath();
      g.moveTo(x, top);
      g.lineTo(x, bottom);
      g.stroke();
    }

    g.globalAlpha = 1;
    // the zoom: where you are in the sample
    if (this.v1 - this.v0 < 0.999) {
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(this.v0 * w, h - 2, Math.max(2, (this.v1 - this.v0) * w), 2);
    }
    if (v.mode === MODE.slice && v.sliceBy === SLICE.transients && !v[SLICE_COUNT]) {
      g.font = '11px system-ui, sans-serif';
      g.fillStyle = LABEL;
      g.textAlign = 'center';
      g.fillText('No slices: Detect finds them at the transients, or double click to add some', w / 2, top + 14);
      g.textAlign = 'left';
    }
  }

  private flag(g: CanvasRenderingContext2D, kind: Marker['kind'], x: number, top: number, bottom: number, color: string, text: string, at: 'top' | 'bottom'): void {
    const w = this.width;
    if (x < -10 || x > w + 10) return;
    const hot = this.hot && this.hot !== 'loop' && this.hot.kind === kind;
    const px = Math.round(x) + 0.5;
    g.strokeStyle = hot ? '#fff' : color;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(px, top);
    g.lineTo(px, bottom);
    g.stroke();
    // the flag sits inside the region: right of the line for the starts, left for the ends
    const right = kind === 'start' || kind === 'loopStart';
    const fw = 11, fh = at === 'top' ? TOP - 2 : BOTTOM - 2, fy = at === 'top' ? 1 : bottom + 1;
    const fx = right ? px : px - fw;
    g.fillStyle = hot ? '#fff' : color;
    g.fillRect(fx, fy, fw, fh);
    g.fillStyle = '#141414';
    g.font = '600 9px system-ui, sans-serif';
    g.fillText(text, fx + 3, fy + fh - 3);
  }

  private empty(g: CanvasRenderingContext2D, w: number, h: number): void {
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.setLineDash([5, 4]);
    g.strokeRect(8.5, 8.5, w - 17, h - 17);
    g.setLineDash([]);
    g.textAlign = 'center';
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.font = '13px system-ui, sans-serif';
    const name = this.host.name();
    g.fillText(name ? `Loading "${name}"…` : 'Drag an audio file or a sample from the browser here', w / 2, h / 2 - 2);
    if (!name) {
      g.fillStyle = LABEL;
      g.font = '11px system-ui, sans-serif';
      g.fillText('or Load… up here', w / 2, h / 2 + 16);
    }
    g.textAlign = 'left';
  }
}

const same = (a: Marker | 'loop' | null, b: Marker | 'loop' | null): boolean =>
  a === b || (!!a && !!b && a !== 'loop' && b !== 'loop' && a.kind === b.kind && (a.kind !== 'slice' || (b.kind === 'slice' && a.param === b.param)));
