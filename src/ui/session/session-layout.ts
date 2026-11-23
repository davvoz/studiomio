/* The session grid's layout, as CSS grid values: rows (headers, a row per scene, stop, space,
 * mixer) and columns (the tracks, the leftover space, the buses pinned next to the master). */
import type { BusTrack } from '../../model/track';
import type { SessionRing } from '../ui-state';

/** Grid rows: headers, one per scene, stop, space, mixer. */
export const row = {
  head: 1,
  scene: (s: number): number => 2 + s,
  stop: (scenes: number): number => 2 + scenes,
  mixer: (scenes: number): number => 4 + scenes,
};

/** Bus `i`'s column (with `tracks` track columns): after the leftover space, next to the master. */
export const busColumn = (tracks: number, i: number): number => tracks + 2 + i;

/** The master's column. */
export const masterColumn = (tracks: number, buses: number): number => tracks + buses + 2;

/** A bus column's width: narrow if it's collapsed. */
export const busWidth = (b: BusTrack): string => (b.folded ? 'var(--session-folded)' : 'var(--session-col)');

/** For each bus the distance from the right edge: the master and the buses coming after it. */
export const busRights = (buses: readonly BusTrack[]): string[] =>
  buses.map((_, i) => {
    const after = buses.slice(i + 1).map(b => ` + ${busWidth(b)} + 2px`).join('');
    return `calc(var(--session-master) + 2px${after})`;
  });

/** grid-template-columns: the leftover space sits between the tracks and the buses, so buses and
 *  master stay on the right edge. */
export function gridColumns(tracks: number, buses: readonly BusTrack[]): string {
  const cols = tracks ? `repeat(${tracks}, var(--session-col)) ` : '';
  const busColumns = buses.map(b => `${busWidth(b)} `).join('');
  return `${cols}minmax(0, 1fr) ${busColumns}var(--session-master)`;
}

/** grid-template-rows for `scenes` scenes. */
export const gridRows = (scenes: number): string => `auto repeat(${scenes}, var(--session-row)) auto 1fr auto`;

/** The controller's box (`width` × `height` from track `track`, scene `scene`) clipped to the grid;
 *  null if it starts outside. */
export function ringArea(ring: SessionRing | null, tracks: number, scenes: number): { readonly row: number; readonly column: number; readonly rows: number; readonly columns: number } | null {
  if (!ring || ring.track >= tracks || ring.scene >= scenes) return null;
  return { row: row.scene(ring.scene), column: ring.track + 1, rows: Math.min(ring.height, scenes - ring.scene), columns: Math.min(ring.width, tracks - ring.track) };
}
