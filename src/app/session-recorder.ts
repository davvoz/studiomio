/* Recording into the session's slots, as in Live. ● on a slot of an armed MIDI track (⌨) starts the
 * take at the next launch boundary (with the transport stopped it starts it, and the take with it);
 * ● again ends it at the next boundary, where the new clip starts looping: the notes played until
 * then go into it. Stopping the transport ends the takes too, at the beat after the last note.
 * The clip replaces what was in the slot; the whole take is a single undo step. */
import { Emitter, type Unsubscribe } from '../core/emitter';
import type { ClipId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { NoteTake, takeLength } from '../model/note-take';
import { MidiTrack } from '../model/track';
import type { ProjectStore } from '../store/project-store';
import { recordedClip, type SlotRef } from '../store/session-edits';

/** What the recorder needs from the engine. */
export interface RecorderEngine {
  readonly playing: boolean;
  /** The continuous clock now (beats). */
  readonly sessionClock: number;
  /** The next launch boundary (while playing). */
  readonly nextBoundary: number;
  /** Prepares `track` for a take and returns the clock where it starts. */
  startRecording(track: TrackId): number;
  launchSlot(track: TrackId, slot: number): void;
  onStateChange(fn: (playing: boolean) => void): Unsubscribe;
}

/** While a take is ending, how often whether its end has passed is checked (ms). */
const CHECK_MS = 50;

interface Ending {
  /** The clip already in the slot. */
  readonly id: ClipId;
  /** The clock where the take ends. */
  readonly end: Beats;
  readonly length: Beats;
}

interface Recording {
  readonly ref: SlotRef;
  readonly take: NoteTake;
  /** The writes of the take merge into one undo step. */
  readonly key: string;
  ending: Ending | null;
}

export class SessionRecorder {
  private readonly recordings = new Map<TrackId, Recording>();
  private readonly events = new Emitter<{ change: [] }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private count = 0;

  constructor(
    private readonly engine: RecorderEngine,
    private readonly store: ProjectStore,
    /** The launch quantum, in beats (0: no quantization). */
    private readonly quantum: () => Beats,
    private readonly say: (text: string) => void,
  ) {
    engine.onStateChange(playing => {
      if (!playing) this.finishAll();
    });
  }

  onChange(fn: () => void): Unsubscribe {
    return this.events.on('change', fn);
  }

  /** The slot `track` is recording into (also while its take is ending), null if none. */
  recordingSlot(track: TrackId): number | null {
    return this.recordings.get(track)?.ref.slot ?? null;
  }

  /** ● on a slot: starts recording there, or ends the track's take. */
  toggle(ref: SlotRef): void {
    const r = this.recordings.get(ref.track);
    if (!r) this.start(ref);
    else if (!r.ending) this.end(r);
  }

  press(track: TrackId, pitch: number, velocity: number): void {
    this.recordings.get(track)?.take.press(pitch, velocity, this.engine.sessionClock);
  }

  release(track: TrackId, pitch: number): void {
    this.recordings.get(track)?.take.release(pitch, this.engine.sessionClock);
  }

  private start(ref: SlotRef): void {
    if (!(this.store.project.track(ref.track) instanceof MidiTrack)) return;
    const take = new NoteTake(this.engine.startRecording(ref.track));
    this.recordings.set(ref.track, { ref, take, key: `record ${++this.count}`, ending: null });
    this.say('Recording: play the armed track (⌨ or a MIDI keyboard); ● again ends the clip at the next boundary.');
    this.events.emit('change');
  }

  /** Ends the take at the next boundary: the clip is made now and starts looping there, the notes
   *  played until then are added when the boundary passes. */
  private end(r: Recording): void {
    const end = this.engine.nextBoundary;
    if (end <= r.take.start) {
      // ended before it began: nothing to keep
      this.recordings.delete(r.ref.track);
      this.events.emit('change');
      return;
    }
    const length = takeLength(end - r.take.start, this.quantum());
    r.ending = { id: this.store.ids.next('clip'), end, length };
    this.write(r, r.ending);
    this.engine.launchSlot(r.ref.track, r.ref.slot);
    this.timer ??= setInterval(() => this.check(), CHECK_MS);
    this.events.emit('change');
  }

  /** The takes whose end has passed get their last notes. */
  private check(): void {
    const now = this.engine.sessionClock;
    for (const r of this.recordings.values()) {
      if (r.ending && now >= r.ending.end) this.close(r, r.ending);
    }
    this.stopTimer();
  }

  /** The transport stopped: the ending takes are closed, the others end at the beat after their last note
   *  (without notes, no clip). */
  private finishAll(): void {
    for (const r of this.recordings.values()) {
      if (r.ending) {
        this.close(r, r.ending);
        continue;
      }
      const last = r.take.lastEvent;
      this.recordings.delete(r.ref.track);
      if (last === null) continue;
      const length = takeLength(last - r.take.start, this.quantum());
      this.write(r, { id: this.store.ids.next('clip'), end: r.take.start + length, length });
    }
    this.stopTimer();
    this.events.emit('change');
  }

  private close(r: Recording, ending: Ending): void {
    this.write(r, ending);
    this.recordings.delete(r.ref.track);
    this.events.emit('change');
  }

  private write(r: Recording, { id, length }: Ending): void {
    // the track deleted meanwhile: the take goes with it
    if (!(this.store.project.track(r.ref.track) instanceof MidiTrack)) return;
    this.store.apply(recordedClip(r.ref, id, r.take.notes(length), length), { mergeKey: r.key });
  }

  private stopTimer(): void {
    if (this.timer === null || [...this.recordings.values()].some(r => r.ending)) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
