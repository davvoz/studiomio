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

/** Una riga di campioni di colore, più uno per togliere il colore. */
export interface MenuColors {
  readonly colors: readonly string[];
  /** Il colore attuale (assente: nessuno), segnato nella riga. */
  readonly current?: string;
  /** Senza il campione «nessun colore»: un colore ci vuole (per esempio per le tracce). */
  readonly required?: boolean;
  /** Il suggerimento del campione «nessun colore» (cosa succede sceglendolo). */
  readonly noneTitle?: string;
  /** Riceve il colore scelto, o undefined per «nessun colore». */
  readonly pick: (color: string | undefined) => void;
}

export const SEPARATOR = 'separator' as const;

export type MenuItem = MenuAction | MenuColors | typeof SEPARATOR;

/** Per chi apre il menu da una barra (i menu a tendina). */
export interface MenuOptions {
  /** Chiamata quando il menu si chiude, per qualunque motivo. */
  readonly onClose?: () => void;
  /** Tasti in più gestiti da chi ha aperto il menu (per esempio ← e → per passare al menu vicino). */
  readonly keys?: Readonly<Record<string, () => void>>;
}

let current: { close(): void } | null = null;

/** Apre il menu nel punto (x, y) della finestra. */
export function showContextMenu(x: number, y: number, items: readonly MenuItem[], options: MenuOptions = {}): void {
  current?.close();
  const menu = Object.assign(document.createElement('div'), { className: 'context-menu', role: 'menu', tabIndex: -1 });
  const buttons: HTMLButtonElement[] = [];
  for (const item of items) {
    if (item === SEPARATOR) {
      menu.append(Object.assign(document.createElement('div'), { className: 'separator' }));
      continue;
    }
    if ('colors' in item) {
      const row = Object.assign(document.createElement('div'), { className: 'swatches' });
      for (const color of item.required ? item.colors : [...item.colors, undefined]) {
        const s = Object.assign(document.createElement('button'), {
          className: color ? 'swatch' : 'swatch none', role: 'menuitem', title: color ? color : item.noneTitle ?? 'Nessun colore',
        });
        if (color) s.style.setProperty('--swatch', color);
        s.classList.toggle('current', color?.toLowerCase() === item.current?.toLowerCase());
        s.onclick = () => {
          close();
          item.pick(color);
        };
        s.onpointerenter = () => s.focus();
        buttons.push(s);
        row.append(s);
      }
      menu.append(row);
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
    ...options.keys,
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
    options.onClose?.();
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
  cut: 'Ctrl+X', copy: 'Ctrl+C', paste: 'Ctrl+V', duplicate: 'Ctrl+D', duplicateLoop: 'Ctrl+Maiusc+D', delete: 'Canc',
  split: 'Ctrl+E', consolidate: 'Ctrl+J', selectAll: 'Ctrl+A', quantize: 'Q', draw: 'B',
} as const;
