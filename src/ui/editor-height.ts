import { el } from './dom';

/** Altezza degli editor delle clip (audio e piano roll): come in Live si trascina il bordo in
 *  alto. È la stessa per tutti e due e si ricorda (sta nella variabile CSS `--editor-h`). */
const KEY = 'studiomio.editorHeight';
const DEFAULT = 300, MIN = 160, LANE = 100;
/** Quanto deve restare sopra e sotto l'editor (barra in alto, timeline, barra di stato). */
const RESERVED = 220;

let loaded = false;

/** Aggiunge all'editor il bordo da trascinare (doppio clic: l'altezza iniziale). */
export function addHeightHandle(editor: HTMLElement): void {
  if (!loaded) {
    loaded = true;
    const saved = Number(read());
    if (saved >= MIN) apply(saved);
  }
  const handle = el('div', { className: 'editor-resize', title: 'Trascina per cambiare l\'altezza · doppio clic: altezza iniziale' });
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    // la corsia delle modulazioni aggiunge altezza (vedi `.with-lane` nel CSS); se la finestra è
    // bassa il CSS può aver ridotto l'editor: si parte dall'altezza che si vede
    const extra = editor.classList.contains('with-lane') ? LANE : 0;
    const y0 = e.clientY, h0 = Math.min(current(), editor.offsetHeight - extra);
    const move = (ev: PointerEvent) => apply(clamp(h0 + y0 - ev.clientY, extra));
    const end = () => {
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      write(String(current()));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
  handle.addEventListener('dblclick', () => {
    apply(DEFAULT);
    write(String(DEFAULT));
  });
  editor.append(handle);
}

function current(): number {
  return parseFloat(document.documentElement.style.getPropertyValue('--editor-h')) || DEFAULT;
}

function clamp(height: number, extra: number): number {
  return Math.round(Math.max(MIN, Math.min(window.innerHeight - RESERVED - extra, height)));
}

function apply(height: number): void {
  document.documentElement.style.setProperty('--editor-h', `${height}px`);
}

function read(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

function write(value: string): void {
  try { localStorage.setItem(KEY, value); } catch { /* niente */ }
}
