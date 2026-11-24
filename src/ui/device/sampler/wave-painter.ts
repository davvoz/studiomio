/* The Sampler waveform's drawing: the playing region lit and the rest dark, the loop as a band with its
 * markers at the bottom and the crossfade drawn, the slices numbered, the playing voices, the zoom. */
import type { SampleData } from '../../../devices/dsp/core';
import { LOOP, MODE, SLICE_COUNT, sliceParam, sliceStarts } from '../../../devices/instruments/sampler/sampler';
import { BACKGROUND, GRID, LABEL } from '../../kit/canvas';
import type { Peaks } from '../../waveform';
import { BOTTOM, looping, slicingByTransients, TOP, type Hot, type Marker, type WaveWindow } from './wave-geometry';

const START_COLOR = '#ff9d2e';
const LOOP_COLOR = '#f2d14b';
const SLICE_COLOR = '#4fd1e0';
const WAVE_ON = 'rgba(255,190,120,0.9)';
const WAVE_OFF = 'rgba(255,255,255,0.16)';

/** What the waveform is drawn from. */
export interface WavePaint {
  readonly g: CanvasRenderingContext2D;
  readonly w: number;
  readonly h: number;
  readonly win: WaveWindow;
  readonly v: Readonly<Record<string, number>>;
  /** The sample (undefined: none, or still loading). */
  readonly data: SampleData | undefined;
  /** The sample's name, or null if there isn't one. */
  readonly name: string | null;
  /** The waveform's peaks, forward or reversed. */
  peaks(data: SampleData, reverse: boolean): Peaks;
  readonly hot: Hot;
  /** Where the playing voices read (fractions). */
  readonly heads: readonly number[];
  readonly enabled: boolean;
}

/** What a paint draws with: the knobs, the waveform's band (`top` … `bottom`, around `mid`, `amp`
 *  tall) and the region (`a` … `b`, fractions of the sample). */
interface WaveFrame extends WavePaint {
  readonly top: number;
  readonly bottom: number;
  readonly mid: number;
  readonly amp: number;
  readonly a: number;
  readonly b: number;
}

export function paintSampleWave(p: WavePaint): void {
  const { g, w, h, win, v } = p;
  g.fillStyle = BACKGROUND;
  g.fillRect(0, 0, w, h);
  const data = p.data;
  if (!data) return paintEmpty(g, w, h, p.name);
  const top = TOP, bottom = h - BOTTOM;
  const f: WaveFrame = { ...p, top, bottom, mid: (top + bottom) / 2, amp: (bottom - top) / 2 - 1, a: v.start / 100, b: v.end / 100 };
  g.globalAlpha = p.enabled ? 1 : 0.5;
  paintStrips(f);
  const loops = looping(v);
  if (loops) paintLoop(f);
  paintWave(f, data);
  // outside the region, a veil
  g.fillStyle = 'rgba(0,0,0,0.25)';
  const xa = win.xOf(f.a), xb = win.xOf(f.b);
  if (xa > 0) g.fillRect(0, top, xa, bottom - top);
  if (xb < w) g.fillRect(xb, top, w - xb, bottom - top);
  if (v.mode === MODE.slice) paintSlices(f);
  // Start and End, then the loop markers
  flag(f, 'start', xa, START_COLOR, 'S', 'top');
  flag(f, 'end', xb, START_COLOR, 'E', 'top');
  if (loops) {
    flag(f, 'loopStart', win.xOf(v.loopStart / 100), LOOP_COLOR, 'L', 'bottom');
    flag(f, 'loopEnd', win.xOf(v.loopEnd / 100), LOOP_COLOR, 'L', 'bottom');
  }
  paintHeads(f);
  g.globalAlpha = 1;
  paintFooter(f);
}

/** The marker strips and the zero line. */
function paintStrips({ g, w, top, bottom, mid }: WaveFrame): void {
  g.fillStyle = 'rgba(255,255,255,0.03)';
  g.fillRect(0, 0, w, top);
  g.fillRect(0, bottom, w, BOTTOM);
  g.strokeStyle = GRID;
  g.beginPath();
  g.moveTo(0, Math.round(mid) + 0.5);
  g.lineTo(w, Math.round(mid) + 0.5);
  g.stroke();
}

/** The loop under the waveform, with its crossfade (the end of the loop falls while the piece
 *  before the start rises). */
function paintLoop({ g, win, v, top, bottom, a, b, hot }: WaveFrame): void {
  const la = Math.max(a, v.loopStart / 100), lb = Math.min(b, v.loopEnd / 100);
  const x0 = win.xOf(la), x1 = win.xOf(lb);
  if (x1 <= x0) return;
  g.fillStyle = 'rgba(242,209,75,0.08)';
  g.fillRect(x0, top, x1 - x0, bottom - top);
  g.fillStyle = hot === 'loop' ? 'rgba(242,209,75,0.55)' : 'rgba(242,209,75,0.32)';
  g.fillRect(x0, bottom + 2, x1 - x0, BOTTOM - 4);
  if (v.loop !== LOOP.forward || v.xfade <= 0) return;
  const span = lb - la, xf = Math.min((v.xfade / 100) * span, la - a);
  if (xf <= 0) return;
  g.strokeStyle = 'rgba(242,209,75,0.6)';
  g.setLineDash([3, 3]);
  g.beginPath();
  g.moveTo(win.xOf(lb - xf), top);
  g.lineTo(x1, bottom);
  g.moveTo(win.xOf(la - xf), bottom);
  g.lineTo(x0, top);
  g.stroke();
  g.setLineDash([]);
}

