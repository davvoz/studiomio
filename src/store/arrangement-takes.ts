/* The clips of a take on the timeline (model/arrangement-take.ts) written into the tracks: each one
 * covers the stretch recorded and, as in Live, takes the place of what was under it there. The notes
 * are quantized as the project says (Options › Recording); the controls moved are the clip's curves.
 * A track where only controls moved (nothing played) keeps what played there: the new clip has the
 * notes and the other curves of the clips under it, and the movements over them.
 * A whole take is one undo step. */
import { between, keepBetween, type Placement } from '../model/arrangement';
import type { TakeClip } from '../model/arrangement-take';
import { fullRange } from '../model/clip';
import { targetKey, type ClipEnvelope } from '../model/envelope';
import { MidiClip, type Note } from '../model/midi-clip';
import type { Project } from '../model/project';
import { quantizeRecorded } from '../model/record-settings';
import { MidiTrack } from '../model/track';
import { consolidatedEnvelopes, consolidatedNotes } from './consolidate';
import { edit, type Edit, type EditContext } from './project-store';

/** What the clips under the take play in its stretch, in the new clip's time. */
function playedUnder(track: MidiTrack, take: TakeClip): { notes: Note[]; envelopes: ClipEnvelope[] } {
  const end = take.start + take.length;
  const inside = between(track.arrangement, take.start, end)
    .map(pl => keepBetween(pl, take.start, end, pl.id))
    .filter((pl): pl is Placement<MidiClip> => pl !== null);
  return { notes: consolidatedNotes(inside, take.start), envelopes: consolidatedEnvelopes(inside, take.start, end) };
}

/** The clip's notes and curves: those recorded or, with only movements, those under it with the movements over them. */
function content(track: MidiTrack, take: TakeClip, p: Project): { notes: Note[]; envelopes: ClipEnvelope[] } {
  const recorded = take.envelopes ?? [];
  if (take.notes.length) {
    const span = { start: 0, end: take.length, loops: false };
    return { notes: take.notes.map(n => quantizeRecorded(n, p.recordQuantize, span)), envelopes: [...recorded] };
  }
  const under = playedUnder(track, take), moved = new Set(recorded.map(e => targetKey(e.target)));
  return { notes: under.notes, envelopes: [...under.envelopes.filter(e => !moved.has(targetKey(e.target))), ...recorded] };
}

function withTake(p: Project, take: TakeClip, ctx: EditContext): Project {
  const track = p.track(take.track);
  // deleted (or no longer MIDI) while recording: the notes go with it
  if (!(track instanceof MidiTrack)) return p;
  const { notes, envelopes } = content(track, take, p);
  const clip = MidiClip.create({
    id: take.ids?.clip ?? ctx.ids.next('clip'), name: track.name, color: track.color, ...fullRange(0, take.length), notes,
    ...(envelopes.length ? { envelopes } : {}),
  });
  // the same placement again: it replaces its previous version (place() takes it out first)
  const placement: Placement<MidiClip> = { id: take.ids?.placement ?? ctx.ids.next('placement'), clip, start: take.start, length: take.length, offset: 0 };
  return p.updatingTrack<MidiTrack>(track.id, t => t.placing(placement, ctx.ids));
}

export const recordedTakes = (takes: readonly TakeClip[]): Edit =>
  edit('Record', (p, ctx) => takes.reduce((q, t) => withTake(q, t, ctx), p));
