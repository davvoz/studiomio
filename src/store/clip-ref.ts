/* Where a clip is: on a track's timeline (a placement) or in a session slot
 * (by the clip's id, which doesn't change if the scenes move). The editors work
 * on a ClipRef and don't need to know which of the two. */
import type { ClipId, PlacementId, TrackId } from '../core/id';
import type { Placement } from '../model/arrangement';
import type { Clip, Color } from '../model/clip';
import type { Project } from '../model/project';
import type { Track } from '../model/track';
import type { MidiClip } from '../model/midi-clip';
import type { SampleRef } from '../model/sample';
import { duplicateLoopPlacement, scaleMidiPlacement, updateClip } from './edits';
import { edit, type Edit } from './project-store';
import { updateSlotClip } from './session-edits';

export type ClipRef =
  | { readonly kind: 'placement'; readonly track: TrackId; readonly placement: PlacementId }
  | { readonly kind: 'slot'; readonly track: TrackId; readonly clip: ClipId };

export const placementRef = (track: TrackId, placement: PlacementId): ClipRef => ({ kind: 'placement', track, placement });
export const slotRef = (track: TrackId, clip: ClipId): ClipRef => ({ kind: 'slot', track, clip });

/** A found clip: its track and, if it's on the timeline, its placement. */
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

/** Changes the clip's content, wherever it is. */
export const updateClipAt = <C extends Clip>(label: string, ref: ClipRef, fn: (c: C) => Clip): Edit => locator(ref).update(label, ref, fn);

/** The colour of several clips together (a single step to undo); without colour each takes
 *  its track's. */
export const setClipColor = (refs: readonly ClipRef[], color?: Color): Edit =>
  edit(refs.length === 1 ? 'Clip colour' : 'Clip colours', (p, ctx) => refs.reduce((q, ref) => {
    const track = q.track(ref.track);
    return track ? updateClipAt('', ref, c => c.withColor(color ?? track.color)).apply(q, ctx) : q;
  }, p));

/** A track's colour. Its clips that had the track's colour follow it; those
 *  that were given their own colour keep it. */
export const setTrackColor = (id: TrackId, color: Color): Edit =>
  edit('Track colour', (p, ctx) => {
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

/** An audio clip's crop: the cropped file enters the project and the clip (already made to
 *  play it) takes the place of the old one. */
export function cropClipAt(ref: ClipRef, sample: SampleRef, cropped: Clip): Edit {
  const update = updateClipAt('Crop', ref, () => cropped);
  return edit(update.label, (p, ctx) => update.apply(p.addingSample(sample), ctx));
}

/** Multiplies a MIDI clip's time (×2, :2): on the timeline its length changes too,
 *  in the session only the content. */
export const scaleMidiClipAt = (label: string, ref: ClipRef, factor: number): Edit =>
  ref.kind === 'placement'
    ? scaleMidiPlacement(label, ref.track, ref.placement, factor)
    : updateSlotClip<MidiClip>(label, ref.track, ref.clip, c => c.scaledTime(factor));

/** "Dupl. Loop" of a MIDI clip, wherever it is. */
export const duplicateLoopAt = (ref: ClipRef): Edit =>
  ref.kind === 'placement'
    ? duplicateLoopPlacement(ref.track, ref.placement)
    : updateSlotClip<MidiClip>('Duplicate loop', ref.track, ref.clip, c => c.duplicatingLoop());
