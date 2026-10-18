import type { Placement } from '../../model/arrangement';
import type { InstrumentSettings } from '../../model/device';
import type { MidiClip } from '../../model/midi-clip';
import type { MidiTrack, Track } from '../../model/track';
import { timeAtClock, type ScheduleWindow } from '../scheduler';
import { placementSegments, type Segment } from '../segments';
import { piecesInWindow, type Piece } from '../track-content';
import type { DeviceModulation } from '../modulation';
import type { Instrument, InstrumentHost } from './instrument';
import type { PlayerContext, TrackPlayer } from './track-player';

/** Suona le clip MIDI della traccia (timeline e session) con il suo strumento. Una nota parte
 *  se il suo inizio cade nella finestra; viene tagliata alla fine del tratto (giro di loop,
 *  bordo della clip, fine della corsa, clip lanciata al suo posto). */
export class MidiTrackPlayer implements TrackPlayer {
  private track: MidiTrack;
  private instrument: Instrument;
  /** Il tempo che lo strumento conosce. */
  private bpm: number;
  private readonly segments = new WeakMap<Placement, Segment[]>();

  constructor(track: MidiTrack, private readonly ctx: PlayerContext, private readonly host: InstrumentHost) {
    this.track = track;
    this.bpm = ctx.tempo();
    this.instrument = this.connect(track.instrument);
  }

  update(track: Track): void {
    const next = track as MidiTrack;
    if (next.instrument !== this.track.instrument) this.setInstrument(next.instrument);
    this.track = next;
    const bpm = this.ctx.tempo();
    if (bpm !== this.bpm) {
      this.bpm = bpm;
      this.instrument.setTempo?.(bpm);
    }
  }

  schedule(w: ScheduleWindow): void {
    for (const piece of piecesInWindow(this.track, this.ctx.programs(), w, p => this.segmentsOf(p))) this.playPiece(piece, w);
  }

  cut(at: number): void {
    this.instrument.cut(at);
    this.ctx.notes.cutFrom(at);
  }

  retake(at: number): void {
    this.instrument.retake(at);
    this.ctx.notes.cutFrom(at);
  }

  instrumentModulation(): DeviceModulation | null {
    return this.instrument.modulation ?? null;
  }

  audition(pitch: number, velocity: number, duration: number): void {
    this.instrument.play(pitch, velocity, this.ctx.graph.currentTime + 0.005, duration);
  }

  stopAll(): void {
    this.instrument.stopAll();
    this.ctx.notes.clear();
  }

  dispose(): void {
    this.instrument.dispose();
  }

  private connect(settings: InstrumentSettings): Instrument {
    const instrument = this.host.create(this.ctx.graph, settings, this.ctx.tempo());
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

  private playPiece({ clip, start, end, contentStart }: Piece<MidiClip>, w: ScheduleWindow): void {
    const from = Math.max(w.from + w.shift, start), to = Math.min(w.to + w.shift, end);
    if (to <= from) return;
    // note il cui inizio, riportato sull'orologio, cade in [from, to)
    const c0 = contentStart + (from - start), c1 = contentStart + (to - start);
    for (const n of clip.notesIn(c0, c1)) {
      const at = start + (n.start - contentStart);
      const when = timeAtClock(w, at);
      this.instrument.play(n.pitch, n.velocity, when, timeAtClock(w, Math.min(at + n.duration, end)) - when);
      this.ctx.notes.add(n.pitch, when);
    }
  }
}
