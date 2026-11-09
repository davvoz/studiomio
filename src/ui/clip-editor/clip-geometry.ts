/* Calculations of the clip editor: beat axis, correspondence between beats ↔ seconds of the
 * sample, region and loop changes that are always valid. Pure functions. */
import type { Beats, Seconds, TempoMap } from '../../core/music-time';
import { placementSegments } from '../../engine/segments';
import type { Placement } from '../../model/arrangement';
import type { AudioClip } from '../../model/audio-clip';
import type { Clip } from '../../model/clip';
import type { WarpMarkers } from '../../model/warp-markers';
import type { TrackSessionState } from '../../engine/session';
import type { Track } from '../../model/track';
import type { FoundClip } from '../../store/clip-ref';

/** Horizontal axis of the editor: clip beats (they can be negative, before 1.1.1). */
export class BeatAxis {
  constructor(readonly pxPerBeat = 40, readonly startBeat: Beats = 0) {}

  beatToX(b: Beats): number {
    return (b - this.startBeat) * this.pxPerBeat;
  }

  xToBeat(x: number): Beats {
    return this.startBeat + x / this.pxPerBeat;
  }

  zoomed(pxPerBeat: number, anchorX: number): BeatAxis {
    const px = Math.max(2, Math.min(4000, pxPerBeat));
    return new BeatAxis(px, this.xToBeat(anchorX) - anchorX / px);
  }

  scrolled(startBeat: Beats): BeatAxis {
    return new BeatAxis(this.pxPerBeat, startBeat);
  }

  /** Axis showing [b0, b1] in `width` pixels, with a bit of margin. */
  static fit(b0: Beats, b1: Beats, width: number): BeatAxis {
    const span = Math.max(1e-3, b1 - b0), pad = span * 0.03;
    return new BeatAxis(Math.max(2, width / (span + 2 * pad)), b0 - pad);
  }
}

/** Clip beat → sample second: with warp it goes through the markers, without it the sample
 *  flows at the project's tempo at the speed given by the transpose (as in the engine). */
export function contentToSeconds(clip: AudioClip, tempo: TempoMap): (b: Beats) => Seconds {
  if (clip.warp.enabled) return b => clip.warp.markers.timeOf(b);
  const rate = Math.pow(2, clip.pitch / 12);
  return b => tempo.secondsAt(b) * rate;
}

/** Sample second → clip beat (the inverse of contentToSeconds). */
export function secondsToContent(clip: AudioClip, tempo: TempoMap): (t: Seconds) => Beats {
  if (clip.warp.enabled) return t => clip.warp.markers.beatOf(t);
  const rate = Math.pow(2, clip.pitch / 12);
  return t => tempo.beatAt(t / rate);
}

const MIN_LEN = 1 / 16;

/** Region [start, end) made valid: sorted, non-empty, compatible with the active loop. */
export function withRegionSafe<C extends Clip>(clip: C, start: Beats, end: Beats): C {
  let s = Math.min(start, end - MIN_LEN), e = Math.max(end, s + MIN_LEN);
  if (clip.loop.enabled && s >= clip.loop.end - MIN_LEN) s = clip.loop.end - MIN_LEN;
  e = Math.max(e, s + MIN_LEN);
  return clip.withRegion({ start: s, end: e });
}

/** Loop [start, end) on; if the clip would start after the end of the loop, it starts from the loop. */
export function withLoopSafe<C extends Clip>(clip: C, start: Beats, end: Beats, enabled = true): C {
  const s = Math.min(start, end), e = Math.max(end, s + MIN_LEN);
  let c = clip;
  if (enabled && c.region.start >= e) c = c.withRegion({ start: s, end: Math.max(c.region.end, e) });
  return c.withLoop({ enabled, start: s, end: e });
}

/** Dragging with Shift: the audio slides under marker `i`, which stays on its beat.
 *  The offset is measured on the map as it was at the start of the gesture. */
export function shiftAudioUnderMarker(
  frozen: WarpMarkers, i: number, fromBeat: Beats, toBeat: Beats, duration: Seconds,
): WarpMarkers {
  const dt = frozen.timeOf(toBeat) - frozen.timeOf(fromBeat);
  return frozen.withMarkerTime(i, frozen.markers[i].t - dt, duration);
}

/** The clip beat playing at timeline beat `timelineBeat`, or null if the
 *  placed clip doesn't play there. */
export function contentBeatAt(pl: Placement, timelineBeat: Beats): Beats | null {
  const s = placementSegments(pl).find(x => x.start <= timelineBeat && x.end > timelineBeat);
  return s ? s.contentStart + (timelineBeat - s.start) : null;
}

/** Timeline beat at which the placed clip plays beat `content` for the first time. */
export function timelineBeatOf(pl: Placement, content: Beats): Beats | null {
  for (const s of placementSegments(pl)) {
    const t = s.start + (content - s.contentStart);
    if (t >= s.start && t < s.end) return t;
  }
  return null;
}

/** What needs to be known about the transport to put the playhead in a clip. */
export interface TransportView {
  readonly playing: boolean;
  readonly position: Beats;
  sessionState(track: Track): TrackSessionState;
}

/** Where the playhead plays inside the clip, or null. On the timeline it follows the transport (if the
 *  track follows the timeline); in a slot, the point of the launched clip. */
export function playheadIn(found: FoundClip, transport: TransportView): Beats | null {
  if (!transport.playing) return null;
  const state = transport.sessionState(found.track);
  if (found.placement) return state.followsArrangement ? contentBeatAt(found.placement, transport.position) : null;
  const playing = state.playing;
  return playing && found.track.slots[playing.slot]?.id === found.clip.id ? found.clip.contentBeatAt(playing.elapsed) : null;
}

/** Timeline beat from which to play beat `content` of the clip (only for
 *  placed clips: a session clip has no place on the timeline). */
export const seekBeatOf = (found: FoundClip, content: Beats): Beats | null =>
  found.placement ? timelineBeatOf(found.placement, content) : null;
