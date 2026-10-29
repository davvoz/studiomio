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
 *  bordo della clip, fine della corsa, clip lanciata al suo posto). Una clip con un suono lo
 *  dà allo strumento quando parte (vedi `applySound`). */
export class MidiTrackPlayer implements TrackPlayer {
  private track: MidiTrack;
  private instrument: Instrument;
  /** Le impostazioni che lo strumento ha (o avrà, se il suono di una clip è in arrivo). */
  private settings: InstrumentSettings;
  /** L'ultimo suono di una clip dato allo strumento (null dopo lo stop). */
  private sound: InstrumentSettings | null = null;
  /** Il tempo che lo strumento conosce. */
  private bpm: number;
  private readonly segments = new WeakMap<Placement, Segment[]>();

  constructor(track: MidiTrack, private readonly ctx: PlayerContext, private readonly host: InstrumentHost) {
    this.track = track;
    this.bpm = ctx.tempo();
    this.settings = track.instrument;
    this.instrument = this.connect(track.instrument);
  }

  update(track: Track): void {
    const next = track as MidiTrack;
    // il suono di una clip già mandato allo strumento torna qui dal progetto: c'è già
    if (next.instrument !== this.settings) this.setInstrument(next.instrument);
    this.track = next;
    const bpm = this.ctx.tempo();
    if (bpm !== this.bpm) {
      this.bpm = bpm;
      this.instrument.setTempo?.(bpm);
    }
  }

  schedule(w: ScheduleWindow): void {
    const pieces = piecesInWindow(this.track, this.ctx.programs(), w, p => this.segmentsOf(p)).sort((a, b) => a.start - b.start);
    for (const piece of pieces) {
      this.applySound(piece, w);
      this.playPiece(piece, w);
    }
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

  playheads(): readonly number[] {
    return this.instrument.playheads?.() ?? [];
  }

  audition(pitch: number, velocity: number, duration: number): void {
    this.instrument.play(pitch, velocity, this.ctx.graph.currentTime + 0.005, duration);
  }

  stopAll(): void {
    this.instrument.stopAll();
    this.ctx.notes.clear();
    // al prossimo play la clip da cui si parte ridà il suo suono
    this.sound = null;
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
    this.settings = settings;
    if (settings.type === this.instrument.type) return this.instrument.update(settings);
    this.instrument.dispose();
    this.instrument = this.connect(settings);
  }

  /** Il suono della clip dall'inizio del tratto, se è diverso dall'ultimo dato: ai giri di loop
   *  e alle riprogrammazioni non si ridà, così ciò che si ritocca mentre la clip suona resta.
   *  Solo per lo stesso tipo di strumento (un altro tipo si ignora). */
  private applySound({ clip, start }: Piece<MidiClip>, w: ScheduleWindow): void {
    const sound = clip.sound;
    if (!sound || sound === this.sound || sound.type !== this.instrument.type) return;
    this.sound = sound;
    this.settings = sound;
    this.instrument.update(sound, timeAtClock(w, Math.max(start, w.from + w.shift)));
    this.ctx.sound?.(sound);
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
