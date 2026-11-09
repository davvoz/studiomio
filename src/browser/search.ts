import { childrenOf, searchKey, type BrowserItem, type BrowserPayload, type BrowserSource } from './item';

/** A found item, with the folders containing it (to show where it comes from). */
export interface SearchHit {
  readonly item: BrowserItem;
  readonly path: readonly string[];
}

export interface SearchOptions {
  /** At most this many results (a big disk folder doesn't block the browser). */
  readonly limit?: number;
  /** How deep to go into folders. */
  readonly depth?: number;
}

/** The items (also inside folders) whose name contains all the words of `query`, in
 *  any order, ignoring case and accents. A matching folder counts
 *  as a result if it can be loaded (a device); its items are searched anyway. */
export async function search(roots: readonly BrowserItem[], query: string, { limit = 200, depth = 6 }: SearchOptions = {}): Promise<SearchHit[]> {
  const words = searchKey(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: SearchHit[] = [];
  const matches = (item: BrowserItem) => {
    const name = searchKey(item.name);
    return words.every(w => name.includes(w));
  };
  const walk = async (items: readonly BrowserItem[], path: readonly string[], level: number): Promise<void> => {
    for (const item of items) {
      if (hits.length >= limit) return;
      if ((item.payload || !item.children) && matches(item)) hits.push({ item, path });
      if (item.children && level < depth) await walk(await childrenOf(item), [...path, item.name], level + 1);
    }
  };
  await walk(roots, [], 0);
  return hits;
}

/** What an item loads, as a key: the same thing in two sources (a kit in Instruments and in
 *  Drums, a user preset or rack in its category and among the User Presets) is
 *  only one. */
function payloadKey(item: BrowserItem): string {
  const p: BrowserPayload | undefined = item.payload;
  if (!p) return `item:${item.id}`;
  switch (p.kind) {
    case 'instrument':
    case 'effect': return `${p.kind}:${p.type}:${p.preset?.name ?? ''}`;
    case 'rack': return `rack:${p.rack.name}`;
    case 'sample': return `sample:${p.sample.id}`;
    case 'file': return `item:${item.id}`;
  }
}

/** Searches several sources, in the given order (the chosen one first): each result has as first
 *  folder the name of its source; what repeats in two sources appears only once, and the
 *  sources asking for a permission are skipped. */
export async function searchSources(sources: readonly BrowserSource[], query: string, { limit = 200, depth = 6 }: SearchOptions = {}): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (hits.length >= limit) break;
    if (source.locked && await source.locked()) continue;
    for (const h of await search(await source.items(), query, { limit, depth })) {
      const key = payloadKey(h.item);
      if (seen.has(key) || hits.length >= limit) continue;
      seen.add(key);
      hits.push({ item: h.item, path: [source.label, ...h.path] });
    }
  }
  return hits;
}
