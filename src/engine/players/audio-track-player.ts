import type { Placement } from '../../model/arrangement';
import type { AudioClip } from '../../model/audio-clip';
import type { AudioTrack, Track } from '../../model/track';
import { dbToGain } from '../audio-graph';
import type { PlayableProvider } from '../clip-audio';
import { timeAtClock, type ScheduleWindow } from '../scheduler';
import { placementSegments, type Segment } from '../segments';
import { fadeGainAt, piecesInWindow, type Piece } from '../track-content';
import { CLIP_TRANSPOSE, steppedRuns } from '../../model/envelope';
import { ActiveNodes, stopQuietly, type PlayerContext, type TrackPlayer } from './track-player';

/** Fade at the ends of each stretch: avoids clicks on cuts and loop rounds. */
const FADE = 0.002;

const EPS = 1e-9;

/** Plays the track's audio clips (timeline and session): one playback node for each continuous stretch. */
export class AudioTrackPlayer implements TrackPlayer {
  private track: AudioTrack;
  private readonly segments = new WeakMap<Placement, Segment[]>();
  private readonly active = new ActiveNodes();

  constructor(track: AudioTrack, private readonly ctx: PlayerContext, private readonly clips: PlayableProvider) {
    this.track = track;
  }

  update(track: Track): void {
    this.track = track as AudioTrack;
  }

  get activeSources(): number {
    return this.active.size;
  }

  schedule(w: ScheduleWindow): void {
    const from = w.from + w.shift, to = w.to + w.shift;
    for (const piece of piecesInWindow(this.track, this.ctx.programs(), w, p => this.segmentsOf(p))) {
      if (piece.start >= from - EPS && piece.start < to - EPS) this.play(piece, w);
    }
  }

  cut(at: number): void {
    this.active.cutAt(at);
  }

  retake(at: number): void {
    this.active.retakeAt(at);
  }

  stopAll(): void {
    this.active.stopAll();
  }

  dispose(): void {
    this.stopAll();
  }

  private segmentsOf(p: Placement<AudioClip>): Segment[] {
    let s = this.segments.get(p);
    if (!s) {
      s = placementSegments(p);
      this.segments.set(p, s);
    }
    return s;
  }

  /** A stretch; with the transpose curve, a piece for each semitone it touches (going from
   *  one to the other with the anti-click fades). */
  private play(piece: Piece<AudioClip>, w: ScheduleWindow): void {
    const curve = piece.clip.envelope(CLIP_TRANSPOSE)?.points;
    if (!curve?.length) return this.playRun(piece, w, 0);
    const { start, end, contentStart } = piece;
    for (const run of steppedRuns(curve, contentStart, contentStart + end - start)) {
      const at = (c: number) => start + c - contentStart;
      this.playRun({ ...piece, start: at(run.from), end: at(run.to), contentStart: run.from }, w, run.value);
    }
  }

  private playRun({ clip, start, end: stop, contentStart, fades }: Piece<AudioClip>, w: ScheduleWindow, shift: number): void {
    const playable = this.clips.playable(clip, shift);
    // the (right) audio is arriving: the engine will reschedule when it's ready
    if (!playable || playable.provisional) this.ctx.missing();
    if (!playable) return;
    const { buffer, rate } = playable;
    let when = timeAtClock(w, start);
    const end = timeAtClock(w, stop);
    // point of the buffer (in buffer seconds) corresponding to the start of the stretch
    let offset = w.tempo.secondsAt(contentStart - playable.startBeat) * rate;
    if (offset < 0) {
      // the stretch starts before the sample: wait for the sample to begin
      when -= offset / rate;
      offset = 0;
    }
    const duration = Math.min(end - when, (buffer.duration - offset) / rate);
    if (duration <= 0.0005) return;

    const { graph, output } = this.ctx;
    const src = graph.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const amp = graph.createGain();
    const g = dbToGain(clip.gainDb);
    const fade = Math.min(FADE, duration / 4);
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(g, when + fade);
    amp.gain.setValueAtTime(g, when + duration - fade);
    amp.gain.linearRampToValueAtTime(0, when + duration);
    src.connect(amp);
    // the placed clip's fades: an extra gain, following the drawn line
    const fadeGain = fades ? graph.createGain() : null;
    if (fadeGain && fades) {
      const at = (b: number) => Math.max(0, timeAtClock(w, b));
      fadeGain.gain.setValueAtTime(fadeGainAt(fades, start), at(start));
      for (const b of [fades.start + fades.fadeIn, fades.end - fades.fadeOut]) {
        if (b > start && b < stop) fadeGain.gain.linearRampToValueAtTime(fadeGainAt(fades, b), at(b));
      }
      fadeGain.gain.linearRampToValueAtTime(fadeGainAt(fades, stop), at(stop));
      amp.connect(fadeGain);
      fadeGain.connect(output);
    } else amp.connect(output);
    src.start(when, offset, duration * rate);
    src.stop(when + duration);
    const ends = when + duration;
    /** Fade from `from` to `to`, then the node stops; if it hadn't started yet it doesn't play. */
    const fadeOut = (from: number, to: number) => {
      if (from >= ends) return;
      if (to > when) {
        amp.gain.cancelScheduledValues(from);
        amp.gain.setValueAtTime(g, Math.max(when, from));
        amp.gain.linearRampToValueAtTime(0, to);
      }
      stopQuietly(src, Math.max(to, when));
    };
    this.active.add(src, () => {
      src.disconnect();
      amp.disconnect();
      fadeGain?.disconnect();
    }, {
      cut: at => fadeOut(at - FADE, at),
      // the new stretch comes in from `at` with its fade and this one goes out at the same time:
      // a crossfade, without gaps
      retake: at => (at <= when ? stopQuietly(src, when) : fadeOut(at, at + FADE)),
    });
  }
}
