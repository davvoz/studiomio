import { afterEach, describe, expect, it, vi } from 'vitest';
import { fit, Surface } from '../../src/ui/kit/canvas';
import { nearest } from '../../src/ui/kit/hit';
import { below, drag, localPoint, moved, pointerIn } from '../../src/ui/kit/pointer';
import { readPref, writePref } from '../../src/ui/kit/prefs';
import { fakeCanvas, fakeContext } from '../helpers/canvas';

/** An element at (100, 50), 200 × 40. */
const box = { getBoundingClientRect: () => ({ left: 100, top: 50, bottom: 90, width: 200, height: 40 }) } as unknown as Element;

/** An element that records its listeners, to fire pointer events at it. */
function target() {
  const listeners = new Map<string, Set<(e: PointerEvent) => void>>();
  const captured: number[] = [];
  const el = {
    setPointerCapture: (id: number) => captured.push(id),
    addEventListener: (t: string, f: (e: PointerEvent) => void) => {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(f);
    },
    removeEventListener: (t: string, f: (e: PointerEvent) => void) => listeners.get(t)?.delete(f),
  };
  const fire = (t: string, clientX: number, clientY: number) => { for (const f of listeners.get(t) ?? []) f({ clientX, clientY } as PointerEvent); };
  const count = () => [...listeners.values()].reduce((n, s) => n + s.size, 0);
  return { el: el as unknown as HTMLElement, fire, captured, count };
}

describe('the pointer', () => {
  it('inside an element, with the modifiers the gestures read', () => {
    expect(localPoint({ clientX: 130, clientY: 60 }, box)).toEqual({ x: 30, y: 10 });
    const e = { clientX: 130, clientY: 60, shiftKey: true, altKey: false, ctrlKey: false, metaKey: true } as MouseEvent;
    expect(pointerIn(e, box)).toEqual({ x: 30, y: 10, shift: true, alt: false, ctrl: true });
    expect(below(box)).toEqual({ x: 100, y: 92 });
  });

  it('a press becomes a drag at 3 pixels, across plus down', () => {
    expect(moved({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(false);
    expect(moved({ x: 0, y: 0 }, { x: 2, y: 1 })).toBe(true);
    expect(moved({ x: 5, y: 5 }, { x: 5, y: 2 })).toBe(true);
  });

  it('a drag captures the pointer, gives the offset from the start, ends once and lets go', () => {
    const t = target(), moves: [number, number][] = [];
    let ends = 0;
    drag({ clientX: 10, clientY: 20, pointerId: 7 } as PointerEvent, t.el, (dx, dy) => moves.push([dx, dy]), () => { ends++; });
    expect(t.captured).toEqual([7]);
    t.fire('pointermove', 15, 18);
    t.fire('pointermove', 40, 20);
    t.fire('pointerup', 40, 20);
    t.fire('pointermove', 99, 99);
    expect(moves).toEqual([[5, -2], [30, 0]]);
    expect(ends).toBe(1);
    expect(t.count()).toBe(0);
    const cancelled = target();
    drag({ clientX: 0, clientY: 0, pointerId: 1 } as PointerEvent, cancelled.el, () => {}, () => { ends++; });
    cancelled.fire('pointercancel', 0, 0);
    expect(ends).toBe(2);
  });
});

describe('the nearest handle', () => {
  const at = [3, 1, 6, 1];

  it('within the radius, the first at equal distance; with inclusive the last, and the radius counts', () => {
    const away = (i: number) => at[i];
    expect(nearest(at.keys(), away, 5)).toBe(1);
    expect(nearest(at.keys(), away, 5, true)).toBe(3);
    expect(nearest(at.keys(), away, 1)).toBeNull();
    expect(nearest(at.keys(), away, 1, true)).toBe(3);
    expect(nearest([], () => 0, 10)).toBeNull();
  });
});

describe('sharp canvases', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fit resizes to the place at the screen density, only when it changed; hidden, nothing', () => {
    vi.stubGlobal('window', { devicePixelRatio: 2 });
    const { canvas, ctx } = fakeCanvas(100, 50);
    expect(fit(canvas)).toBe(ctx);
    expect([canvas.width, canvas.height]).toEqual([200, 100]);
    let resized = 0;
    const watched = new Proxy(canvas, { set: (t, k, v) => { resized++; return Reflect.set(t, k, v); } });
    fit(watched);
    expect(resized).toBe(0);
    expect(fit(fakeCanvas(0, 50).canvas)).toBeNull();
    vi.stubGlobal('window', {});
    expect(fit(fakeCanvas(10, 10).canvas)).not.toBeNull();
  });

  it('a surface sized from outside draws in CSS pixels', () => {
    const ctx = fakeContext();
    const style: Record<string, string> = {};
    vi.stubGlobal('document', { createElement: () => ({ className: '', width: 0, height: 0, style, getContext: () => ctx }) });
    vi.stubGlobal('window', { devicePixelRatio: 1.5 });
    const s = new Surface('lane');
    s.resize(101, 0);
    expect([s.width, s.height, s.canvas.width, s.canvas.height, s.canvas.className]).toEqual([101, 0, 152, 1, 'lane']);
    expect(style).toEqual({ width: '101px', height: '0px' });
    expect(ctx.calls).toEqual(['setTransform']);
  });
});

describe('preferences', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('remembered when there is local storage; without, nothing breaks', () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => kept.set(k, v) });
    writePref('h', '120');
    expect(readPref('h')).toBe('120');
    expect(readPref('other')).toBeNull();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(() => writePref('h', '1')).not.toThrow();
    expect(readPref('h')).toBeNull();
  });
});
