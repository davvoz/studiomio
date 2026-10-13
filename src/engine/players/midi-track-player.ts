import { placementEnd, type Placement } from '../../model/arrangement';
import type { InstrumentSettings } from '../../model/device';
import type { MidiClip } from '../../model/midi-clip';
import type { MidiTrack, Track } from '../../model/track';
import type { ScheduleWindow } from '../scheduler';
import { placementSegments, type Segment } from '../segments';
import type { Instrument, InstrumentHost } from './instrument';
import type { PlayerContext, TrackPlayer } from './track-player';

/** Suona le clip MIDI della timeline con lo strumento della traccia. Una nota parte se il
 *  suo inizio cade nella finestra; viene tagliata alla fine del tratto (giro di loop, bordo
 *  della clip) e della corsa del trasporto. */
export class MidiTrackPlayer implements TrackPlayer {
  private track: MidiTrack;
  private instrument: Instrument;
  private readonly segments = new WeakMap<Placement, Segment[]>();

  constructor(track: MidiTrack, private readonly ctx: PlayerContext, private readonly host: InstrumentHost) {
    this.track = track;
    this.instrument = this.connect(track.instrument);
  }

  update(track: Track): void {
    const next = track as MidiTrack;
    if (next.instrument !== this.track.instrument) this.setInstrument(next.instrument);
    this.track = next;
  }

  schedule(w: ScheduleWindow): void {
    const lo = Math.max(w.from, w.runStart);
    for (const p of this.track.arrangement) {
      if (p.start >= w.to || placementEnd(p) <= lo) continue;
      for (const seg of this.segmentsOf(p)) this.playSegment(p.clip, seg, w, lo);
    }
  }

  audition(pitch: number, velocity: number, duration: number): void {
    this.instrument.play(pitch, velocity, this.ctx.graph.currentTime + 0.005, duration);
  }

  stopAll(): void {
    this.instrument.stopAll();
  }

  dispose(): void {
    this.instrument.dispose();
  }

  private connect(settings: InstrumentSettings): Instrument {
    const instrument = this.host.create(this.ctx.graph, settings);
    instrument.output.connect(this.ctx.output);
    return instrument;
  }

  /** Stesso tipo: cambiano solo i parametri, le note continuano. Tipo diverso: strumento nuovo. */
  private setInstrument(settings: InstrumentSettings): void {
    if (settings.type === this.instrument.type) return this.instrument.update(settings);
    this.instrument.dispose();
    this.instrument = this.connect(settings);
  }

  private segmentsOf(p: Placement<MidiClip>): Segment[] {
    let s = this.segments.get(p);
    if (!s) {
      s = placementSegments(p);
      this.segments.set(p, s);
    }
    return s;
  }

  private playSegment(clip: MidiClip, seg: Segment, w: ScheduleWindow, lo: number): void {
    const from = Math.max(lo, seg.start), to = Math.min(w.to, seg.end, w.runEnd);
    if (to <= from) return;
    const cut = Math.min(seg.end, w.runEnd);
    // note il cui inizio, riportato sulla timeline, cade in [from, to)
    const c0 = seg.contentStart + (from - seg.start), c1 = seg.contentStart + (to - seg.start);
    for (const n of clip.notesIn(c0, c1)) {
      const at = seg.start + (n.start - seg.contentStart);
      const end = Math.min(at + n.duration, cut);
      const when = w.timeAt(at);
      this.instrument.play(n.pitch, n.velocity, when, w.timeAt(end) - when);
    }
  }
}
