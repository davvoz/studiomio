import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionRecorder, type RecorderEngine } from '../../src/app/session-recorder';
import type { TrackId } from '../../src/core/id';
import type { TrackSessionState } from '../../src/engine/session';
import type { Track } from '../../src/model/track';
import { MidiClip } from '../../src/model/midi-clip';
import { newSlotMidiClip, recordedClip } from '../../src/store/session-edits';
import { setup } from '../helpers/fixtures';

/** An engine whose clock the test moves; boundaries every `quantum` beats. */
class FakeEngine implements RecorderEngine {
  playing = false;
  sessionClock = 0;
  quantum = 4;
  readonly launched: [TrackId, number][] = [];
  readonly started: TrackId[] = [];
  /** What each track plays in the session (none: nothing). */
  readonly states = new Map<TrackId, TrackSessionState>();
  private stateListener: ((playing: boolean) => void) | null = null;

  get nextBoundary(): number {
    return Math.ceil(this.sessionClock / this.quantum - 1e-9) * this.quantum;
  }

  startRecording(track: TrackId): number {
    this.started.push(track);
    if (this.playing) return this.nextBoundary;
    this.playing = true;
    return this.sessionClock;
  }

  launchSlot(track: TrackId, slot: number): void {
    this.launched.push([track, slot]);
  }

  sessionState(track: Track): TrackSessionState {
    return this.states.get(track.id) ?? { playing: null, queued: null, followsArrangement: true };
  }

  onStateChange(fn: (playing: boolean) => void) {
    this.stateListener = fn;
    return () => { this.stateListener = null; };
  }

  stop(): void {
    this.playing = false;
    this.stateListener?.(false);
  }
}

function harness() {
  const { store, track } = setup({ midi: 1, audio: 1 });
  // setup adds the audio tracks first
  const audio = track(0), midi = track(1);
  const engine = new FakeEngine();
  const said: string[] = [];
  const recorder = new SessionRecorder(engine, store, () => engine.quantum, t => said.push(t));
  const clipAt = (slot: number) => store.project.track(midi)!.slots[slot] as MidiClip | null;
  return { store, midi, audio, engine, recorder, clipAt, said };
}

