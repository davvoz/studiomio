/* What the keys and the context menu do on the browser's list, without the DOM. The arrows move
 * through the items, → opens a folder (or enters it), ← closes it (or goes to the one containing
 * the item), Enter loads (or opens). Search results are flat: they don't open. */
import type { BrowserItem } from '../../browser/item';
import { SEPARATOR, type MenuItem } from '../context-menu';
import type { ListRow, Row } from './browser-tree';

/** What a key asks the view: choose an item (and show it), open or close a folder, load an item,
 *  go back to the search; `none`: the key is the list's but there's nothing to do. */
export type BrowserAction =
  | { readonly kind: 'select'; readonly item: BrowserItem }
  | { readonly kind: 'toggle'; readonly item: BrowserItem }
  | { readonly kind: 'load'; readonly item: BrowserItem }
  | { readonly kind: 'search' }
  | { readonly kind: 'none' };

const NONE: BrowserAction = { kind: 'none' };

/** The key `key` on the list with `rows`, `selected` chosen; null if the key isn't the list's. */
export function browserKey(key: string, rows: readonly Row[], selected: string | null, isOpen: (id: string) => boolean): BrowserAction | null {
  const items = rows.filter((r): r is ListRow => 'item' in r);
  const at = items.findIndex(r => r.item.id === selected);
  const current = at >= 0 ? items[at] : undefined;
  const go = (k: number): BrowserAction => {
    const next = items[Math.max(0, Math.min(items.length - 1, k))];
    return next ? { kind: 'select', item: next.item } : NONE;
  };
  switch (key) {
    case 'ArrowDown': return go(at + 1);
    case 'ArrowUp':
      if (at <= 0 && !current) return go(0);
      return at === 0 ? { kind: 'search' } : go(at - 1);
    case 'Home': return go(0);
    case 'End': return go(items.length - 1);
    case 'ArrowRight': return openFolder(current, isOpen, () => go(at + 1));
    case 'ArrowLeft': return closeFolder(current, items.slice(0, at), isOpen);
    case 'Enter': return enter(current);
    default: return null;
  }
}

/** → on a closed folder opens it; on an open one goes to its first item (`down`). */
function openFolder(current: ListRow | undefined, isOpen: (id: string) => boolean, down: () => BrowserAction): BrowserAction {
  if (!current?.item.children || current.path) return NONE;
  return isOpen(current.item.id) ? down() : { kind: 'toggle', item: current.item };
}

/** ← on an open folder closes it; otherwise it goes to the folder containing the item (among `above`). */
function closeFolder(current: ListRow | undefined, above: readonly ListRow[], isOpen: (id: string) => boolean): BrowserAction {
  if (!current || current.path) return NONE;
  if (current.item.children && isOpen(current.item.id)) return { kind: 'toggle', item: current.item };
  const parent = [...above].reverse().find(r => r.depth < current.depth);
  return parent ? { kind: 'select', item: parent.item } : NONE;
}

function enter(current: ListRow | undefined): BrowserAction {
  if (current?.item.payload) return { kind: 'load', item: current.item };
  if (current?.item.children) return { kind: 'toggle', item: current.item };
  return NONE;
}

/** What the item's menu can do. */
export interface ItemMenuActions {
  /** The item's folder is open. */
  readonly open: boolean;
  /** The item is a sample and there's a preview. */
  readonly canListen: boolean;
  load(): void;
  listen(): void;
  toggle(): void;
}

/** The item's context menu: load, listen, open or close (not for a search result, `flat`). */
export function itemMenu(item: BrowserItem, flat: boolean, a: ItemMenuActions): MenuItem[] {
  const items: MenuItem[] = [];
  if (item.payload) items.push({ label: 'Load', shortcut: 'Enter', run: () => a.load() });
  if (a.canListen) items.push({ label: 'Listen', run: () => a.listen() });
  if (item.children && !flat) items.push(...(items.length ? [SEPARATOR] : []), { label: a.open ? 'Close' : 'Open', shortcut: a.open ? '◂' : '▸', run: () => a.toggle() });
  return items;
}
