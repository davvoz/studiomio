/* Menu contestuale (tasto destro). Le voci sono dati: chi apre il menu dice cosa mostrare,
 * il menu si occupa di posizione, tastiera e chiusura. Uno solo aperto alla volta. */

export interface MenuAction {
  readonly label: string;
  /** Scorciatoia da mostrare a destra (solo testo). */
  readonly shortcut?: string;
  readonly disabled?: boolean;
  /** Per le voci che si accendono e spengono. */
  readonly checked?: boolean;
  readonly run: () => void;
}

export const SEPARATOR = 'separator' as const;

export type MenuItem = MenuAction | typeof SEPARATOR;

let current: { close(): void } | null = null;

/** Apre il menu nel punto (x, y) della finestra. */
export function showContextMenu(x: number, y: number, items: readonly MenuItem[]): void {
  current?.close();
  const menu = Object.assign(document.createElement('div'), { className: 'context-menu', role: 'menu', tabIndex: -1 });
  const buttons: HTMLButtonElement[] = [];
  for (const item of items) {
    if (item === SEPARATOR) {
      menu.append(Object.assign(document.createElement('div'), { className: 'separator' }));
      continue;
    }
    const b = Object.assign(document.createElement('button'), { className: 'item', disabled: !!item.disabled, role: 'menuitem' });
    b.append(
      Object.assign(document.createElement('span'), { className: 'check', textContent: item.checked ? '✓' : '' }),
      Object.assign(document.createElement('span'), { className: 'label', textContent: item.label }),
      Object.assign(document.createElement('span'), { className: 'shortcut', textContent: item.shortcut ?? '' }),
    );
    b.onclick = () => {
      close();
      item.run();
    };
    b.onpointerenter = () => b.focus();
    buttons.push(b);
    menu.append(b);
  }
  document.body.append(menu);
  // dentro la finestra anche vicino ai bordi
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  menu.focus();

  const enabled = () => buttons.filter(b => !b.disabled);
  const step = (dir: 1 | -1) => {
    const list = enabled();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    list[(i + dir + list.length) % list.length]?.focus();
  };
  const KEYS: Readonly<Record<string, () => void>> = {
    ArrowDown: () => step(1),
    ArrowUp: () => step(-1),
    Escape: () => close(),
    Tab: () => close(),
  };
  menu.addEventListener('keydown', e => {
    const action = KEYS[e.key];
    e.stopPropagation(); // i tasti non arrivano alla timeline mentre il menu è aperto
    if (!action) return;
    e.preventDefault();
    action();
  });
  const outside = (e: Event) => { if (!menu.contains(e.target as Node)) close(); };
  const close = () => {
    menu.remove();
    removeEventListener('pointerdown', outside, true);
    removeEventListener('wheel', outside, true);
    removeEventListener('blur', close);
    removeEventListener('resize', close);
    if (current === handle) current = null;
  };
  const handle = { close };
  current = handle;
  addEventListener('pointerdown', outside, true);
  addEventListener('wheel', outside, true);
  addEventListener('blur', close);
  addEventListener('resize', close);
}

/** Le scorciatoie come si scrivono nei menu. */
export const KEY = {
  cut: 'Ctrl+X', copy: 'Ctrl+C', paste: 'Ctrl+V', duplicate: 'Ctrl+D', delete: 'Canc',
  split: 'Ctrl+E', selectAll: 'Ctrl+A', quantize: 'Q', draw: 'B',
} as const;
