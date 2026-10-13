/* Appunti dell'app (interni, non quelli del sistema): clip della timeline oppure note del
 * piano roll. Si copia una fotografia immutabile; incollare crea copie con id nuovi. */
import type { TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { placementEnd, type Placement } from '../model/arrangement';
import type { Note } from '../model/midi-clip';
import type { NoteChange, Selection } from '../model/note-edits';
import type { Project } from '../model/project';
import { edit, type Edit } from './project-store';
import { findPlacement, type PlacementRef } from './selection-edits';

/** Una clip copiata: la sua traccia è relativa alla prima traccia copiata, l'inizio al primo battito. */
export interface CopiedPlacement {
  readonly trackOffset: number;
  readonly placement: Placement;
}

export interface CopiedClips {
  readonly kind: 'clips';
  readonly items: readonly CopiedPlacement[];
  /** Dall'inizio della prima clip alla fine dell'ultima. */
  readonly span: Beats;
  /** La traccia più in alto da cui si è copiato. */
  readonly sourceTrack: TrackId;
}

export interface CopiedNotes {
  readonly kind: 'notes';
  /** Inizi relativi alla prima nota; altezze invariate. */
  readonly notes: readonly Note[];
  readonly span: Beats;
  /** Dove iniziava la prima nota copiata. */
  readonly origin: Beats;
}

export type ClipboardContent = CopiedClips | CopiedNotes;

/** Il contenuto degli appunti, condiviso da timeline e piano roll. */
export class Clipboard {
  content: ClipboardContent | null = null;

  get clips(): CopiedClips | null {
    return this.content?.kind === 'clips' ? this.content : null;
  }

  get notes(): CopiedNotes | null {
    return this.content?.kind === 'notes' ? this.content : null;
  }
}

// ------------------------------------------------------------------ clip

export function copyClips(project: Project, refs: readonly PlacementRef[]): CopiedClips | null {
  const found = refs.flatMap(r => {
    const pl = findPlacement(project, r);
    const index = project.tracks.findIndex(t => t.id === r.track);
    return pl && index >= 0 ? [{ pl, index }] : [];
  });
  if (!found.length) return null;
  const top = Math.min(...found.map(f => f.index));
  const start = Math.min(...found.map(f => f.pl.start));
  return {
    kind: 'clips',
    items: found.map(({ pl, index }) => ({ trackOffset: index - top, placement: { ...pl, start: pl.start - start } })),
    span: Math.max(...found.map(f => placementEnd(f.pl))) - start,
    sourceTrack: project.tracks[top].id,
  };
}

/** Incolla dal battito `at`, con la prima traccia copiata su quella di indice `firstTrack`.
 *  Le clip che finirebbero su una traccia che non c'è o di un altro tipo vengono saltate. */
export const pasteClips = (content: CopiedClips, firstTrack: number, at: Beats): Edit =>
  edit('Incolla', (project, { ids }) => content.items.reduce((p, { trackOffset, placement }) => {
    const track = p.tracks[firstTrack + trackOffset];
    if (!track?.accepts(placement.clip)) return p;
    const placed: Placement = {
      ...placement, id: ids.next('placement'), clip: placement.clip.withId(ids.next('clip')), start: Math.max(0, at + placement.start),
    };
    return p.updatingTrack(track.id, t => t.placing(placed, ids));
  }, project));

// ------------------------------------------------------------------ note

export function copyNotes(notes: readonly Note[], sel: Selection): CopiedNotes | null {
  const chosen = notes.filter(n => sel.has(n));
  if (!chosen.length) return null;
  const origin = Math.min(...chosen.map(n => n.start));
  return {
    kind: 'notes',
    notes: chosen.map(n => ({ ...n, start: n.start - origin })),
    span: Math.max(...chosen.map(n => n.start + n.duration)) - origin,
    origin,
  };
}

/** Le note degli appunti a partire dal battito `at`; restano selezionate. */
export function pasteNotes(notes: readonly Note[], content: CopiedNotes, at: Beats): NoteChange {
  const pasted = content.notes.map(n => ({ ...n, start: Math.max(0, at) + n.start }));
  return { notes: [...notes, ...pasted], selected: pasted };
}
