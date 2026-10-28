/* Il consolida di Live (Ctrl+J): su ogni traccia le clip di un tratto diventano una clip sola,
 * che si sente come prima (i giri di loop diventano contenuto vero). Note e modulazioni si
 * mettono in fila qui; l'audio va renderizzato in un file nuovo (lo fa l'app, con il progetto
 * di `soloAudioProject`) e qui si fa la clip che lo suona. */
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

/** Il tratto da consolidare su una traccia. */
export interface ConsolidateSpan extends TimeRange {
  readonly track: TrackId;
}

/** Su ogni traccia della selezione, il tratto dalla prima all'ultima clip selezionata (come la
 *  selezione di tempo che in Live le copre), o il tratto `range` se c'è. */
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

/** Le clip della traccia dentro il tratto (anche quelle in mezzo non selezionate, come in Live). */
export function placementsIn(project: Project, span: ConsolidateSpan): Placement[] {
  return between(project.track(span.track)?.arrangement ?? [], span.start, span.end);
}

/** I tratti continui delle clip posate, in ordine di tempo, con la loro clip. */
const segmentsOf = (placements: readonly Placement[]) =>
  placements.flatMap(pl => placementSegments(pl).map(s => ({ s, clip: pl.clip }))).sort((a, b) => a.s.start - b.s.start);

const inSegment = (s: Segment, contentBeat: Beats) => contentBeat >= s.contentStart - EPS && contentBeat < s.contentStart + (s.end - s.start) - EPS;

/** Le note che suonano nelle clip posate, nel tempo di una clip che parte da `from`. Una nota non
 *  va oltre il tratto in cui suona. */
export function consolidatedNotes(placements: readonly Placement<MidiClip>[], from: Beats): Note[] {
  return segmentsOf(placements).flatMap(({ s, clip }) => (clip as MidiClip).notes.filter(n => inSegment(s, n.start)).map(n => {
    const start = s.start + n.start - s.contentStart;
    return { ...n, start: start - from, duration: Math.min(n.duration, s.end - start) };
  }));
}

/** Le modulazioni delle clip posate messe in fila, nel tempo di una clip che copre [from, to):
 *  in ogni tratto la curva della sua clip, il valore neutro dove la clip non ne ha una o dove
 *  non suona niente. */
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

/** La clip MIDI consolidata: lunga quanto il tratto, in loop come una clip nuova. */
export function consolidatedMidiClip(id: ClipId, placements: readonly Placement<MidiClip>[], from: Beats, to: Beats): MidiClip {
  const first = placements[0].clip;
  return MidiClip.create({
    id, name: first.name, color: first.color, ...fullRange(0, to - from, true),
    notes: consolidatedNotes(placements, from),
    envelopes: consolidatedEnvelopes(placements, from, to),
  });
}

/** La clip che suona il file renderizzato `sample`: warp dritto sul tempo del progetto, con la
 *  modalità di warp e le modulazioni delle clip di partenza. */
export function consolidatedAudioClip(id: ClipId, placements: readonly Placement<AudioClip>[], sample: SampleRef, bpm: number, from: Beats, to: Beats): AudioClip {
  const first = placements[0].clip, len = to - from;
  return AudioClip.fromSample(id, sample, first.color)
    .withName(first.name)
    .withWarp({ mode: first.warp.mode, options: first.warp.options, markers: WarpMarkers.straight(bpm, sampleDuration(sample)) })
    .withRegion({ start: 0, end: len })
    .withLoop({ enabled: false, start: 0, end: len })
    .withEnvelopes(consolidatedEnvelopes(placements, from, to));
}

/** Un progetto con una sola traccia audio, senza effetti e a volume pieno, che suona le clip come
 *  sono ma senza modulazioni (restano sulla clip consolidata): il suo mixdown è l'audio da
 *  consolidare. */
export function soloAudioProject(project: Project, placements: readonly Placement<AudioClip>[], ids: IdFactory): Project {
  let p = Project.empty('Consolida', ids, 0).withTempo(project.tempo.bpm).withSignature(project.signature);
  for (const pl of placements) {
    const s = project.sample(pl.clip.sample);
    if (s && !p.sample(s.id)) p = p.addingSample(s);
  }
  const track = placements.reduce<AudioTrack>(
    (t, pl) => t.placing({ ...pl, clip: pl.clip.withEnvelopes([]) }, ids),
    AudioTrack.empty(ids.next('track'), 'Consolida', placements[0].clip.color, 0),
  );
  return p.addingTrack(track);
}

/** Una clip consolidata, pronta da posare al posto delle clip del suo tratto. */
export interface Consolidated {
  readonly span: ConsolidateSpan;
  readonly placement: PlacementId;
  readonly clip: Clip;
  /** Il file renderizzato, per le clip audio. */
  readonly sample?: SampleRef;
}

/** Ogni clip consolidata al posto delle clip del suo tratto. */
export function withConsolidated(project: Project, items: readonly Consolidated[], ids: IdFactory): Project {
  return items.reduce((p, { span, placement, clip, sample }) => {
    const next = sample && !p.sample(sample.id) ? p.addingSample(sample) : p;
    const placed: Placement = { id: placement, clip, start: span.start, length: span.end - span.start, offset: 0 };
    return next.updatingTrack(span.track, t => placementsIn(next, span).reduce((tt, pl) => tt.removingPlacement(pl.id), t).placing(placed, ids));
  }, project);
}
