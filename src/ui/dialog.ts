/* Simple modal dialogs: title, content, buttons at the bottom. Esc closes them. */

export function showDialog(title: string, ...content: Node[]): void {
  void openDialog(title, content, [{ label: 'Close', value: null }]);
}

export interface DialogButton<T> {
  readonly label: string;
  readonly value: T;
  /** The main button (highlighted, with the focus). */
  readonly primary?: boolean;
}

/** Asks to choose among some buttons; null if the dialog is closed another way (Esc, click outside). */
export function choose<T>(title: string, message: string, buttons: readonly DialogButton<T>[]): Promise<T | null> {
  return openDialog(title, [Object.assign(document.createElement('p'), { textContent: message })], buttons);
}

function openDialog<T>(title: string, content: readonly Node[], buttons: readonly DialogButton<T>[]): Promise<T | null> {
  const dialog = Object.assign(document.createElement('dialog'), { className: 'dialog' });
  let result: T | null = null;
  const footer = document.createElement('footer');
  const elements = buttons.map(b => Object.assign(document.createElement('button'), {
    textContent: b.label, className: b.primary ? 'primary' : '', onclick: () => { result = b.value; dialog.close(); },
  }));
  footer.append(...elements);
  const focused = elements[buttons.findIndex(b => b.primary)] ?? elements.at(-1)!;
  // the box inside the dialog: the background around it is the dialog itself
  const body = Object.assign(document.createElement('div'), { className: 'dialog-body' });
  body.append(Object.assign(document.createElement('h2'), { textContent: title }), ...content, footer);
  dialog.append(body);
  // the keys stay in the dialog: Space doesn't start the music underneath
  dialog.addEventListener('keydown', e => e.stopPropagation());
  const closed = new Promise<T | null>(resolve => dialog.addEventListener('close', () => { dialog.remove(); resolve(result); }));
  // a click outside the dialog (on the background) closes it
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  document.body.append(dialog);
  dialog.showModal();
  focused.focus({ preventScroll: true });
  return closed;
}

/** Rows [left, right] divided into sections with a title, one table per section. */
export function definitionTable(sections: readonly { readonly title: string; readonly rows: readonly (readonly [string, string])[] }[]): HTMLElement {
  const box = Object.assign(document.createElement('div'), { className: 'definitions' });
  for (const s of sections) {
    const table = document.createElement('table');
    Object.assign(table.createCaption(), { textContent: s.title });
    for (const [left, right] of s.rows) {
      const row = table.insertRow();
      row.insertCell().textContent = left;
      Object.assign(row.insertCell(), { textContent: right, className: 'key' });
    }
    box.append(table);
  }
  return box;
}
