/* For the tests of DOM components (files with `// @vitest-environment happy-dom`): happy-dom has
 * no 2D canvas, so the canvases draw into a context that records what's drawn. */
import { vi } from 'vitest';

/** A drawing call: its name, its arguments and the fill colour it was made with. */
export interface Drawn {
  readonly name: string;
  readonly args: readonly unknown[];
  readonly fill: unknown;
}

export type RecordingContext = CanvasRenderingContext2D & { readonly drawn: Drawn[] };

/** A 2D context that does nothing and records the calls (measureText: 6 px a character). */
export function recordingContext(): RecordingContext {
  const drawn: Drawn[] = [];
  const target: Record<string | symbol, unknown> = { drawn, fillStyle: '#000' };
  return new Proxy(target, {
    get: (t, name) => {
      if (name in t) return t[name];
      if (name === 'measureText') return (s: string) => ({ width: s.length * 6 });
      return (...args: unknown[]) => { drawn.push({ name: String(name), args, fill: t.fillStyle }); };
    },
    set: (t, name, value) => { t[name] = value; return true; },
  }) as unknown as RecordingContext;
}

/** Every canvas gets its own recording context (the same one at each getContext); `of(canvas)` gives it. */
export function recordCanvases() {
  const contexts = new WeakMap<HTMLCanvasElement, RecordingContext>();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const g = contexts.get(this) ?? recordingContext();
    contexts.set(this, g);
    return g as never;
  });
  return { of: (canvas: HTMLCanvasElement) => canvas.getContext('2d') as RecordingContext };
}

/** The element's size as the layout would give it, at the page's top left (happy-dom has no layout). */
export function sized(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height });
  element.getBoundingClientRect = () => new DOMRect(0, 0, width, height);
}

/** A pointer event at (x, y) of the page (the elements sit at 0, 0: happy-dom has no layout). */
export function pointer(type: string, x: number, y: number, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true, cancelable: true, ...init });
}

/** The texts drawn, in order. */
export const texts = (g: RecordingContext): string[] => g.drawn.filter(d => d.name === 'fillText').map(d => String(d.args[0]));
