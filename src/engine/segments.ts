import type { Beats } from '../core/music-time';
import type { Placement } from '../model/arrangement';

/** Un tratto continuo di una clip sulla timeline: da `start` a `end` suona il contenuto
 *  della clip a partire dal battito `contentStart`, senza salti. */
export interface Segment {
  readonly start: Beats;
  readonly end: Beats;
  readonly contentStart: Beats;
}

const EPS = 1e-9;

/** Scompone una clip posata nei suoi tratti continui: uno se la clip non è in loop,
 *  uno per ogni giro (più l'eventuale attacco prima del loop) se lo è. */
export function placementSegments(p: Placement): Segment[] {
  const { clip } = p;
  const out: Segment[] = [];
  const endElapsed = p.offset + p.length;
  let elapsed = p.offset;
  while (endElapsed - elapsed > EPS) {
    const c = clip.contentBeatAt(elapsed);
    if (c === null) break;
    // fino al prossimo salto: la fine del loop o la fine della regione
    const limit = clip.loop.enabled ? clip.loop.end : clip.region.end;
    const len = Math.min(limit - c, endElapsed - elapsed);
    if (len <= EPS) break;
    const start = p.start + (elapsed - p.offset);
    out.push({ start, end: start + len, contentStart: c });
    elapsed += len;
  }
  return out;
}

/** Tratto di `s` da far partire in una finestra di programmazione, o null.
 *  `runStart`/`runEnd` delimitano la corsa continua del trasporto (dal play o dall'inizio
 *  del giro di loop fino alla fine del loop): un tratto già in corso all'inizio della corsa
 *  parte da lì, e niente suona oltre la fine della corsa. */
export function segmentToStart(
  s: Segment, window: { readonly from: Beats; readonly to: Beats; readonly runStart: Beats; readonly runEnd: Beats },
): Segment | null {
  const start = Math.max(s.start, window.runStart);
  const end = Math.min(s.end, window.runEnd);
  if (start < window.from - EPS || start >= window.to - EPS || end - start <= EPS) return null;
  return { start, end, contentStart: s.contentStart + (start - s.start) };
}
