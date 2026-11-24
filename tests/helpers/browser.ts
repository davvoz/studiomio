/* What happy-dom doesn't have (canvases, observers, pointer capture, frames on demand) and the
 * gestures of the DOM tests. For files with `// @vitest-environment happy-dom`. */
import { vi } from 'vitest';
import type { BrowserItem } from '../../src/browser/item';
import { BROWSER_DRAG, endBrowserDrag, startBrowserDrag } from '../../src/ui/browser/browser-drag';
import { FakePath2D } from './canvas';
import { pointer, recordCanvases, sized } from './dom';

/** requestAnimationFrame by hand: `run` draws the frames asked so far. */
export function manualFrames() {
  let queue: FrameRequestCallback[] = [];
  let now = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => queue.push(fn));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  return {
    run(times = 1): void {
      for (let i = 0; i < times; i++) {
        const asked = queue;
        queue = [];
        now += 16;
        for (const fn of asked) fn(now);
      }
    },
  };
}

/** The missing pieces of the browser; `resize` calls the size observers. */
export function fakeBrowser() {
  const canvases = recordCanvases();
  const frames = manualFrames();
  const resized: (() => void)[] = [];
  vi.stubGlobal('ResizeObserver', class {
    constructor(fn: () => void) { resized.push(fn); }
    observe(): void { /* the tests call `resize` */ }
    unobserve(): void { /* nothing is watched */ }
    disconnect(): void { /* nothing is watched */ }
  });
  vi.stubGlobal('Path2D', FakePath2D);
  // nothing is hidden by the layout
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get: () => document.body });
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = () => true;
  Element.prototype.scrollIntoView = vi.fn();
  return { canvases, frames, resize: () => resized.forEach(fn => fn()) };
}

type Point = readonly [number, number];

/** A press, the moves through `points` and the release, on the same element (which captured the pointer). */
export function drag(e: EventTarget, points: readonly Point[], init: PointerEventInit = {}): void {
  const [first, ...rest] = points, last = points.at(-1)!;
  e.dispatchEvent(pointer('pointerdown', first[0], first[1], { buttons: 1, ...init }));
  for (const [x, y] of rest) e.dispatchEvent(pointer('pointermove', x, y, { buttons: 1, ...init }));
  e.dispatchEvent(pointer('pointerup', last[0], last[1], init));
}

export const mouse = (type: string, x = 0, y = 0, init: MouseEventInit = {}): MouseEvent =>
  new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, ...init });

export const wheel = (x: number, y: number, deltaY: number, init: WheelEventInit = {}): WheelEvent => {
  const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, ...init });
  Object.defineProperties(e, { clientX: { value: x }, clientY: { value: y } });
  return e;
};

export const key = (k: string, init: KeyboardEventInit = {}): KeyboardEvent =>
  new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });

/** A drop (or another drag event) of `files` or of the data `types`. */
export function dragEvent(type: string, files: readonly File[], data: Readonly<Record<string, string>> = {}): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const types = [...(files.length ? ['Files'] : []), ...Object.keys(data)];
  Object.assign(e, { dataTransfer: { types, files, dropEffect: 'none', getData: (t: string) => data[t] ?? '', items: [] } });
  return e;
}

/** Chooses `value` in a drop-down menu. */
export function pick(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

/** The open context menu: the labels, and the choice of one. */
export const menuLabels = (): string[] => [...document.querySelectorAll('.context-menu .item .label')].map(e => e.textContent ?? '');

export function choose(label: string): void {
  const item = [...document.querySelectorAll<HTMLButtonElement>('.context-menu .item')].find(b => b.querySelector('.label')?.textContent === label);
  if (!item) throw new Error(`no menu item "${label}" among: ${menuLabels().join(', ')}`);
  item.click();
}

/** The button with that text. */
export function button(root: ParentNode, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(b => b.textContent === text);
  if (!found) throw new Error(`no button "${text}"`);
  return found;
}

/** The system's file dialog answers with `files` (until the next call). */
export function answerFileDialog(files: readonly File[]): void {
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    Object.defineProperty(this, 'files', { configurable: true, value: files });
    this.dispatchEvent(new Event('change'));
  });
}

export const audioFile = (name: string): File => new File([new Uint8Array([1, 2, 3])], name, { type: 'audio/wav' });

/** Drags the browser's `item` onto `target`, at (x, y). */
export function dropItem(target: EventTarget, item: BrowserItem, x = 0, y = 0): void {
  const data = { [BROWSER_DRAG]: item.id };
  const start = dragEvent('dragstart', []) as DragEvent;
  Object.assign(start.dataTransfer!, { setData: () => undefined });
  startBrowserDrag(start, item);
  for (const type of ['dragover', 'drop']) {
    const e = dragEvent(type, [], data);
    Object.assign(e, { clientX: x, clientY: y });
    target.dispatchEvent(e);
  }
  endBrowserDrag();
}

/** Every canvas of `root` as wide and tall as the layout would make it. */
export const sizeCanvases = (root: ParentNode, width: number, height: number): void => {
  for (const c of root.querySelectorAll('canvas')) sized(c, width, height);
};

/** Types in the open inline field (name, time…) and confirms. */
export function typeInline(root: ParentNode, text: string, k = 'Enter'): void {
  const input = root.querySelector<HTMLInputElement>('input.rename');
  if (!input) throw new Error('no inline field');
  input.value = text;
  input.dispatchEvent(key(k));
}

/** Lets the pending promises end. */
export const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 5); });
