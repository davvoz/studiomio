import { el } from './dom';

/** Rename in place: `label` becomes a text field; Enter or a click elsewhere confirm,
 *  Esc cancels. `commit` receives the new name only if it changed and isn't empty. */
export function renameInline(label: HTMLElement, commit: (name: string) => void): void {
  const old = label.textContent ?? '';
  editInline(label, old, name => { if (name !== old) commit(name); });
}

/** A name typed in place: `target` gives way to a text field starting from
 *  `initial`; Enter or a click elsewhere confirm, Esc cancels. `commit` receives the text only if
 *  it isn't empty. */
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
