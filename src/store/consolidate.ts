/* Live's consolidate (Ctrl+J): on each track the clips of a stretch become a single clip,
 * which sounds as before (the loop rounds become real content). Notes and modulations are
 * lined up here; the audio has to be rendered into a new file (the app does it, with the project
 * from `soloAudioProject`) and here the clip playing it is made. */
import type { ClipId, IdFactory, PlacementId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { placementSegments, type Segment } from '../engine/segments';
import { between, placementEnd, type Placement } from '../model/arrangement';
import { AudioClip } from '../model/audio-clip';
import { fullRange, type Clip } from '../model/clip';
import { envelopeValueAt, scaleOf, targetKey, type ClipEnvelope, type EnvelopePoint, type ModTarget } from '../model/envelope';
import { MidiClip, type Note } from '../model/midi-clip';
import type { TimeRange } from '../model/note-edits';
import { Project } from '../model/project';
import { sampleDuration, type SampleRef } from '../model/sample';
import { AudioTrack } from '../model/track';
import { WarpMarkers } from '../model/warp-markers';
import { findPlacement, type PlacementRef } from './selection-edits';

const EPS = 1e-9;

/** The stretch to consolidate on a track. */
export interface ConsolidateSpan extends TimeRange {
  readonly track: TrackId;
}

/** On each track of the selection, the stretch from the first to the last selected clip (like the
 *  time selection covering them in Live), or the stretch `range` if given. */
export function consolidateSpans(project: Project, refs: readonly PlacementRef[], range: TimeRange | null): ConsolidateSpan[] {
  const byTrack = new Map<TrackId, Placement[]>();
  for (const r of refs) {
    const pl = findPlacement(project, r);
    if (pl) byTrack.set(r.track, [...(byTrack.get(r.track) ?? []), pl]);
  }
  return [...byTrack].map(([track, pls]) => ({
    track,
    start: range?.start ?? Math.min(...pls.map(p => p.start)),
    end: range?.end ?? Math.max(...pls.map(placementEnd)),
  }));
}

/** The track's clips inside the stretch (also the unselected ones in between, as in Live). */
export function placementsIn(project: Project, span: ConsolidateSpan): Placement[] {
  return between(project.track(span.track)?.arrangement ?? [], span.start, span.end);
}

/** The continuous stretches of the placed clips, in time order, with their clip. */
const segmentsOf = (placements: readonly Placement[]) =>
  placements.flatMap(pl => placementSegments(pl).map(s => ({ s, clip: pl.clip }))).sort((a, b) => a.s.start - b.s.start);

const inSegment = (s: Segment, contentBeat: Beats) => contentBeat >= s.contentStart - EPS && contentBeat < s.contentStart + (s.end - s.start) - EPS;

/** The notes playing in the placed clips, in the time of a clip starting at `from`. A note doesn't
 *  go beyond the stretch it plays in. */
export function consolidatedNotes(placements: readonly Placement<MidiClip>[], from: Beats): Note[] {
  return segmentsOf(placements).flatMap(({ s, clip }) => (clip as MidiClip).notes.filter(n => inSegment(s, n.start)).map(n => {
    const start = s.start + n.start - s.contentStart;
    return { ...n, start: start - from, duration: Math.min(n.duration, s.end - start) };
  }));
}

/** The modulations of the placed clips lined up, in the time of a clip covering [from, to):
 *  in each stretch its clip's curve, the neutral value where the clip doesn't have one or where
 *  nothing plays. */
export function consolidatedEnvelopes(placements: readonly Placement[], from: Beats, to: Beats): ClipEnvelope[] {
  const targets = new Map<string, ModTarget>();
  for (const pl of placements) for (const e of pl.clip.envelopes) targets.set(targetKey(e.target), e.target);
  const segments = segmentsOf(placements);
  return [...targets.values()].map(target => {
    const neutral = scaleOf(target).neutral;
    const points: EnvelopePoint[] = [];
    let last = 0;
    for (const { s, clip } of segments) {
      const env = clip.envelope(target)?.points ?? [];
      const at = (c: Beats) => (env.length ? envelopeValueAt(env, c) : neutral);
      const s0 = s.start - from, s1 = s.end - from, c1 = s.contentStart + s.end - s.start;
      if (s0 > last + EPS) points.push({ beat: last, value: neutral }, { beat: s0, value: neutral });
      points.push({ beat: s0, value: at(s.contentStart) });
      for (const p of env) if (p.beat > s.contentStart + EPS && p.beat < c1 - EPS) points.push({ beat: s0 + p.beat - s.contentStart, value: p.value });
      points.push({ beat: s1, value: at(c1) });
      last = s1;
    }
    if (to - from > last + EPS) points.push({ beat: last, value: neutral });
    return { target, points };
  });
}

/** The consolidated MIDI clip: as long as the stretch, looping like a new clip. */
export function consolidatedMidiClip(id: ClipId, placements: readonly Placement<MidiClip>[], from: Beats, to: Beats): MidiClip {
  const first = placements[0].clip;
  return MidiClip.create({
    id, name: first.name, color: first.color, ...fullRange(0, to - from, true),
    notes: consolidatedNotes(placements, from),
    envelopes: consolidatedEnvelopes(placements, from, to),
  });
}

/** The clip for a session slot playing like the clips placed in [from, to), if it can be done without
 *  rendering: a single clip covering the stretch always repeating the same piece (played once,
 *  or its loop in whole rounds) stays itself, cropped to that piece; the notes are lined
 *  up. null: the audio has to be rendered. */
export function sessionClip(id: ClipId, placements: readonly Placement[], from: Beats, to: Beats): Clip | null {
  const segments = placements.length === 1 ? placementSegments(placements[0]) : [];
  const [first] = segments, same = (a: number, b: number) => Math.abs(a - b) < EPS;
  if (first && same(first.start, from) && same(segments[segments.length - 1].end, to)
    && segments.every(s => same(s.contentStart, first.contentStart) && same(s.end - s.start, first.end - first.start))) {
    const piece = { start: first.contentStart, end: first.contentStart + first.end - first.start };
    return placements[0].clip.withId(id).withRegion(piece).withLoop({ enabled: true, ...piece });
  }
  return placements[0]?.clip instanceof MidiClip ? consolidatedMidiClip(id, placements as Placement<MidiClip>[], from, to) : null;
}

/** The clip playing the rendered file `sample`: straight warp at the project's tempo, with the
 *  warp mode and the modulations of the starting clips. */
export function consolidatedAudioClip(id: ClipId, placements: readonly Placement<AudioClip>[], sample: SampleRef, bpm: number, from: Beats, to: Beats): AudioClip {
  const first = placements[0].clip, len = to - from;
  return AudioClip.fromSample(id, sample, first.color)
    .withName(first.name)
    .withWarp({ mode: first.warp.mode, options: first.warp.options, markers: WarpMarkers.straight(bpm, sampleDuration(sample)) })
    .withRegion({ start: 0, end: len })
    .withLoop({ enabled: false, start: 0, end: len })
    .withEnvelopes(consolidatedEnvelopes(placements, from, to));
}

/** A project with a single audio track, without effects and at full volume, playing the clips as
 *  they are but without modulations (they stay on the consolidated clip): its mixdown is the audio to
 *  consolidate. */
export function soloAudioProject(project: Project, placements: readonly Placement<AudioClip>[], ids: IdFactory): Project {
  let p = Project.empty('Consolidate', ids, 0).withTempo(project.tempo.bpm).withSignature(project.signature);
  for (const pl of placements) {
    const s = project.sample(pl.clip.sample);
    if (s && !p.sample(s.id)) p = p.addingSample(s);
  }
  const track = placements.reduce<AudioTrack>(
    (t, pl) => t.placing({ ...pl, clip: pl.clip.withEnvelopes([]) }, ids),
    AudioTrack.empty(ids.next('track'), 'Consolidate', placements[0].clip.color, 0),
  );
  return p.addingTrack(track);
}

/** A consolidated clip, ready to place in place of the clips of its stretch. */
export interface Consolidated {
  readonly span: ConsolidateSpan;
  readonly placement: PlacementId;
  readonly clip: Clip;
  /** The rendered file, for the audio clips. */
  readonly sample?: SampleRef;
}

/** Each consolidated clip in place of the clips of its stretch. */
export function withConsolidated(project: Project, items: readonly Consolidated[], ids: IdFactory): Project {
  return items.reduce((p, { span, placement, clip, sample }) => {
    const next = sample && !p.sample(sample.id) ? p.addingSample(sample) : p;
    const placed: Placement = { id: placement, clip, start: span.start, length: span.end - span.start, offset: 0 };
    return next.updatingTrack(span.track, t => placementsIn(next, span).reduce((tt, pl) => tt.removingPlacement(pl.id), t).placing(placed, ids));
  }, project);
}
