/* The browser's search, as rows: all the sources, the chosen one first; each result with the folders it's in. */
import type { BrowserSource } from '../../browser/item';
import { searchSources } from '../../browser/search';
import { message, type Row } from './browser-tree';

/** The rows for `query`: the results, or a notice (nothing found, a source that can't be read). */
export async function searchRows(sources: readonly BrowserSource[], chosen: BrowserSource, query: string): Promise<Row[]> {
  try {
    const others = sources.filter(s => s !== chosen);
    const found = await searchSources([chosen, ...others], query);
    return found.length ? found.map(h => ({ item: h.item, depth: 0, path: h.path })) : [{ note: `Nothing for «${query}».`, depth: 0 }];
  } catch (e) {
    return [{ note: `Can't be read: ${message(e)}`, depth: 0 }];
  }
}
