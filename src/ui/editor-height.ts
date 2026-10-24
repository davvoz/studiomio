import { el } from './dom';

/** Un'altezza che si cambia trascinando il bordo in alto, come in Live, e si ricorda (sta in
 *  una variabile CSS). */
export interface HeightSetting {
  readonly key: string;
  readonly variable: string;
  readonly initial: number;
  readonly min: number;
}

/** Gli editor delle clip (audio e piano roll): la stessa altezza per tutti e due (`--editor-h`). */
export const EDITOR_HEIGHT: HeightSetting = { key: 'studiomio.editorHeight', variable: '--editor-h', initial: 300, min: 160 };
/** La catena dei dispositivi (`--device-h`): i pannelli grafici sono disegnati per l'altezza
 *  iniziale e con meno si taglierebbero, quindi si può solo alzare. */
export const DEVICE_HEIGHT: HeightSetting = { key: 'studiomio.deviceHeight', variable: '--device-h', initial: 372, min: 372 };

/** Una vista che, trascinata in giù oltre l'altezza minima, si riduce alla sola intestazione;
 *  ridotta, si riprende dal bordo e si trascina su. */
export interface Foldable {
  readonly folded: boolean;
  /** L'altezza della vista ridotta. */
  readonly foldedHeight: number;
  fold(): void;
  unfold(): void;
}

const LANE = 100;
/** Quanto si lascia la vista sotto l'altezza minima perché si riduca (meno: torna su). */
const FOLD_AT = 40;
/** Quanto dura la discesa della vista che si riduce, e il ritorno di quella che si riapre. */
const FOLD_MS = 200, BACK_MS = 120;
/** Quanto deve restare sopra e sotto l'editor (barra in alto, timeline, barra di stato). */
const RESERVED = 220;

const loaded = new Set<HeightSetting>();

/** Aggiunge all'editor il bordo da trascinare (doppio clic: l'altezza iniziale). Con `fold`,
 *  sotto l'altezza minima la vista scende con il mouse, coperta dalla barra di stato: lasciata
 *  abbastanza in basso si riduce all'intestazione, altrimenti torna su. */
export function addHeightHandle(editor: HTMLElement, setting: HeightSetting = EDITOR_HEIGHT, fold?: Foldable): void {
  if (!loaded.has(setting)) {
    loaded.add(setting);
    const saved = Number(read(setting.key));
    if (saved >= setting.min) apply(setting, saved);
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
    const y0 = e.clientY;
    const h0 = fold?.folded ? fold.foldedHeight : Math.min(current(setting), editor.offsetHeight - extra);
    // quanto la vista è scesa sotto l'altezza minima (al massimo fino a lasciare l'intestazione)
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

/** Fa scendere la vista di `px` senza cambiarne l'altezza (i pannelli non si ridispongono):
 *  le toglie spazio sotto e ne nasconde la parte che va oltre. */
function sink(editor: HTMLElement, px: number): void {
  editor.style.marginBottom = px ? `-${px}px` : '';
  // il bordo da trascinare sporge sopra la vista: resta visibile
  editor.style.clipPath = px ? `inset(-10px 0 ${px}px 0)` : '';
}

/** Porta la vista da `from` a `to` pixel sotto, dolcemente, e ve la lascia. */
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
