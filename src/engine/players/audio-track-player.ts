import type { Placement } from '../../model/arrangement';
import type { AudioClip } from '../../model/audio-clip';
import type { AudioTrack, Track } from '../../model/track';
import { dbToGain } from '../audio-graph';
import type { PlayableProvider } from '../clip-audio';
import type { ScheduleWindow } from '../scheduler';
import { placementEnd } from '../../model/arrangement';
import { placementSegments, segmentToStart, type Segment } from '../segments';
import { ActiveNodes, type PlayerContext, type TrackPlayer } from './track-player';

/** Dissolvenza agli estremi di ogni tratto: evita i clic su tagli e giri di loop. */
const FADE = 0.002;

/** Suona le clip audio della timeline: un nodo di lettura per ogni tratto continuo. */
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
    const lo = Math.max(w.from, w.runStart);
    for (const p of this.track.arrangement) {
      if (p.start >= w.to || placementEnd(p) <= lo) continue;
      for (const seg of this.segmentsOf(p)) {
        const s = segmentToStart(seg, w);
        if (s) this.play(p.clip, s, w);
      }
    }
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

  private play(clip: AudioClip, s: Segment, w: ScheduleWindow): void {
    const playable = this.clips.playable(clip);
    if (!playable) {
      this.ctx.missing(); // l'audio arriva: il motore riprogrammerà quando è pronto
      return;
    }
    const { buffer, rate } = playable;
    let when = w.timeAt(s.start);
    const end = w.timeAt(s.end);
    // punto del buffer (in secondi di buffer) che corrisponde all'inizio del tratto
    let offset = w.tempo.secondsAt(s.contentStart - playable.startBeat) * rate;
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
    this.active.add(src, () => {
      src.disconnect();
      amp.disconnect();
    });
  }
}
