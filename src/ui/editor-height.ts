import { el } from './dom';

/** A height that's changed by dragging the top edge, as in Live, and remembered (it's in
 *  a CSS variable). */
export interface HeightSetting {
  readonly key: string;
  readonly variable: string;
  readonly initial: number;
  readonly min: number;
}

/** The clip editors (audio and piano roll): the same height for both (`--editor-h`). */
export const EDITOR_HEIGHT: HeightSetting = { key: 'studiomio.editorHeight', variable: '--editor-h', initial: 300, min: 160 };
/** The device chain (`--device-h`): the graphic panels are drawn for the initial
 *  height and with less they'd be cut, so it can only be raised. */
export const DEVICE_HEIGHT: HeightSetting = { key: 'studiomio.deviceHeight', variable: '--device-h', initial: 372, min: 372 };

/** A view that, dragged down past the minimum height, reduces to the header only;
 *  reduced, it's taken back from the edge and dragged up. */
export interface Foldable {
  readonly folded: boolean;
  /** The height of the reduced view. */
  readonly foldedHeight: number;
  fold(): void;
  unfold(): void;
}

/** How far the view is left below the minimum height for it to reduce (less: it goes back up). */
const FOLD_AT = 40;
/** How long the descent of the reducing view lasts, and the return of the reopening one. */
const FOLD_MS = 200, BACK_MS = 120;
/** How much must stay above and below the editor (top bar, timeline, status bar). */
const RESERVED = 220;

const loaded = new Set<HeightSetting>();

/** Adds the edge to drag to the editor (double click: the initial height). With `fold`,
 *  below the minimum height the view goes down with the mouse, covered by the status bar: released
 *  low enough it reduces to the header, otherwise it goes back up. */
export function addHeightHandle(editor: HTMLElement, setting: HeightSetting = EDITOR_HEIGHT, fold?: Foldable): void {
  if (!loaded.has(setting)) {
    loaded.add(setting);
    const saved = Number(read(setting.key));
    if (saved >= setting.min) apply(setting, saved);
  }
  const handle = el('div', { className: 'editor-resize', title: 'Drag to change the height · double click: initial height' });
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    // the modulation lane adds height (see `.with-lane` in the CSS); if the window is
    // low the CSS may have reduced the editor: start from the visible height
    const extra = editor.classList.contains('with-lane') ? editor.querySelector<HTMLElement>('.mod-lane')?.offsetHeight ?? 0 : 0;
    const y0 = e.clientY;
    const h0 = fold?.folded ? fold.foldedHeight : Math.min(current(setting), editor.offsetHeight - extra);
    // how far the view went below the minimum height (at most until leaving the header)
    let sunk = 0;
    const move = (ev: PointerEvent) => {
      const height = h0 + y0 - ev.clientY;
      if (fold?.folded) {
        if (height <= fold.foldedHeight) return;
        fold.unfold();
      }
      apply(setting, clamp(setting, height, extra));
      if (!fold) return;
      sunk = Math.max(0, Math.min(editor.offsetHeight - fold.foldedHeight, setting.min - height));
      sink(editor, sunk);
    };
    const end = () => {
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      write(setting.key, String(current(setting)));
      if (!fold || !sunk) return;
      if (sunk <= FOLD_AT) void slide(editor, sunk, 0, BACK_MS);
      else {
        void slide(editor, sunk, editor.offsetHeight - fold.foldedHeight, FOLD_MS).then(() => {
          fold.fold();
          sink(editor, 0);
        });
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
  handle.addEventListener('dblclick', () => {
    if (fold?.folded) fold.unfold();
    apply(setting, setting.initial);
    write(setting.key, String(setting.initial));
  });
  editor.append(handle);
}

/** Lowers the view by `px` without changing its height (the panels don't rearrange):
 *  it removes space below it and hides the part going beyond. */
function sink(editor: HTMLElement, px: number): void {
  editor.style.marginBottom = px ? `-${px}px` : '';
  // the edge to drag sticks out above the view: it stays visible
  editor.style.clipPath = px ? `inset(-10px 0 ${px}px 0)` : '';
}

/** Brings the view from `from` to `to` pixels down, smoothly, and leaves it there. */
async function slide(editor: HTMLElement, from: number, to: number, ms: number): Promise<void> {
  const frame = (px: number) => ({ marginBottom: `-${px}px`, clipPath: `inset(-10px 0 ${px}px 0)` });
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    await editor.animate([frame(from), frame(to)], { duration: ms, easing: to ? 'ease-in' : 'ease-out' }).finished;
  }
  sink(editor, to);
}

function current(setting: HeightSetting): number {
  return parseFloat(document.documentElement.style.getPropertyValue(setting.variable)) || setting.initial;
}

function clamp(setting: HeightSetting, height: number, extra: number): number {
  return Math.round(Math.max(setting.min, Math.min(window.innerHeight - RESERVED - extra, height)));
}

function apply(setting: HeightSetting, height: number): void {
  document.documentElement.style.setProperty(setting.variable, `${height}px`);
}

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* niente */ }
}
