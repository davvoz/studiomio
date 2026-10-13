import { el } from './dom';

/** Rinomina sul posto: `label` diventa un campo di testo; Invio o un clic altrove confermano,
 *  Esc annulla. `commit` riceve il nome nuovo solo se è cambiato e non è vuoto. */
export function renameInline(label: HTMLElement, commit: (name: string) => void): void {
  const old = label.textContent ?? '';
  const input = el<HTMLInputElement>('input', { className: 'rename', value: old });
  let finished = false;
  const done = (save: boolean) => {
    if (finished) return;
    finished = true;
    const name = input.value.trim();
    input.replaceWith(label);
    if (save && name && name !== old) commit(name);
  };
  input.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter') done(true);
    if (e.key === 'Escape') done(false);
  };
  input.onblur = () => done(true);
  input.onpointerdown = e => e.stopPropagation();
  label.replaceWith(input);
  input.select();
}