describe('SessionRecorder', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('with the transport stopped it starts it and records from the cursor', () => {
    const h = harness(), ref = { track: h.midi, slot: 0 };
    h.engine.sessionClock = 8;
    h.recorder.toggle(ref);
    expect(h.engine.playing).toBe(true);
    expect(h.recorder.recordingSlot(h.midi)).toBe(0);
    h.recorder.press(h.midi, 60, 100);
    h.engine.sessionClock = 9;
    h.recorder.release(h.midi, 60);
    h.engine.sessionClock = 10.5;
    // ● again: the clip ends at the next boundary (12) and starts looping there
    h.recorder.toggle(ref);
    const clip = h.clipAt(0)!;
    expect(clip).toBeInstanceOf(MidiClip);
    expect(clip.notes).toEqual([{ pitch: 60, start: 0, duration: 1, velocity: 100 }]);
    expect(clip.loop).toEqual({ enabled: true, start: 0, end: 4 });
    expect(h.engine.launched).toEqual([[h.midi, 0]]);
  });

  it('the notes played until the boundary go into the clip, in a single undo step', () => {
    const h = harness(), ref = { track: h.midi, slot: 0 };
    h.recorder.toggle(ref);
    h.engine.sessionClock = 2;
    h.recorder.toggle(ref);
    const id = h.clipAt(0)!.id;
    // after the click, before the boundary at 4
    h.engine.sessionClock = 3;
    h.recorder.press(h.midi, 62, 80);
    h.engine.sessionClock = 4;
    vi.advanceTimersByTime(100);
    expect(h.recorder.recordingSlot(h.midi)).toBeNull();
    const clip = h.clipAt(0)!;
    expect(clip.id).toBe(id);
    expect(clip.notes).toEqual([{ pitch: 62, start: 3, duration: 1, velocity: 80 }]);
    h.store.undo();
    expect(h.clipAt(0)).toBeNull();
  });

  it('while playing the take starts at the next boundary', () => {
    const h = harness(), ref = { track: h.midi, slot: 1 };
    h.engine.playing = true;
    h.engine.sessionClock = 5;
    h.recorder.toggle(ref);
    // before the start (8): too early to count
    h.engine.sessionClock = 6;
    h.recorder.press(h.midi, 60, 100);
    h.recorder.release(h.midi, 60);
    h.engine.sessionClock = 9;
    h.recorder.press(h.midi, 64, 100);
    h.engine.sessionClock = 10;
    h.recorder.release(h.midi, 64);
    h.recorder.toggle(ref);
    expect(h.clipAt(1)!.notes).toEqual([{ pitch: 64, start: 1, duration: 1, velocity: 100 }]);
  });

  it('ending before the take begins leaves no clip', () => {
    const h = harness(), ref = { track: h.midi, slot: 0 };
    h.engine.playing = true;
    h.engine.sessionClock = 1;
    h.recorder.toggle(ref);
    h.recorder.toggle(ref);
    expect(h.clipAt(0)).toBeNull();
    expect(h.recorder.recordingSlot(h.midi)).toBeNull();
    expect(h.engine.launched).toEqual([]);
  });

  it('the clip in the slot is replaced by the take', () => {
    const h = harness(), ref = { track: h.midi, slot: 0 };
    h.store.apply(newSlotMidiClip(ref));
    const old = h.clipAt(0)!.id;
    h.recorder.toggle(ref);
    h.recorder.press(h.midi, 60, 100);
    h.engine.sessionClock = 1;
    h.recorder.toggle(ref);
    expect(h.clipAt(0)!.id).not.toBe(old);
    expect(h.clipAt(0)!.notes).toHaveLength(1);
  });

  it('stopping the transport ends the take after its last note, without launching it', () => {
    const h = harness(), ref = { track: h.midi, slot: 0 };
    h.recorder.toggle(ref);
    h.engine.sessionClock = 4.5;
    h.recorder.press(h.midi, 60, 100);
    h.engine.sessionClock = 5;
    h.recorder.release(h.midi, 60);
    h.engine.stop();
    const clip = h.clipAt(0)!;
    expect(clip.loop.end).toBe(8);
    expect(clip.notes).toEqual([{ pitch: 60, start: 4.5, duration: 0.5, velocity: 100 }]);
    expect(h.engine.launched).toEqual([]);
    expect(h.recorder.recordingSlot(h.midi)).toBeNull();
  });

  it('stopping the transport without having played leaves no clip', () => {
    const h = harness();
    h.recorder.toggle({ track: h.midi, slot: 0 });
    h.engine.stop();
    expect(h.clipAt(0)).toBeNull();
  });

  it('only MIDI tracks record', () => {
    const h = harness();
    h.recorder.toggle({ track: h.audio, slot: 0 });
    expect(h.recorder.recordingSlot(h.audio)).toBeNull();
    expect(h.engine.started).toEqual([]);
  });

  it('the notes of other tracks aren\'t recorded', () => {
    const h = harness(), ref = { track: h.midi, slot: 0 };
    h.recorder.toggle(ref);
    h.recorder.press(h.audio, 60, 100);
    h.engine.sessionClock = 1;
    h.recorder.toggle(ref);
    expect(h.clipAt(0)!.notes).toEqual([]);
  });
});

