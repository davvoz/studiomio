/* Trascinare una traccia per cambiarne il posto, dall'intestazione nell'arrangement o dalla testa
 * della colonna nella session. Il trascinamento comincia dopo qualche pixel, così un clic resta un
 * clic; Esc lo annulla. Una linea mostra dove andrà la traccia. */
import { el } from './dom';

/** Un posto dove lasciare la traccia e la linea che lo mostra (in pixel dello schermo). */
export interface DropSpot<T> {
  readonly drop: T;
  readonly line: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface TrackDragOptions<T> {
  /** L'elemento della traccia presa, che si attenua mentre la si porta. */
  readonly source: HTMLElement;
  /** Il posto sotto il puntatore (null: lì non si può lasciare). */
  spotAt(e: PointerEvent): DropSpot<T> | null;
  drop(target: T): void;
}

/** Da un pointerdown su una traccia: il clic resta un clic, il trascinamento la sposta. */
export function startTrackDrag<T>(down: PointerEvent, o: TrackDragOptions<T>): void {
  let line: HTMLElement | null = null;
  let spot: DropSpot<T> | null = null;
  const move = (e: PointerEvent) => {
    if (!line) {
      if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < 5) return;
      line = el('div', { className: 'track-drop-line' });
      document.body.append(line);
      document.body.classList.add('track-dragging');
      getSelection()?.removeAllRanges();
      o.source.classList.add('dragging');
    }
    spot = o.spotAt(e);
    line.hidden = !spot;
    if (!spot) return;
    const r = spot.line;
    Object.assign(line.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
  const end = (dropped: boolean) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('keydown', key, true);
    if (!line) return;
    line.remove();
    document.body.classList.remove('track-dragging');
    o.source.classList.remove('dragging');
    // il clic che segue il rilascio non apre niente
    const swallow = (e: MouseEvent) => e.stopPropagation();
    window.addEventListener('click', swallow, true);
    setTimeout(() => window.removeEventListener('click', swallow, true));
    if (dropped && spot) o.drop(spot.drop);
  };
  const up = () => end(true);
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !line) return;
    e.preventDefault();
    e.stopPropagation();
    end(false);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('keydown', key, true);
}

/** Vero se il pointerdown può cominciare un trascinamento: tasto sinistro, senza Maiusc o Ctrl
 *  (che allargano la scelta), e non su un controllo dell'intestazione. */
export const canStartTrackDrag = (e: PointerEvent): boolean =>
  e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey
  && !(e.target as HTMLElement).closest('button, input, select, textarea, .knob, .midi-slot, .level-meter');
