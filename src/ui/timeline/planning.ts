/* Calcoli dei gesti sulla timeline: dove finiscono le clip trascinate o ridimensionate.
 * Funzioni pure, usate sia per l'anteprima durante il trascinamento sia per la modifica
 * finale al rilascio. */
import type { PlacementId } from '../../core/id';
import type { Beats } from '../../core/music-time';
import { placementEnd, type Placement } from '../../model/arrangement';
import type { Project } from '../../model/project';
import type { PlacementRef, Relocation } from '../../store/selection-edits';
import { findPlacement } from '../../store/selection-edits';
import { snapTo } from './geometry';

/** Le clip selezionate, con la loro traccia attuale (gli id delle clip sono unici nel progetto). */
export function resolveSelection(project: Project, ids: ReadonlySet<PlacementId>): PlacementRef[] {
  return project.tracks.flatMap(t => t.arrangement.filter(p => ids.has(p.id)).map(p => ({ track: t.id, id: p.id })));
}

/** Spostamento in battiti tale che la clip presa (che partiva da `start`) finisca sulla griglia. */
export function snappedDelta(start: Beats, rawDelta: Beats, step: Beats | null): Beats {
  const target = Math.max(0, start + rawDelta);
  return (step ? snapTo(target, step) : target) - start;
}

/** Dove vanno le clip selezionate spostandole di `deltaBeats` e `deltaTracks` righe (le tracce
 *  che si vedono). Se una traccia di arrivo non esiste o non accetta la clip (un gruppo non ne
 *  accetta), le clip restano sulle loro tracce. */
export function planMove(project: Project, refs: readonly PlacementRef[], deltaBeats: Beats, deltaTracks: number, copy: boolean): Relocation[] {
  const rows = project.visibleTracks;
  const index = new Map(rows.map((t, i) => [t.id, i]));
  const items = refs.map(r => ({ r, pl: findPlacement(project, r)! })).filter(x => x.pl && index.has(x.r.track));
  const fits = (dt: number) => items.every(({ r, pl }) => {
    const target = rows[index.get(r.track)! + dt];
    return target !== undefined && target.accepts(pl.clip);
  });
  const dt = deltaTracks !== 0 && fits(deltaTracks) ? deltaTracks : 0;
  return items.map(({ r, pl }) => ({
    ...r, copy,
    to: rows[index.get(r.track)! + dt].id,
    start: Math.max(0, pl.start + deltaBeats),
  }));
}

/** Nuovi bordi trascinando quello sinistro (`start`) o destro (`end`) fino a `beat`.
 *  A sinistra non si va oltre l'inizio del contenuto; a destra, se la clip non è in loop,
 *  non oltre la fine del contenuto. */
export function planResize(pl: Placement, edge: 'start' | 'end', beat: Beats, minLength: Beats): { start: Beats; end: Beats } {
  const end = placementEnd(pl);
  if (edge === 'start') {
    const earliest = Math.max(0, pl.start - pl.offset);
    return { start: Math.min(Math.max(beat, earliest), end - minLength), end };
  }
  const latest = pl.start + pl.clip.playLength - pl.offset;
  return { start: pl.start, end: Math.max(pl.start + minLength, Math.min(beat, latest)) };
}
