import type { Beats } from '../../core/music-time';

/** Minimum width of the thumb, so it stays grabbable even with a long piece. */
const MIN_THUMB_PX = 24;

/** The stretch of timeline the bar represents and the visible one. */
export interface ScrollRange {
  /** How far you can scroll (start: beat 0). */
  readonly total: Beats;
  /** Beat at the left edge of the view. */
  readonly start: Beats;
  /** How many beats fit in the view. */
  readonly visible: Beats;
}

/** Horizontal bar under the timeline: dragging the thumb scrolls the view; a click
 *  outside the thumb brings the view there (centred) and you can keep dragging. */
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
    // the thumb moves (width - w) pixels for (total - visible) beats
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
        // outside the thumb: the view jumps there, centred on the point
        start = box.pxPerBeat > 0 ? (x - box.w / 2) / box.pxPerBeat : 0;
        start = Math.max(0, Math.min(range.total - range.visible, start));
        this.scrollTo(start);
      }
      // the range stays the one from the start: growing during the gesture it would make the thumb run away
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
