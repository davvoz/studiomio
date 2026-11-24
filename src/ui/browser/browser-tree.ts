/* The browser's tree, without the DOM: the folders already read (or being read, locked, unreadable),
 * the open ones, the rows they make. A folder is read the first time it's shown; when it's done
 * the view is told (`changed`) and draws again. */
import { childrenOf, type BrowserItem, type BrowserSource } from '../../browser/item';

/** A row of the list: an item (at a depth, and where it comes from if it's a search
 *  result) or a notice (loading, empty list, permission to give). */
export type Row =
  | { readonly item: BrowserItem; readonly depth: number; readonly path?: readonly string[] }
  | { readonly note: string; readonly depth: number; readonly action?: { readonly label: string; readonly run: () => void } };

/** A row with an item. */
export type ListRow = Extract<Row, { readonly item: BrowserItem }>;

/** A folder's content: the items, or how far along it is. */
export type Loaded = readonly BrowserItem[] | 'loading' | 'locked' | Error;

/** Where a source's top level is kept (the deeper folders by the item's id). */
export const rootKey = (sourceId: string) => `source:${sourceId}`;

export const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class BrowserTree {
  /** The content of the folders already read: "source:id" for the first level, the item's id for the others. */
  private readonly loaded = new Map<string, Loaded>();
  private readonly expanded = new Set<string>();

  /** `changed`: a folder was read (or couldn't be). */
  constructor(private readonly changed: () => void) {}

  isOpen(id: string): boolean {
    return this.expanded.has(id);
  }

  /** Opens or closes the folder. */
  toggle(id: string): void {
    if (this.expanded.has(id)) this.expanded.delete(id);
    else this.expanded.add(id);
  }

  /** A source's content must be reread. */
  invalidate(sourceId: string): void {
    for (const key of this.loaded.keys()) if (key === rootKey(sourceId) || key.startsWith(`${sourceId}/`)) this.loaded.delete(key);
  }

  /** The rows of `source`, with the open folders' items under them; `unlock` asks for a locked source's permission. */
  rows(source: BrowserSource, unlock: (source: BrowserSource) => void): Row[] {
    const rows: Row[] = [];
    const add = (state: Loaded, depth: number, empty: string) => {
      if (state === 'loading') rows.push({ note: 'Reading…', depth });
      else if (state === 'locked') rows.push({ note: 'Reading this folder needs your permission.', depth, action: { label: 'Allow', run: () => unlock(source) } });
      else if (state instanceof Error) rows.push({ note: `Can't read it: ${state.message}`, depth });
      else if (!state.length) rows.push({ note: empty, depth });
      else for (const item of state) {
        rows.push({ item, depth });
        if (item.children && this.expanded.has(item.id)) add(this.contents(item.id, () => childrenOf(item)), depth + 1, 'Empty');
      }
    };
    add(this.contents(rootKey(source.id), () => source.items(), source), 0, source.empty ?? 'Empty');
    return rows;
  }

  /** A folder's content: the one already read, or it starts reading it. */
  private contents(key: string, read: () => Promise<readonly BrowserItem[]>, source?: BrowserSource): Loaded {
    const known = this.loaded.get(key);
    if (known) return known;
    this.loaded.set(key, 'loading');
    void (async () => {
      try {
        if (source?.locked && await source.locked()) return this.loaded.set(key, 'locked');
        this.loaded.set(key, await read());
      } catch (e) {
        this.loaded.set(key, e instanceof Error ? e : new Error(String(e)));
      }
    })().finally(() => this.changed());
    return 'loading';
  }
}
