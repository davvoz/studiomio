/* Freeze and Flatten into a new track, as in Live: a track rendered with its own chain (see
 * model/track-render.ts) becomes an audio track right below it, with the same mixer (volume, pan,
 * sends, group) and the rendered file on the timeline where its clips were. The original stays, muted,
 * so the mix sounds as before and can go back to it. All the tracks of a render are one undo step. */
import type { TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { AudioClip } from '../model/audio-clip';
import type { Project } from '../model/project';
import { sampleDuration, type SampleRef } from '../model/sample';
import { AudioTrack, type Track } from '../model/track';
import { WarpMarkers } from '../model/warp-markers';
import { edit, type Edit, type EditContext } from './project-store';

/** A track rendered into `sample`, which starts at `start` on the timeline and lasts `length` beats. */
export interface Bounced {
  readonly source: TrackId;
  readonly sample: SampleRef;
  readonly start: Beats;
  readonly length: Beats;
}

/** The new track's name: the original's, marked as audio. */
export const bouncedName = (name: string): string => `${name} (audio)`;

/** The clip playing the rendered file as it is at the project's tempo (straight warp: it follows the tempo). */
function bouncedClip(ctx: EditContext, t: Track, b: Bounced, bpm: number): AudioClip {
  return AudioClip.fromSample(ctx.ids.next('clip'), b.sample, t.color)
    .withName(bouncedName(t.name))
    .withWarp({ markers: WarpMarkers.straight(bpm, sampleDuration(b.sample)) })
    .withRegion({ start: 0, end: b.length })
    .withLoop({ enabled: false, start: 0, end: b.length });
}

/** The audio track of `b` below its original, which is muted. */
function withBounced(p: Project, b: Bounced, ctx: EditContext): Project {
  const source = p.track(b.source);
  // deleted while rendering: nothing to put
  if (!source) return p;
  const clip = bouncedClip(ctx, source, b, p.tempo.bpm);
  let track = AudioTrack.empty(ctx.ids.next('track'), bouncedName(source.name), source.color, 0)
    .withMixer({ volumeDb: source.mixer.volumeDb, pan: source.mixer.pan })
    .withGroup(source.group);
  for (const [bus, db] of Object.entries(source.sends) as [TrackId, number][]) track = track.withSend(bus, db);
  track = track.placing({ id: ctx.ids.next('placement'), clip, start: b.start, length: b.length, offset: 0 }, ctx.ids);
  const next = p.sample(b.sample.id) ? p : p.addingSample(b.sample);
  return next.addingTrack(track, next.blockEnd(source.id)).updatingTrack(source.id, t => t.withMixer({ mute: true }));
}

export const bouncedTracks = (items: readonly Bounced[]): Edit =>
  edit(items.length === 1 ? 'Render to audio track' : 'Render to audio tracks', (p, ctx) => items.reduce((q, b) => withBounced(q, b, ctx), p));
