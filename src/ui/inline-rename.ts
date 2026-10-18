import { el } from './dom';

/** Rinomina sul posto: `label` diventa un campo di testo; Invio o un clic altrove confermano,
 *  Esc annulla. `commit` riceve il nome nuovo solo se è cambiato e non è vuoto. */
export function renameInline(label: HTMLElement, commit: (name: string) => void): void {
  const old = label.textContent ?? '';
  editInline(label, old, name => { if (name !== old) commit(name); });
}

/** Un nome scritto sul posto: `target` lascia il posto a un campo di testo che parte da
 *  `initial`; Invio o un clic altrove confermano, Esc annulla. `commit` riceve il testo solo se
 *  non è vuoto. */
export function editInline(target: HTMLElement, initial: string, commit: (text: string) => void, placeholder = ''): void {
  const input = el<HTMLInputElement>('input', { className: 'rename', value: initial, placeholder });
  let finished = false;
  const done = (save: boolean) => {
    if (finished) return;
    finished = true;
    const text = input.value.trim();
    input.replaceWith(target);
    if (save && text) commit(text);
  };
  input.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter') done(true);
    if (e.key === 'Escape') done(false);
  };
  input.onblur = () => done(true);
  input.onpointerdown = e => e.stopPropagation();
  target.replaceWith(input);
  input.select();
}
