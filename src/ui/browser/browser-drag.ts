/* Dragging the browser's items (HTML drag and drop): the item is kept here, because
 * only text goes in the transfer; whoever receives it (timeline, session, devices) asks for it with
 * `draggedItem`. */
import type { BrowserItem } from '../../browser/item';

/** The transfer's type: it tells the receiver it comes from the browser (and isn't files). */
export const BROWSER_DRAG = 'application/x-studiomio-browser';

let dragged: BrowserItem | null = null;

/** Starts dragging `item` (from the dragstart of a browser row). */
export function startBrowserDrag(e: DragEvent, item: BrowserItem): void {
  if (!e.dataTransfer || !item.payload) return;
  dragged = item;
  e.dataTransfer.setData(BROWSER_DRAG, item.id);
  e.dataTransfer.setData('text/plain', item.name);
  e.dataTransfer.effectAllowed = 'copy';
}

export function endBrowserDrag(): void {
  dragged = null;
}

/** The browser item dragged in this event, if there is one. */
export function draggedItem(e: DragEvent): BrowserItem | null {
  return dragged && e.dataTransfer?.types.includes(BROWSER_DRAG) ? dragged : null;
}

export interface DropOptions {
  /** Is the item OK there, under the pointer? (Without: always.) */
  readonly accept?: (item: BrowserItem, e: DragEvent) => boolean;
  /** While an item passes over (null: it left or was dropped), to highlight where it will go. */
  readonly over?: (e: DragEvent | null) => void;
}

/** Makes `target` receive the browser's items: `drop` receives the dropped one. While it passes
 *  over, `target` has the class "browser-drop". */
export function acceptBrowserDrops(target: HTMLElement, drop: (item: BrowserItem, e: DragEvent) => void, { accept, over }: DropOptions = {}): void {
  const leave = () => {
    target.classList.remove('browser-drop');
    over?.(null);
  };
  target.addEventListener('dragover', e => {
    const item = draggedItem(e);
    if (!item || (accept && !accept(item, e))) return leave();
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
    target.classList.add('browser-drop');
    over?.(e);
  });
  target.addEventListener('dragleave', e => {
    if (!target.contains(e.relatedTarget as Node | null)) leave();
  });
  target.addEventListener('drop', e => {
    const item = draggedItem(e);
    leave();
    if (!item || (accept && !accept(item, e))) return;
    e.preventDefault();
    e.stopPropagation();
    endBrowserDrag();
    drop(item, e);
  });
}
