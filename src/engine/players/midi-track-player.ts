import type { Placement } from '../../model/arrangement';
import { activeArp, arpParams } from '../../devices/arp/arp';
import type { EffectSettings, InstrumentSettings } from '../../model/device';
import type { MidiClip } from '../../model/midi-clip';
import type { MidiTrack, Track } from '../../model/track';
import { timeAtClock, type ScheduleWindow } from '../scheduler';
import { placementSegments, type Segment } from '../segments';
import { piecesInWindow, type Piece } from '../track-content';
import type { DeviceModulation } from '../modulation';
import type { Instrument, InstrumentHost } from './instrument';
import type { PlayerContext, TrackPlayer } from './track-player';

/** Plays the track's MIDI clips (timeline and session) with its instrument. A note starts
 *  if its start falls in the window; it's cut at the end of the stretch (loop round,
 *  clip edge, end of the run, clip launched in its place). A clip with a sound
 *  gives it to the instrument when it starts (see `applySound`). */
export class MidiTrackPlayer implements TrackPlayer {
  private track: MidiTrack;
  private instrument: Instrument;
  /** The settings the instrument has (or will have, if a clip's sound is on its way). */
  private settings: InstrumentSettings;
  /** The last clip sound given to the instrument (null after the stop). */
  private sound: InstrumentSettings | null = null;
  /** The arpeggiator the instrument knows. */
  private arp: EffectSettings | undefined;
  /** The tempo the instrument knows. */
  private bpm: number;
  private readonly segments = new WeakMap<Placement, Segment[]>();

  constructor(track: MidiTrack, private readonly ctx: PlayerContext, private readonly host: InstrumentHost) {
    this.track = track;
    this.bpm = ctx.tempo();
    this.settings = track.instrument;
    this.instrument = this.connect(track.instrument);
    this.syncArp(track, true);
  }

  update(track: Track): void {
    const next = track as MidiTrack;
    // a clip's sound already sent to the instrument comes back here from the project: it's already there
    if (next.instrument !== this.settings) this.setInstrument(next.instrument);
    this.syncArp(next);
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

  press(pitch: number, velocity: number): void {
    this.instrument.press(pitch, velocity);
    this.ctx.notes.add(pitch, this.ctx.graph.currentTime);
  }

  release(pitch: number): void {
    this.instrument.release(pitch);
  }

  stopAll(): void {
    this.instrument.stopAll();
    this.ctx.notes.clear();
    // at the next play the clip it starts from gives back its sound
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

  /** Same type: only the parameters change, the notes continue. Different type: new instrument. */
  private setInstrument(settings: InstrumentSettings): void {
    this.settings = settings;
    if (settings.type === this.instrument.type) return this.instrument.update(settings);
    this.instrument.dispose();
    this.instrument = this.connect(settings);
    this.instrument.setArp(arpParams(this.arp));
  }

  private syncArp(track: Track, always = false): void {
    const arp = activeArp(track.effects);
    if (arp === this.arp && !always) return;
    this.arp = arp;
    this.instrument.setArp(arpParams(arp));
  }

  /** The clip's sound from the start of the stretch, if it's different from the last one given: at loop rounds
   *  and reschedulings it isn't given again, so what's retouched while the clip plays stays.
   *  Only for the same instrument type (another type is ignored). */
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
    // notes whose start, brought onto the clock, falls in [from, to)
    const c0 = contentStart + (from - start), c1 = contentStart + (to - start);
    for (const n of clip.notesIn(c0, c1)) {
      const at = start + (n.start - contentStart);
      const when = timeAtClock(w, at);
      this.instrument.play(n.pitch, n.velocity, when, timeAtClock(w, Math.min(at + n.duration, end)) - when);
      this.ctx.notes.add(n.pitch, when);
    }
  }
}
