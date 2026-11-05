/* Appunti dell'app (interni, non quelli del sistema): clip, note del piano roll, dispositivi o
 * un tratto di una curva di modulazione. Si copia una fotografia immutabile; incollare crea copie con id nuovi. */
import { asId, type TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { placementEnd, type Placement } from '../model/arrangement';
import type { Clip } from '../model/clip';
import type { EnvelopePoint, ModScale } from '../model/envelope';
import type { Note } from '../model/midi-clip';
import type { NoteChange, Selection } from '../model/note-edits';
import type { Project } from '../model/project';
import type { CopiedDevices } from './device-clipboard';
import { edit, type Edit } from './project-store';
import { findPlacement, type PlacementRef } from './selection-edits';
import type { SlotRef } from './session-edits';

/** Una clip copiata: la sua traccia è relativa alla prima traccia copiata, l'inizio al primo battito. */
export interface CopiedPlacement {
  readonly trackOffset: number;
  readonly placement: Placement;
  /** Copiata dalla session: la sua scena, relativa alla prima copiata. */
  readonly slotOffset?: number;
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

/** Un tratto di una curva di modulazione: si incolla su un altro parametro o in un'altra clip. */
export interface CopiedEnvelope {
  readonly kind: 'envelope';
  /** Battiti relativi all'inizio del tratto. */
  readonly points: readonly EnvelopePoint[];
  readonly span: Beats;
  /** Dove iniziava il tratto. */
  readonly origin: Beats;
  /** Il tipo di valori della curva: incollata su un altro tipo si riscala. */
  readonly scale: ModScale;
}

export type ClipboardContent = CopiedClips | CopiedNotes | CopiedDevices | CopiedEnvelope;

/** Il contenuto degli appunti, condiviso da timeline e piano roll. */
export class Clipboard {
  content: ClipboardContent | null = null;

  get clips(): CopiedClips | null {
    return this.content?.kind === 'clips' ? this.content : null;
  }

  get notes(): CopiedNotes | null {
    return this.content?.kind === 'notes' ? this.content : null;
  }

  get devices(): CopiedDevices | null {
    return this.content?.kind === 'devices' ? this.content : null;
  }

  get envelope(): CopiedEnvelope | null {
    return this.content?.kind === 'envelope' ? this.content : null;
  }
}

// ------------------------------------------------------------------ clip

/** Le posizioni delle tracce sono quelle delle righe della timeline (le tracce che si vedono). */
export function copyClips(project: Project, refs: readonly PlacementRef[]): CopiedClips | null {
  const found = refs.flatMap(r => {
    const pl = findPlacement(project, r);
    const index = project.visibleTracks.findIndex(t => t.id === r.track);
    return pl && index >= 0 ? [{ pl, index }] : [];
  });
  if (!found.length) return null;
  const top = Math.min(...found.map(f => f.index));
  const start = Math.min(...found.map(f => f.pl.start));
  return {
    kind: 'clips',
    items: found.map(({ pl, index }) => ({ trackOffset: index - top, placement: { ...pl, start: pl.start - start } })),
    span: Math.max(...found.map(f => placementEnd(f.pl))) - start,
    sourceTrack: project.visibleTracks[top].id,
  };
}

/** Incolla dal battito `at`, con la prima traccia copiata su quella di indice `firstTrack`.
 *  Le clip che finirebbero su una traccia che non c'è o di un altro tipo vengono saltate. */
export const pasteClips = (content: CopiedClips, firstTrack: number, at: Beats): Edit =>
  edit('Incolla', (project, { ids }) => content.items.reduce((p, { trackOffset, placement }) => {
    const track = p.visibleTracks[firstTrack + trackOffset];
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

// ------------------------------------------------------------------ session

/** Quanto dura una clip della session, se la si mette sulla timeline. */
const slotLength = (clip: Clip): Beats => (clip.loop.enabled ? clip.loop.end : clip.region.end) - clip.region.start;

/** La clip di uno slot negli appunti, come una clip copiata dalla timeline: si incolla in un
 *  altro slot o, al cursore, sulla timeline. */
export const copySlotClip = (project: Project, track: TrackId, slot: number): CopiedClips | null =>
  copySlotClips(project, [{ track, slot }]);

/** Le clip di più slot negli appunti, ricordando come stavano nella griglia: si incollano con la
 *  stessa forma da uno slot in poi. Sulla timeline le scene vanno una dopo l'altra. */
export function copySlotClips(project: Project, refs: readonly SlotRef[]): CopiedClips | null {
  const columns = new Map(project.visibleTracks.map((t, i) => [t.id, i]));
  const found = refs.flatMap(({ track, slot }) => {
    const clip = project.track(track)?.slots[slot], column = columns.get(track);
    return clip && column !== undefined ? [{ track, slot, clip, column, length: slotLength(clip) }] : [];
  });
  if (!found.length) return null;
  const left = Math.min(...found.map(f => f.column)), top = Math.min(...found.map(f => f.slot));
  // l'inizio di ogni scena: dopo la clip più lunga di quelle prima
  const rows = [...new Set(found.map(f => f.slot))].sort((a, b) => a - b);
  const starts = new Map<number, Beats>();
  const span = rows.reduce((at, row) => {
    starts.set(row, at);
    return at + Math.max(...found.filter(f => f.slot === row).map(f => f.length));
  }, 0);
  return {
    kind: 'clips', span, sourceTrack: found.find(f => f.column === left)!.track,
    items: found.map(f => ({
      trackOffset: f.column - left, slotOffset: f.slot - top,
      placement: { id: asId('copiata'), clip: f.clip, start: starts.get(f.slot)!, length: f.length, offset: 0 },
    })),
  };
}

/** Dove andrebbe ogni clip degli appunti incollata con la forma della griglia dallo slot dato. */
function gridTargets(p: Project, content: CopiedClips, track: TrackId, slot: number) {
  const tracks = p.visibleTracks, first = tracks.findIndex(t => t.id === track);
  return content.items.flatMap(({ trackOffset, slotOffset = 0, placement }) => {
    const t = tracks[first + trackOffset];
    return t?.accepts(placement.clip) ? [{ track: t.id, slot: slot + slotOffset, clip: placement.clip }] : [];
  });
}

/** Le clip degli appunti che hanno la forma di una griglia (copiate dalla session). */
const isGrid = (content: CopiedClips) => content.items.length > 1 && content.items.every(i => i.slotOffset !== undefined);

/** Gli slot che un incolla riempirà. */
export function pasteSlots(p: Project, content: CopiedClips, track: TrackId, slot: number): SlotRef[] {
  if (!isGrid(content)) return [{ track, slot }];
  return gridTargets(p, content, track, slot).map(t => ({ track: t.track, slot: t.slot }));
}

/** Incolla nello slot: più clip copiate dalla session riprendono la loro forma (quelle che
 *  finirebbero su una traccia che non c'è o di un altro tipo vengono saltate, e se servono si
 *  aggiungono scene in fondo); se no, la prima clip degli appunti che la traccia accetta. Sempre
 *  in loop, come le clip della session. Se non va bene nessuna, TypeError. */
export const pasteToSlot = (content: CopiedClips, track: TrackId, slot: number): Edit =>
  edit('Incolla', (p, { ids }) => {
    if (isGrid(content)) {
      const targets = gridTargets(p, content, track, slot);
      if (!targets.length) throw new TypeError('negli appunti non ci sono clip per queste tracce');
      let next = p;
      while (next.scenes.length <= Math.max(...targets.map(t => t.slot))) next = next.addingScene({ id: ids.next('scene'), name: String(next.scenes.length + 1) });
      return targets.reduce((q, t) => q.updatingTrack(t.track, x => x.withSlot(t.slot, t.clip.withId(ids.next('clip')).withLoop({ ...t.clip.loop, enabled: true }))), next);
    }
    const t = p.track(track);
    const clip = content.items.map(i => i.placement.clip).find(c => t?.accepts(c));
    if (!clip) throw new TypeError('negli appunti non ci sono clip per questa traccia');
    return p.updatingTrack(track, x => x.withSlot(slot, clip.withId(ids.next('clip')).withLoop({ ...clip.loop, enabled: true })));
  });
