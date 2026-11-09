/** A view of the bottom area (audio editor, piano roll, instrument). */
export interface BottomView {
  readonly element: HTMLElement;
  readonly isOpen: boolean;
  close(): void;
}

/** The area below the timeline: it shows one view at a time. */
export class BottomPanel {
  readonly element = Object.assign(document.createElement('div'), { className: 'bottom' });
  private readonly views: BottomView[] = [];

  add(...views: BottomView[]): void {
    this.views.push(...views);
    this.element.append(...views.map(v => v.element));
  }

  /** The open view, if there is one. */
  get open(): BottomView | null {
    return this.views.find(v => v.isOpen) ?? null;
  }

  closeAll(): void {
    for (const v of this.views) if (v.isOpen) v.close();
  }

  /** Opens `view` with `open` (which says whether it succeeded) and closes the others. */
  show(view: BottomView, open: () => boolean): boolean {
    for (const v of this.views) if (v !== view && v.isOpen) v.close();
    return open();
  }
}
