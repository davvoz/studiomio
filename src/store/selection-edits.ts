/* Modifiche su più clip posate insieme (la selezione della timeline). */
import type { IdFactory, PlacementId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { between, keepBetween, placementEnd, type Placement } from '../model/arrangement';
import { AudioClip } from '../model/audio-clip';
import { paletteColor } from '../model/colors';
import type { TimeRange } from '../model/note-edits';
import type { Project } from '../model/project';
import type { SampleRef } from '../model/sample';
import { AudioTrack, GroupTrack } from '../model/track';
import { resizePlacement } from './edits';
import { edit, type Edit } from './project-store';

/** Una clip posata, indicata dalla sua traccia. */
export interface PlacementRef {
  readonly track: TrackId;
  readonly id: PlacementId;
}

export interface Relocation extends PlacementRef {
  readonly to: TrackId;
  readonly start: Beats;
  /** Vero per lasciare l'originale dov'è e posare una copia. */
  readonly copy: boolean;
}

/** I nuovi bordi di una clip posata. */
export interface ResizePlan extends PlacementRef {
  readonly start: Beats;
  readonly end: Beats;
}

export function findPlacement(p: Project, ref: PlacementRef): Placement | undefined {
  return p.track(ref.track)?.placement(ref.id);
}

/** Sposta o copia più clip in una volta. Prima si tolgono tutte quelle da spostare, poi si
 *  posano tutte: così una clip non taglia un'altra della selezione che sta per spostarsi. */
export const relocate = (label: string, moves: readonly Relocation[]): Edit =>
  edit(label, (project, { ids }) => {
    const found = moves.map(m => {
      const pl = findPlacement(project, m);
      if (!pl) throw new Error(`clip ${m.id} non trovata`);
      return { m, pl };
    });
    let p = project;
    for (const { m } of found) if (!m.copy) p = p.updatingTrack(m.track, t => t.removingPlacement(m.id));
    for (const { m, pl } of found) {
      const placed: Placement = m.copy
        ? { ...pl, id: ids.next('placement'), clip: pl.clip.withId(ids.next('clip')), start: Math.max(0, m.start) }
        : { ...pl, start: Math.max(0, m.start) };
      p = p.updatingTrack(m.to, t => t.placing(placed, ids));
    }
    return p;
  });

/** Ridimensiona più clip in una volta (un solo passo di annullamento). */
export const resizeMany = (plans: readonly ResizePlan[]): Edit =>
  edit('Ridimensiona clip', (p, ctx) =>
    plans.reduce((acc, r) => (findPlacement(acc, r) ? resizePlacement(r.track, r.id, r).apply(acc, ctx) : acc), p));

export const deleteMany =(refs: readonly PlacementRef[]): Edit =>
  edit('Elimina clip', p =>
    refs.reduce((acc, r) => (findPlacement(acc, r) ? acc.updatingTrack(r.track, t => t.removingPlacement(r.id)) : acc), p));

/** Copia la selezione subito dopo la sua fine, come Ctrl+D in Live. */
export const duplicateMany = (refs: readonly PlacementRef[]): Edit =>
  edit('Duplica', (p, ctx) => {
    const pls = refs.map(r => ({ r, pl: findPlacement(p, r) })).filter(x => x.pl) as { r: PlacementRef; pl: Placement }[];
    if (!pls.length) return p;
    const span = Math.max(...pls.map(x => placementEnd(x.pl))) - Math.min(...pls.map(x => x.pl.start));
    return relocate('Duplica', pls.map(({ r, pl }) => ({ ...r, to: r.track, start: pl.start + span, copy: true }))).apply(p, ctx);
  });

/** Copia il tratto della regione di loop, su tutte le tracce, subito dopo il loop (la copia prende
 *  il posto di ciò che c'era, vuoti compresi) e sposta il loop sulla copia: ripetendo si allunga
 *  il brano un giro alla volta, come Ctrl+D sul loop in Live. */
export const duplicateLoopRegion = (): Edit =>
  edit('Duplica loop', (project, { ids }) => {
    const { start, end } = project.loop, len = end - start;
    const p = project.tracks.reduce((acc, track) => {
      if (!between(track.arrangement, start, end + len).length) return acc;
      const pieces = between(track.arrangement, start, end).flatMap(pl => keepBetween(pl, start, end, pl.id) ?? []);
      return acc.updatingTrack(track.id, t => pieces.reduce(
        (tt, pl) => tt.placing({ ...pl, id: ids.next('placement'), clip: pl.clip.withId(ids.next('clip')), start: pl.start + len }, ids),
        t.clearing(end, end + len, ids),
      ));
    }, project);
    return p.withLoop({ start: end, end: end + len });
  });

/** Divide nel punto `at` le clip della selezione che lo attraversano. */
export const splitMany = (refs: readonly PlacementRef[], at: Beats): Edit =>
  edit('Dividi', (p, { ids }) => refs.reduce((acc, r) => {
    const pl = findPlacement(acc, r);
    return pl && pl.start < at && placementEnd(pl) > at ? acc.updatingTrack(r.track, t => t.splitting(r.id, at, ids)) : acc;
  }, p));

/** Divide ai bordi di [from, to) le clip della selezione che li attraversano: il tratto dentro
 *  diventa una clip a sé. Prima la fine (la parte sinistra tiene l'id), poi l'inizio. */
export const splitRange = (refs: readonly PlacementRef[], from: Beats, to: Beats): Edit =>
  edit('Dividi', (p, ctx) => splitMany(refs, from).apply(splitMany(refs, to).apply(p, ctx), ctx));

/** Come in Live, agire su una selezione di tempo divide le clip ai suoi bordi: il progetto
 *  diviso e i pezzi dentro il tratto, uno per clip selezionata. */
export function cutOutRange(project: Project, ids: IdFactory, refs: readonly PlacementRef[], range: TimeRange): { project: Project; pieces: PlacementRef[] } {
  const next = splitRange(refs, range.start, range.end).apply(project, { ids });
  const pieces = refs.flatMap(r => {
    const pl = findPlacement(project, r);
    if (!pl) return [];
    const start = Math.max(pl.start, range.start);
    const piece = next.track(r.track)?.arrangement.find(x => Math.abs(x.start - start) < 1e-9 && x.start < range.end);
    return piece ? [{ track: r.track, id: piece.id }] : [];
  });
  return { project: next, pieces };
}

/** Aggiunge un sample (se non è già nel progetto) e lo posa: sulla traccia indicata se è audio,
 *  altrimenti su una nuova. */
export const importSample = (sample: SampleRef, target: TrackId | null, start: Beats): Edit =>
  edit('Importa audio', (p, { ids }) => {
    let next = p.sample(sample.id) ? p : p.addingSample(sample);
    let trackId = target && next.track(target)?.kind === 'audio' ? target : null;
    if (!trackId) {
      const t = AudioTrack.empty(ids.next('track'), sample.name, paletteColor(next.tracks.length), next.scenes.length);
      // su un gruppo la traccia nuova va in fondo al gruppo
      next = target && next.track(target) instanceof GroupTrack ? next.addingTrack(t.withGroup(target), next.blockEnd(target)) : next.addingTrack(t);
      trackId = t.id;
    }
    const color = next.track(trackId)!.color;
    const clip = AudioClip.fromSample(ids.next('clip'), sample, color);
    const placement: Placement = { id: ids.next('placement'), clip, start: Math.max(0, start), length: clip.region.end - clip.region.start, offset: 0 };
    return next.updatingTrack(trackId, t => t.placing(placement, ids));
  });

/** Clip posate presenti in `next` ma non in `prev` (per selezionare ciò che si è appena creato). */
export function addedPlacements(prev: Project, next: Project): PlacementRef[] {
  const old = new Set(prev.tracks.flatMap(t => t.arrangement.map(p => p.id)));
  return next.tracks.flatMap(t => t.arrangement.filter(p => !old.has(p.id)).map(p => ({ track: t.id, id: p.id })));
}