/** The waveform: lit in the playing region. */
function paintWave(f: WaveFrame, data: SampleData): void {
  const { g, w, win, v, mid, amp, a, b } = f;
  const peaks = f.peaks(data, v.reverse === 1), seconds = data.channels[0].length / data.sampleRate;
  const spanX = (win.v1 - win.v0) / Math.max(1, w);
  for (let x = 0; x < w; x++) {
    const f0 = win.v0 + x * spanX, f1 = f0 + spanX;
    const [lo, hi] = peaks.range(f0 * seconds, f1 * seconds);
    const y0 = mid - Math.min(1, hi) * amp, y1 = mid - Math.max(-1, lo) * amp;
    g.fillStyle = f1 > a && f0 < b ? WAVE_ON : WAVE_OFF;
    g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
}

/** The slices: a line each, numbered, with its handle at the top (not the first). */
function paintSlices({ g, w, win, v, top, bottom, hot }: WaveFrame): void {
  g.font = '9px system-ui, sans-serif';
  sliceStarts(v).forEach((s, i) => {
    const x = Math.round(win.xOf(s)) + 0.5;
    if (x < -40 || x > w + 1) return;
    const on = hot && hot !== 'loop' && hot.kind === 'slice' && Math.abs(v[sliceParam(hot.param)] - s) < 1e-9;
    if (on) g.strokeStyle = '#fff';
    else g.strokeStyle = i === 0 ? 'rgba(79,209,224,0.35)' : 'rgba(79,209,224,0.7)';
    g.beginPath();
    g.moveTo(x, top);
    g.lineTo(x, bottom);
    g.stroke();
    if (i > 0) {
      g.fillStyle = on ? '#fff' : SLICE_COLOR;
      g.fillRect(x - 0.5, 1, 1, top - 2);
    }
    g.fillStyle = 'rgba(79,209,224,0.9)';
    g.fillText(String(i + 1), x + 3, top + 10);
  });
}

/** The playing voices. */
function paintHeads({ g, w, win, top, bottom, heads }: WaveFrame): void {
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  for (const p of heads) {
    const x = Math.round(win.xOf(p)) + 0.5;
    if (x < 0 || x > w) continue;
    g.beginPath();
    g.moveTo(x, top);
    g.lineTo(x, bottom);
    g.stroke();
  }
}

/** The zoom (where you are in the sample) and, slicing by transients with none found, how to get some. */
function paintFooter({ g, w, h, win, v, top }: WaveFrame): void {
  if (win.v1 - win.v0 < 0.999) {
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(win.v0 * w, h - 2, Math.max(2, (win.v1 - win.v0) * w), 2);
  }
  if (slicingByTransients(v) && !v[SLICE_COUNT]) {
    g.font = '11px system-ui, sans-serif';
    g.fillStyle = LABEL;
    g.textAlign = 'center';
    g.fillText('No slices: Detect finds them at the transients, or double click to add some', w / 2, top + 14);
    g.textAlign = 'left';
  }
}

function flag({ g, w, top, bottom, hot }: WaveFrame, kind: Marker['kind'], x: number, color: string, text: string, at: 'top' | 'bottom'): void {
  if (x < -10 || x > w + 10) return;
  const on = hot && hot !== 'loop' && hot.kind === kind;
  const px = Math.round(x) + 0.5;
  g.strokeStyle = on ? '#fff' : color;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(px, top);
  g.lineTo(px, bottom);
  g.stroke();
  // the flag sits inside the region: right of the line for the starts, left for the ends
  const right = kind === 'start' || kind === 'loopStart';
  const fw = 11, fh = at === 'top' ? TOP - 2 : BOTTOM - 2, fy = at === 'top' ? 1 : bottom + 1;
  const fx = right ? px : px - fw;
  g.fillStyle = on ? '#fff' : color;
  g.fillRect(fx, fy, fw, fh);
  g.fillStyle = '#141414';
  g.font = '600 9px system-ui, sans-serif';
  g.fillText(text, fx + 3, fy + fh - 3);
}

/** No sample: where to drop one (or which one is loading). */
function paintEmpty(g: CanvasRenderingContext2D, w: number, h: number, name: string | null): void {
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.setLineDash([5, 4]);
  g.strokeRect(8.5, 8.5, w - 17, h - 17);
  g.setLineDash([]);
  g.textAlign = 'center';
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.font = '13px system-ui, sans-serif';
  g.fillText(name ? `Loading "${name}"…` : 'Drag an audio file or a sample from the browser here', w / 2, h / 2 - 2);
  if (!name) {
    g.fillStyle = LABEL;
    g.font = '11px system-ui, sans-serif';
    g.fillText('or Load… up here', w / 2, h / 2 + 16);
  }
  g.textAlign = 'left';
}
