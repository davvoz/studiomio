/** Una vista dell'area in basso (editor audio, piano roll, strumento). */
export interface BottomView {
  readonly element: HTMLElement;
  readonly isOpen: boolean;
  close(): void;
}

/** L'area sotto la timeline: mostra una vista alla volta. */
export class BottomPanel {
  readonly element = Object.assign(document.createElement('div'), { className: 'bottom' });
  private readonly views: BottomView[] = [];

  add(...views: BottomView[]): void {
    this.views.push(...views);
    this.element.append(...views.map(v => v.element));
  }

  /** La vista aperta, se ce n'è una. */
  get open(): BottomView | null {
    return this.views.find(v => v.isOpen) ?? null;
  }

  closeAll(): void {
    for (const v of this.views) if (v.isOpen) v.close();
  }

  /** Apre `view` con `open` (che dice se ci è riuscita) e chiude le altre. */
  show(view: BottomView, open: () => boolean): boolean {
    for (const v of this.views) if (v !== view && v.isOpen) v.close();
    return open();
  }
}