describe('SessionRecorder: overdub', () => {
  /** A 4-beat looping clip in slot 0 with a note at beat 0, playing since `since` on the clock. */
  function overdubbing(since = 0) {
    const h = harness(), ref = { track: h.midi, slot: 0 };
    const id = h.store.ids.next('clip');
    h.store.apply(recordedClip(ref, id, [{ pitch: 48, start: 0, duration: 1, velocity: 90 }], 4));
    h.engine.playing = true;
    const play = (clock: number) => {
      h.engine.sessionClock = clock;
      h.engine.states.set(h.midi, { playing: { slot: 0, elapsed: clock - since }, queued: null, followsArrangement: false });
    };
    play(since);
    const notes = () => h.clipAt(0)!.notes.filter(n => n.pitch !== 48);
    return { ...h, ref, id, play, notes };
  }

  it('turns on and off, saying it', () => {
    const h = harness();
    const changed = vi.fn();
    h.recorder.onChange(changed);
    expect(h.recorder.overdub).toBe(false);
    h.recorder.toggleOverdub();
    expect(h.recorder.overdub).toBe(true);
    expect(h.said.at(-1)).toContain('Overdub on');
    h.recorder.toggleOverdub();
    expect(h.said.at(-1)).toBe('Overdub off.');
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('the notes go into the playing clip where they fall in its loop, next to its notes, the clip the same one', () => {
    const h = overdubbing();
    h.recorder.toggleOverdub();
    h.play(5.5); // second turn: beat 1.5 of the clip
    h.recorder.press(h.midi, 60, 100);
    h.play(6);
    h.recorder.release(h.midi, 60);
    expect(h.clipAt(0)!.id).toBe(h.id);
    expect(h.notes()).toEqual([{ pitch: 60, start: 1.5, duration: 0.5, velocity: 100 }]);
    expect(h.clipAt(0)!.notes).toHaveLength(2);
  });

  it("a note held over the loop's end stops there; the same key again ends the first note", () => {
    const h = overdubbing();
    h.recorder.toggleOverdub();
    h.play(3);
    h.recorder.press(h.midi, 60, 100);
    h.play(6);
    h.recorder.release(h.midi, 60);
    h.play(6.25);
    h.recorder.press(h.midi, 62, 70);
    h.play(6.5);
    h.recorder.press(h.midi, 62, 80);
    h.play(7);
    h.recorder.release(h.midi, 62);
    // the clip keeps its notes in order
    expect(h.notes()).toEqual([
      { pitch: 62, start: 2.25, duration: 0.25, velocity: 70 },
      { pitch: 62, start: 2.5, duration: 0.5, velocity: 80 },
      { pitch: 60, start: 3, duration: 1, velocity: 100 },
    ]);
  });

  it('a whole pass is a single undo step; turning it on again starts a new one', () => {
    const h = overdubbing();
    h.recorder.toggleOverdub();
    for (const [at, pitch] of [[1, 60], [2, 62]] as const) {
      h.play(at);
      h.recorder.press(h.midi, pitch, 100);
      h.play(at + 0.5);
      h.recorder.release(h.midi, pitch);
    }
    h.recorder.toggleOverdub();
    h.recorder.toggleOverdub();
    h.play(3);
    h.recorder.press(h.midi, 64, 100);
    h.play(3.5);
    h.recorder.release(h.midi, 64);
    expect(h.notes().map(n => n.pitch)).toEqual([60, 62, 64]);
    h.store.undo();
    expect(h.notes().map(n => n.pitch)).toEqual([60, 62]);
    h.store.undo();
    expect(h.notes()).toEqual([]);
    expect(h.clipAt(0)!.notes).toHaveLength(1);
  });

  it("a note pressed during overdub is kept when released after it went off; one pressed with it off isn't", () => {
    const h = overdubbing();
    h.recorder.toggleOverdub();
    h.play(1);
    h.recorder.press(h.midi, 60, 100);
    h.recorder.toggleOverdub();
    h.recorder.press(h.midi, 62, 100);
    h.play(2);
    h.recorder.release(h.midi, 60);
    h.recorder.release(h.midi, 62);
    expect(h.notes().map(n => [n.pitch, n.duration])).toEqual([[60, 1]]);
  });

  it("nothing is recorded without a playing MIDI clip, past the end of one that doesn't loop, or if the clip was replaced", () => {
    const h = overdubbing();
    h.recorder.toggleOverdub();
    // the track plays nothing
    h.engine.states.delete(h.midi);
    h.recorder.press(h.midi, 60, 100);
    h.recorder.release(h.midi, 60);
    // an audio track
    h.recorder.press(h.audio, 60, 100);
    h.recorder.release(h.audio, 60);
    expect(h.notes()).toEqual([]);
    // a clip that doesn't loop, after its end
    h.store.apply(recordedClip(h.ref, h.id, [], 4));
    const clip = h.clipAt(0)!;
    h.store.apply({ label: 'no loop', apply: p => p.updatingTrack(h.midi, t => t.withSlot(0, clip.withLoop({ ...clip.loop, enabled: false }))) });
    h.play(5);
    h.recorder.press(h.midi, 60, 100);
    h.recorder.release(h.midi, 60);
    expect(h.notes()).toEqual([]);
    // replaced while the note is held
    h.store.apply(recordedClip(h.ref, h.id, [], 4));
    h.play(1);
    h.recorder.press(h.midi, 62, 100);
    h.store.apply(recordedClip(h.ref, h.store.ids.next('clip'), [], 4));
    h.play(2);
    h.recorder.release(h.midi, 62);
    expect(h.notes()).toEqual([]);
  });

  it('a track recording a take records the take; stopping the transport drops the held notes', () => {
    const h = overdubbing();
    h.recorder.toggleOverdub();
    h.play(1);
    h.recorder.press(h.midi, 60, 100);
    h.engine.stop();
    h.recorder.release(h.midi, 60);
    expect(h.notes()).toEqual([]);
    h.recorder.toggle({ track: h.midi, slot: 1 });
    h.recorder.press(h.midi, 62, 100);
    h.recorder.release(h.midi, 62);
    expect(h.notes()).toEqual([]);
    expect(h.recorder.recordingSlot(h.midi)).toBe(1);
  });
});
