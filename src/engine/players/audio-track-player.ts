import type { Placement } from '../../model/arrangement';
import type { AudioClip } from '../../model/audio-clip';
import type { AudioTrack, Track } from '../../model/track';
import { dbToGain } from '../audio-graph';
import type { PlayableProvider } from '../clip-audio';
import { timeAtClock, type ScheduleWindow } from '../scheduler';
import { placementSegments, type Segment } from '../segments';
import { piecesInWindow, type Piece } from '../track-content';
import { ActiveNodes, stopQuietly, type PlayerContext, type TrackPlayer } from './track-player';

/** Dissolvenza agli estremi di ogni tratto: evita i clic su tagli e giri di loop. */
const FADE = 0.002;

const EPS = 1e-9;

/** Suona le clip audio della traccia (timeline e session): un nodo di lettura per ogni tratto continuo. */
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

  private play({ clip, start, end: stop, contentStart }: Piece<AudioClip>, w: ScheduleWindow): void {
    const playable = this.clips.playable(clip);
    if (!playable) {
      this.ctx.missing(); // l'audio arriva: il motore riprogrammerà quando è pronto
      return;
    }
    const { buffer, rate } = playable;
    let when = timeAtClock(w, start);
    const end = timeAtClock(w, stop);
    // punto del buffer (in secondi di buffer) che corrisponde all'inizio del tratto
    let offset = w.tempo.secondsAt(contentStart - playable.startBeat) * rate;
    if (offset < 0) {
      // il tratto inizia prima del sample: si aspetta che il sample cominci
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
    amp.connect(output);
    src.start(when, offset, duration * rate);
    src.stop(when + duration);
    const ends = when + duration;
    this.active.add(src, () => {
      src.disconnect();
      amp.disconnect();
    }, at => {
      if (at >= ends) return;
      // tagliato prima di partire: non suona; altrimenti una breve dissolvenza fino ad `at`
      if (at > when) {
        amp.gain.cancelScheduledValues(at - FADE);
        amp.gain.setValueAtTime(g, Math.max(when, at - FADE));
        amp.gain.linearRampToValueAtTime(0, at);
      }
      stopQuietly(src, Math.max(at, when));
    });
  }
}
