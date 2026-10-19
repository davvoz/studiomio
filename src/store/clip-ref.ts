/* Dove sta una clip: sulla timeline di una traccia (un posizionamento) o in uno slot della
 * session (per id della clip, che non cambia se le scene si spostano). Gli editor lavorano
 * su un ClipRef e non devono sapere quale dei due. */
import type { ClipId, PlacementId, TrackId } from '../core/id';
import type { Placement } from '../model/arrangement';
import type { Clip, Color } from '../model/clip';
import type { Project } from '../model/project';
import type { Track } from '../model/track';
import type { MidiClip } from '../model/midi-clip';
import type { SampleRef } from '../model/sample';
import { scaleMidiPlacement, updateClip } from './edits';
import { edit, type Edit } from './project-store';
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

/** Il colore di più clip insieme (un solo passo da annullare); senza colore ognuna prende
 *  quello della sua traccia. */
export const setClipColor = (refs: readonly ClipRef[], color?: Color): Edit =>
  edit(refs.length === 1 ? 'Colore della clip' : 'Colore delle clip', (p, ctx) => refs.reduce((q, ref) => {
    const track = q.track(ref.track);
    return track ? updateClipAt('', ref, c => c.withColor(color ?? track.color)).apply(q, ctx) : q;
  }, p));

/** Il colore di una traccia. Le sue clip che avevano il colore della traccia lo seguono; quelle
 *  a cui si è dato un colore proprio lo tengono. */
export const setTrackColor = (id: TrackId, color: Color): Edit =>
  edit('Colore della traccia', (p, ctx) => {
    const track = p.track(id);
    if (!track || track.color === color) return p;
    const same = (c: Clip | null): c is Clip => c?.color.toLowerCase() === track.color.toLowerCase();
    const refs = [
      ...track.arrangement.filter(pl => same(pl.clip)).map(pl => placementRef(id, pl.id)),
      ...track.slots.filter(same).map(c => slotRef(id, c.id)),
    ];
    const recolored = p.updatingTrack(id, t => t.withColor(color));
    return refs.length ? setClipColor(refs, color).apply(recolored, ctx) : recolored;
  });

/** Il crop di una clip audio: il file ritagliato entra nel progetto e la clip (già fatta per
 *  suonarlo) prende il posto della vecchia. */
export function cropClipAt(ref: ClipRef, sample: SampleRef, cropped: Clip): Edit {
  const update = updateClipAt('Crop', ref, () => cropped);
  return edit(update.label, (p, ctx) => update.apply(p.addingSample(sample), ctx));
}

/** Moltiplica il tempo di una clip MIDI (×2, :2): sulla timeline cambia anche la sua durata,
 *  nella session solo il contenuto. */
export const scaleMidiClipAt = (label: string, ref: ClipRef, factor: number): Edit =>
  ref.kind === 'placement'
    ? scaleMidiPlacement(label, ref.track, ref.placement, factor)
    : updateSlotClip<MidiClip>(label, ref.track, ref.clip, c => c.scaledTime(factor));

const idOf = (r: ClipRef): string => (r.kind === 'placement' ? r.placement : r.clip);

export const sameClipRef = (a: ClipRef | null, b: ClipRef | null): boolean =>
  !!a && !!b && a.kind === b.kind && a.track === b.track && idOf(a) === idOf(b);
