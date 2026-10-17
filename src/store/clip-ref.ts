/* Dove sta una clip: sulla timeline di una traccia (un posizionamento) o in uno slot della
 * session (per id della clip, che non cambia se le scene si spostano). Gli editor lavorano
 * su un ClipRef e non devono sapere quale dei due. */
import type { ClipId, PlacementId, TrackId } from '../core/id';
import type { Placement } from '../model/arrangement';
import type { Clip } from '../model/clip';
import type { Project } from '../model/project';
import type { Track } from '../model/track';
import type { MidiClip } from '../model/midi-clip';
import { scaleMidiPlacement, updateClip } from './edits';
import type { Edit } from './project-store';
import { updateSlotClip } from './session-edits';

export type ClipRef =
  | { readonly kind: 'placement'; readonly track: TrackId; readonly placement: PlacementId }
  | { readonly kind: 'slot'; readonly track: TrackId; readonly clip: ClipId };

export const placementRef = (track: TrackId, placement: PlacementId): ClipRef => ({ kind: 'placement', track, placement });
export const slotRef = (track: TrackId, clip: ClipId): ClipRef => ({ kind: 'slot', track, clip });

/** Una clip trovata: la sua traccia e, se è sulla timeline, il suo posizionamento. */
export interface FoundClip {
  readonly track: Track;
  readonly clip: Clip;
  readonly placement: Placement | null;
}

type Locator<R extends ClipRef> = {
  find(track: Track, ref: R): Omit<FoundClip, 'track'> | null;
  update<C extends Clip>(label: string, ref: R, fn: (c: C) => Clip): Edit;
};

const LOCATORS: { readonly [K in ClipRef['kind']]: Locator<Extract<ClipRef, { kind: K }>> } = {
  placement: {
    find: (t, ref) => {
      const p = t.placement(ref.placement);
      return p ? { clip: p.clip, placement: p } : null;
    },
    update: (label, ref, fn) => updateClip(label, ref.track, ref.placement, fn),
  },
  slot: {
    find: (t, ref) => {
      const clip = t.slots.find(c => c?.id === ref.clip);
      return clip ? { clip, placement: null } : null;
    },
    update: (label, ref, fn) => updateSlotClip(label, ref.track, ref.clip, fn),
  },
};

const locator = <R extends ClipRef>(ref: R) => LOCATORS[ref.kind] as unknown as Locator<R>;

export function findClip(project: Project, ref: ClipRef): FoundClip | null {
  const track = project.track(ref.track);
  const found = track && locator(ref).find(track, ref);
  return found ? { track: track!, ...found } : null;
}

/** Modifica il contenuto della clip, dovunque stia. */
export const updateClipAt = <C extends Clip>(label: string, ref: ClipRef, fn: (c: C) => Clip): Edit => locator(ref).update(label, ref, fn);

/** Moltiplica il tempo di una clip MIDI (×2, :2): sulla timeline cambia anche la sua durata,
 *  nella session solo il contenuto. */
export const scaleMidiClipAt = (label: string, ref: ClipRef, factor: number): Edit =>
  ref.kind === 'placement'
    ? scaleMidiPlacement(label, ref.track, ref.placement, factor)
    : updateSlotClip<MidiClip>(label, ref.track, ref.clip, c => c.scaledTime(factor));

const idOf = (r: ClipRef): string => (r.kind === 'placement' ? r.placement : r.clip);

export const sameClipRef = (a: ClipRef | null, b: ClipRef | null): boolean =>
  !!a && !!b && a.kind === b.kind && a.track === b.track && idOf(a) === idOf(b);
