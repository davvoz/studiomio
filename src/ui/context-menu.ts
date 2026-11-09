/* Context menu (right click). The items are data: whoever opens the menu says what to show,
 * the menu takes care of position, keyboard and closing. Only one open at a time. */

export interface MenuAction {
  readonly label: string;
  /** Shortcut to show on the right (text only). */
  readonly shortcut?: string;
  readonly disabled?: boolean;
  /** For the items that turn on and off. */
  readonly checked?: boolean;
  readonly run: () => void;
}

/** A row of colour swatches, plus one to remove the colour. */
export interface MenuColors {
  readonly colors: readonly string[];
  /** The current colour (absent: none), marked in the row. */
  readonly current?: string;
  /** Without the «no colour» swatch: a colour is required (for example for tracks). */
  readonly required?: boolean;
  /** The tooltip of the «no colour» swatch (what happens choosing it). */
  readonly noneTitle?: string;
  /** Receives the chosen colour, or undefined for «no colour». */
  readonly pick: (color: string | undefined) => void;
}

export const SEPARATOR = 'separator' as const;

export type MenuItem = MenuAction | MenuColors | typeof SEPARATOR;

/** For whoever opens the menu from a bar (the drop-down menus). */
export interface MenuOptions {
  /** Called when the menu closes, for whatever reason. */
  readonly onClose?: () => void;
  /** Extra keys handled by whoever opened the menu (for example ← and → to go to the next menu). */
  readonly keys?: Readonly<Record<string, () => void>>;
}

let current: { close(): void } | null = null;

/** Opens the menu at point (x, y) of the window. */
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
          className: color ? 'swatch' : 'swatch none', role: 'menuitem', title: color ? color : item.noneTitle ?? 'No colour',
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
  // inside the window even near the edges
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
    e.stopPropagation(); // keys don't reach the timeline while the menu is open
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

/** The shortcuts as they're written in the menus. */
export const KEY = {
  cut: 'Ctrl+X', copy: 'Ctrl+C', paste: 'Ctrl+V', duplicate: 'Ctrl+D', duplicateLoop: 'Ctrl+Shift+D', delete: 'Del',
  split: 'Ctrl+E', consolidate: 'Ctrl+J', selectAll: 'Ctrl+A', quantize: 'Q', draw: 'B', shapes: 'F',
} as const;
