/* The Sampler waveform's measures and rules, without the DOM: the visible window (fractions of the
 * sample ↔ pixels), the markers and what's under the pointer, how a dragged marker or loop moves, the
 * slices a click plays or a double click adds and removes, the wheel's zoom and scroll. */
import { clamp01 } from '../../../core/math';
import { LOOP, MODE, SLICE, SLICE_COUNT, sliceParam, sliceStarts, sliceValues } from '../../../devices/instruments/sampler/sampler';
import type { ParamValues } from '../../../model/device';

/** The marker strip at the top (Start, End, slices) and the loop's at the bottom. */
export const TOP = 15, BOTTOM = 13;
/** How close (px) the pointer must be to grab a marker. */
const HIT = 6;
/** The tightest zoom: this fraction of the sample. */
const MIN_SPAN = 0.0005;

type Values = Readonly<Record<string, number>>;

/** A marker: a position with its parameter (the slices: the parameter's number). */
export type Marker = { readonly kind: 'start' | 'end' | 'loopStart' | 'loopEnd' } | { readonly kind: 'slice'; readonly param: number };
/** What the pointer is over: a marker, the loop, nothing. */
export type Hot = Marker | 'loop' | null;

export const sameHot = (a: Hot, b: Hot): boolean =>
  a === b || (!!a && !!b && a !== 'loop' && b !== 'loop' && a.kind === b.kind && (a.kind !== 'slice' || (b.kind === 'slice' && a.param === b.param)));

/** The part of the sample shown (`v0` … `v1`, fractions) over `width` pixels. */
export class WaveWindow {
  constructor(readonly v0 = 0, readonly v1 = 1, readonly width = 1) {}

  xOf(frac: number): number {
    return ((frac - this.v0) / (this.v1 - this.v0)) * this.width;
  }

  /** The fraction at `x` pixels from the left of a box `boxWidth` wide. */
  fracAt(x: number, boxWidth: number): number {
    return this.v0 + (x / Math.max(1, boxWidth)) * (this.v1 - this.v0);
  }

  /** The wheel: Shift (or a sideways turn) scrolls, otherwise it zooms around fraction `at`. */
  wheeled(w: { readonly deltaX: number; readonly deltaY: number; readonly shift: boolean }, at: number): WaveWindow {
    const span = this.v1 - this.v0;
    if (w.shift || Math.abs(w.deltaX) > Math.abs(w.deltaY)) {
      const d = ((w.shift ? w.deltaY : w.deltaX) / Math.max(1, this.width)) * span;
      const v0 = Math.max(0, Math.min(1 - span, this.v0 + d));
      return new WaveWindow(v0, v0 + span, this.width);
    }
    const k = Math.pow(1.0015, w.deltaY);
    const next = Math.max(MIN_SPAN, Math.min(1, span * k));
    let v0 = at - ((at - this.v0) / span) * next;
    v0 = Math.max(0, Math.min(1 - next, v0));
    return new WaveWindow(v0, v0 + next, this.width);
  }

  withWidth(width: number): WaveWindow {
    return width === this.width ? this : new WaveWindow(this.v0, this.v1, width);
  }
}

export const looping = (v: Values): boolean => v.mode === MODE.classic && v.loop !== LOOP.off;

/** Slicing by transients: the slices are added and removed by hand. */
export const slicingByTransients = (v: Values): boolean => v.mode === MODE.slice && v.sliceBy === SLICE.transients;

/** The visible markers, with their position (fraction). */
export function waveMarkers(v: Values): [Marker, number][] {
  const out: [Marker, number][] = [[{ kind: 'start' }, v.start / 100], [{ kind: 'end' }, v.end / 100]];
  if (looping(v)) out.push([{ kind: 'loopStart' }, v.loopStart / 100], [{ kind: 'loopEnd' }, v.loopEnd / 100]);
  if (slicingByTransients(v)) {
    const a = v.start / 100, b = v.end / 100;
    for (let k = 1; k <= v[SLICE_COUNT]; k++) {
      const x = v[sliceParam(k)];
      if (x > a && x < b) out.push([{ kind: 'slice', param: k }, x]);
    }
  }
  return out;
}

/** What's at (x, y) in a box `h` tall: the loop markers are grabbed at the bottom, the others at the top (or along the line, if far). */
export function waveHit(win: WaveWindow, v: Values, x: number, y: number, h: number): Hot {
  let best: Marker | null = null, dist = HIT;
  for (const [m, frac] of waveMarkers(v)) {
    const loopMarker = m.kind === 'loopStart' || m.kind === 'loopEnd';
    if (loopMarker ? y < TOP : y > h - BOTTOM) continue;
    const d = Math.abs(win.xOf(frac) - x);
    if (d < dist || (d === dist && loopMarker === y > h / 2)) {
      dist = d;
      best = m;
    }
  }
  if (best) return best;
  if (looping(v) && y > h - BOTTOM && x > win.xOf(v.loopStart / 100) && x < win.xOf(v.loopEnd / 100)) return 'loop';
  return null;
}

const round = (pct: number) => Math.round(pct * 1000) / 1000;

/** The values after moving `h` by `delta` (fraction of the sample). */
export function movedMarker(h: Marker | 'loop', v: Values, delta: number): ParamValues | null {
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

/** The slice a click at fraction `at` plays (from 0), or -1 (before the first, after End). */
export function sliceAt(v: Values, at: number): number {
  const i = sliceStarts(v).filter(s => s <= at).length - 1;
  return i >= 0 && at < v.end / 100 ? i : -1;
}

/** Double click slicing by transients: on a slice it goes, on empty space one is added at `at`; on another marker nothing (null). */
export function editedSlices(v: Values, h: Hot, at: number): ParamValues | null {
  const points = Array.from({ length: v[SLICE_COUNT] }, (_, i) => v[sliceParam(i + 1)]);
  if (h && h !== 'loop' && h.kind === 'slice') points.splice(h.param - 1, 1);
  else if (!h) points.push(clamp01(at));
  else return null;
  return sliceValues(points.toSorted((a, b) => a - b));
}
