import type { Beats } from '../../core/music-time';

/** Larghezza minima del cursore, perché resti afferrabile anche con un brano lungo. */
const MIN_THUMB_PX = 24;

/** Il tratto di timeline che la barra rappresenta e quello che si vede. */
export interface ScrollRange {
  /** Fin dove si può scorrere (inizio: battito 0). */
  readonly total: Beats;
  /** Battito al bordo sinistro della vista. */
  readonly start: Beats;
  /** Quanti battiti entrano nella vista. */
  readonly visible: Beats;
}

/** Barra orizzontale sotto la timeline: trascinando il cursore la vista scorre; un clic
 *  fuori dal cursore porta lì la vista (centrata) e si può continuare a trascinare. */
export class TimelineScrollbar {
  readonly element = Object.assign(document.createElement('div'), { className: 'timeline-scroll' });
  private readonly thumb = Object.assign(document.createElement('div'), { className: 'thumb' });
  private range: ScrollRange = { total: 1, start: 0, visible: 1 };

  constructor(private readonly scrollTo: (beat: Beats) => void) {
    this.element.append(this.thumb);
    this.bind();
  }

  update(range: ScrollRange): void {
    this.range = range;
    const { x, w } = this.thumbBox(range, this.element.clientWidth);
    this.thumb.style.transform = `translateX(${x}px)`;
    this.thumb.style.width = `${w}px`;
  }

  private thumbBox(r: ScrollRange, width: number): { x: number; w: number; pxPerBeat: number } {
    const w = Math.min(width, Math.max(MIN_THUMB_PX, (r.visible / r.total) * width));
    // il cursore si muove in (width - w) pixel per (total - visible) battiti
    const span = Math.max(1e-9, r.total - r.visible);
    const pxPerBeat = (width - w) / span;
    return { x: Math.min(width - w, r.start * pxPerBeat), w, pxPerBeat };
  }

  private bind(): void {
    const el = this.element;
    let drag: { x: number; start: Beats; range: ScrollRange } | null = null;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const x = e.clientX - el.getBoundingClientRect().left;
      const range = this.range;
      const box = this.thumbBox(range, el.clientWidth);
      let start = range.start;
      if (x < box.x || x > box.x + box.w) {
        // fuori dal cursore: la vista salta lì, centrata sul punto
        start = box.pxPerBeat > 0 ? (x - box.w / 2) / box.pxPerBeat : 0;
        start = Math.max(0, Math.min(range.total - range.visible, start));
        this.scrollTo(start);
      }
      // la portata resta quella dell'inizio: allungandosi durante il gesto farebbe scappare il cursore
      drag = { x, start, range };
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', e => {
      if (!drag) return;
      const x = e.clientX - el.getBoundingClientRect().left;
      const { pxPerBeat } = this.thumbBox(drag.range, el.clientWidth);
      if (pxPerBeat <= 0) return;
      const start = drag.start + (x - drag.x) / pxPerBeat;
      this.scrollTo(Math.max(0, Math.min(drag.range.total - drag.range.visible, start)));
    });
    const end = () => {
      drag = null;
      el.classList.remove('dragging');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
}
