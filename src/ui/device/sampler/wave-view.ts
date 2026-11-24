/* The Sampler's waveform, as in Simpler: the playing region (Start…End) lit and the
 * rest dark, the loop as a band with its two markers at the bottom and the crossfade drawn,
 * the slices numbered, and a cursor for each playing voice. The markers are dragged (Shift: fine);
 * the loop band is dragged all together. The wheel zooms around the pointer,
 * Shift+wheel scrolls; double click on empty space goes back to the whole sample. In Slice a click on a
 * slice plays it; with the slices at the transients double click adds one (or, on a marker,
 * removes it). With Reverse the sample is shown reversed and the positions apply there.
 * This is the DOM: the rules are in wave-geometry, the drawing in wave-painter. */
import type { SampleData } from '../../../devices/dsp/core';
import { MODE } from '../../../devices/instruments/sampler/sampler';
import type { ParamValues } from '../../../model/device';
import { fit } from '../../kit/canvas';
import { drag } from '../../kit/pointer';
import { Peaks } from '../../waveform';
import { editedSlices, movedMarker, sameHot, sliceAt, slicingByTransients, waveHit, WaveWindow, type Hot } from './wave-geometry';
import { paintSampleWave } from './wave-painter';

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

export class WaveView {
  readonly canvas = document.createElement('canvas');
  private v0 = 0;
  private v1 = 1;
  private peaks: { data: SampleData; forward: Peaks; reversed: Peaks } | null = null;
  private hot: Hot = null;
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
      if (!sameHot(h, this.hot)) {
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

  /** The part of the sample shown, over the canvas's width. */
  private get win(): WaveWindow {
    return new WaveWindow(this.v0, this.v1, this.canvas.clientWidth);
  }

  private fracAt(clientX: number): number {
    const r = this.canvas.getBoundingClientRect();
    return this.win.fracAt(clientX - r.left, r.width);
  }

  private sliced(): boolean {
    return this.host.values().mode === MODE.slice && !!this.host.audio();
  }

  private hit(e: MouseEvent): Hot {
    if (!this.host.audio()) return null;
    const r = this.canvas.getBoundingClientRect();
    return waveHit(this.win, this.host.values(), e.clientX - r.left, e.clientY - r.top, r.height);
  }

  // ---------------------------------------------------------------- gestures

  private press(e: PointerEvent): void {
    if (e.button !== 0) return;
    const h = this.hit(e);
    const v0 = { ...this.host.values() };
    if (!h) {
      // in Slice a click on a slice plays it
      if (this.sliced()) {
        const i = sliceAt(v0, this.fracAt(e.clientX));
        if (i >= 0) this.host.playSlice(i);
      }
      return;
    }
    e.preventDefault();
    const scale = (this.v1 - this.v0) / Math.max(1, this.canvas.clientWidth);
    let last: ParamValues | null = null, fine = 0, prevX = e.clientX;
    drag(e, this.canvas, (_dx, _dy, m) => {
      // with Shift the marker goes at a quarter of the speed
      fine += (m.clientX - prevX) * (m.shiftKey ? 0.25 : 1);
      prevX = m.clientX;
      last = movedMarker(h, v0, fine * scale);
      if (last) this.host.set(last, false);
    }, () => { if (last) this.host.set(last, true); });
  }

  private doubleClick(e: MouseEvent): void {
    const v = this.host.values();
    const h = this.hit(e);
    if (slicingByTransients(v) && this.host.audio()) {
      const next = editedSlices(v, h, this.fracAt(e.clientX));
      if (next) this.host.set(next, true);
      return;
    }
    if (!h) this.zoomAll();
  }

  private wheel(e: WheelEvent): void {
    if (!this.host.audio()) return;
    e.preventDefault();
    const scrolls = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const next = this.win.wheeled({ deltaX: e.deltaX, deltaY: e.deltaY, shift: e.shiftKey }, scrolls ? 0 : this.fracAt(e.clientX));
    this.v0 = next.v0;
    this.v1 = next.v1;
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
    const data = this.host.audio();
    paintSampleWave({
      g, w: this.canvas.clientWidth, h: this.canvas.clientHeight, win: this.win, v: this.host.values(), data,
      name: data ? null : this.host.name(), peaks: (d, reverse) => this.peaksOf(d, reverse),
      hot: this.hot, heads: this.heads, enabled: this.enabled,
    });
  }
}
