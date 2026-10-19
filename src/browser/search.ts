import { childrenOf, searchKey, type BrowserItem, type BrowserPayload, type BrowserSource } from './item';

/** Una voce trovata, con le cartelle che la contengono (per mostrare da dove viene). */
export interface SearchHit {
  readonly item: BrowserItem;
  readonly path: readonly string[];
}

export interface SearchOptions {
  /** Al massimo tanti risultati (una cartella grande del disco non blocca il browser). */
  readonly limit?: number;
  /** Fin dove scendere nelle cartelle. */
  readonly depth?: number;
}

/** Le voci (anche dentro le cartelle) il cui nome contiene tutte le parole di `query`, in
 *  qualsiasi ordine, senza badare a maiuscole e accenti. Una cartella che corrisponde vale
 *  come risultato se si può caricare (un dispositivo); le sue voci si cercano comunque. */
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

/** Ciò che una voce carica, come chiave: la stessa cosa in due fonti (un kit in Strumenti e in
 *  Batterie, un preset dell'utente nel suo dispositivo e tra i Preset dell'utente) è una sola. */
function payloadKey(item: BrowserItem): string {
  const p: BrowserPayload | undefined = item.payload;
  if (!p) return `item:${item.id}`;
  switch (p.kind) {
    case 'instrument':
    case 'effect': return `${p.kind}:${p.type}:${p.preset?.name ?? ''}`;
    case 'sample': return `sample:${p.sample.id}`;
    case 'file': return `item:${item.id}`;
  }
}

/** Cerca in più fonti, nell'ordine dato (prima quella scelta): ogni risultato ha come prima
 *  cartella il nome della sua fonte; ciò che si ripete in due fonti compare una volta sola, e le
 *  fonti che chiedono un permesso si saltano. */
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
