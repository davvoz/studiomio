/* Il trascinamento delle voci del browser (drag and drop HTML): la voce si tiene qui, perché
 * nel trasferimento ci va solo testo; chi riceve (timeline, session, dispositivi) la chiede con
 * `draggedItem`. */
import type { BrowserItem } from '../../browser/item';

/** Il tipo del trasferimento: dice a chi riceve che arriva dal browser (e non dei file). */
export const BROWSER_DRAG = 'application/x-studiomio-browser';

let dragged: BrowserItem | null = null;

/** Comincia a trascinare `item` (dal dragstart di una riga del browser). */
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

/** La voce del browser trascinata in questo evento, se ce n'è una. */
export function draggedItem(e: DragEvent): BrowserItem | null {
  return dragged && e.dataTransfer?.types.includes(BROWSER_DRAG) ? dragged : null;
}

export interface DropOptions {
  /** La voce va bene lì, sotto il puntatore? (Senza: sempre.) */
  readonly accept?: (item: BrowserItem, e: DragEvent) => boolean;
  /** Mentre una voce passa sopra (null: è uscita o è stata lasciata), per evidenziare dove andrà. */
  readonly over?: (e: DragEvent | null) => void;
}

/** Fa ricevere a `target` le voci del browser: `drop` riceve quella lasciata. Mentre ci passa
 *  sopra, `target` ha la classe "browser-drop". */
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
