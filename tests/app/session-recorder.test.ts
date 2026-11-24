import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionRecorder } from '../../src/app/session-recorder';
import { FakeRecorderEngine } from '../helpers/recorder-engine';
import type { TrackId } from '../../src/core/id';
import { MidiClip } from '../../src/model/midi-clip';
import { newSlotMidiClip, recordedClip } from '../../src/store/session-edits';
import { setRecordQuantize } from '../../src/store/edits';
import { setup } from '../helpers/fixtures';

function harness(delay = 0, armed: ReadonlySet<TrackId> = new Set()) {
  const { store, track } = setup({ midi: 1, audio: 1 });
  // setup adds the audio tracks first
  const audio = track(0), midi = track(1);
  const engine = new FakeRecorderEngine();
  const said: string[] = [];
  const recorder = new SessionRecorder(engine, store, () => engine.quantum, t => said.push(t), { delay: () => delay, armed: () => armed });
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

  it('says when a take starts and when its clip is made, wherever it was started from', () => {
    const h = harness(), ref = { track: h.midi, slot: 1 };
    const events: unknown[] = [];
    h.recorder.onTake(e => events.push(e));
    h.recorder.toggle(ref);
    expect(events).toEqual([{ ref, clip: null }]);
    h.engine.sessionClock = 2;
    h.recorder.toggle(ref);
    expect(events).toEqual([{ ref, clip: null }, { ref, clip: h.clipAt(1)!.id }]);
    // closing it at the boundary doesn't say it again
    h.engine.sessionClock = 4;
    vi.advanceTimersByTime(100);
    expect(events).toHaveLength(2);
    // stopping the transport makes the clip of a take with notes
    h.recorder.toggle({ track: h.midi, slot: 2 });
    h.recorder.press(h.midi, 60, 100);
    h.engine.stop();
    expect(events.at(-1)).toEqual({ ref: { track: h.midi, slot: 2 }, clip: h.clipAt(2)!.id });
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

/** A 4-beat looping clip in slot 0 with a note at beat 0, playing since `since` on the clock. */
function overdubbing(since = 0, delay = 0) {
  const h = harness(delay), ref = { track: h.midi, slot: 0 };
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

describe('SessionRecorder: overdub', () => {
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

describe('SessionRecorder: quantization and latency', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const sixteenths = { grid: '1/16', triplet: false, strength: 1, ends: false };

  it("a take's notes are quantized as the project says", () => {
    const h = harness(), ref = { track: h.midi, slot: 0 };
    h.store.apply(setRecordQuantize(sixteenths));
    h.recorder.toggle(ref);
    h.engine.sessionClock = 1.07;
    h.recorder.press(h.midi, 60, 100);
    h.engine.sessionClock = 1.5;
    h.recorder.release(h.midi, 60);
    h.engine.sessionClock = 2;
    h.recorder.toggle(ref);
    expect(h.clipAt(0)!.notes).toEqual([{ pitch: 60, velocity: 100, start: 1, duration: 0.5 }]);
  });

  it('the notes fall earlier by the latency compensation, also the end of the take', () => {
    const h = harness(0.1), ref = { track: h.midi, slot: 0 };
    h.recorder.toggle(ref);
    h.engine.sessionClock = 1.1;
    h.recorder.press(h.midi, 60, 100);
    h.engine.sessionClock = 1.6;
    h.recorder.release(h.midi, 60);
    h.engine.sessionClock = 2;
    h.recorder.toggle(ref);
    // heard just before the end (4), arrived just after it: it's in the take
    h.engine.sessionClock = 4.05;
    h.recorder.press(h.midi, 64, 90);
    vi.advanceTimersByTime(100);
    expect(h.recorder.recordingSlot(h.midi)).toBe(0);
    h.engine.sessionClock = 4.15;
    vi.advanceTimersByTime(100);
    expect(h.recorder.recordingSlot(h.midi)).toBeNull();
    const notes = h.clipAt(0)!.notes;
    expect(notes[0]).toEqual({ pitch: 60, velocity: 100, start: 1, duration: 0.5 });
    expect(notes[1].pitch).toBe(64);
    expect(notes[1].start).toBeCloseTo(3.95, 9);
  });

  it('the first note, on the very first step, keeps its length with the compensation', () => {
    const h = harness(0.12), ref = { track: h.midi, slot: 0 };
    h.store.apply(setRecordQuantize(sixteenths));
    h.recorder.toggle(ref);
    // pressed with the take: heard 0.12 earlier, before the clip's start
    h.recorder.press(h.midi, 60, 100);
    h.engine.sessionClock = 0.25;
    h.recorder.release(h.midi, 60);
    h.engine.sessionClock = 2;
    h.recorder.toggle(ref);
    expect(h.clipAt(0)!.notes).toEqual([{ pitch: 60, velocity: 100, start: 0, duration: expect.closeTo(0.25, 9) }]);
  });

  it("overdub: quantized in the clip's loop, earlier by the compensation", () => {
    const h = overdubbing(0, 0.1);
    h.store.apply(setRecordQuantize(sixteenths));
    h.recorder.toggleOverdub();
    h.play(5.6); // heard at 5.5: beat 1.5 of the clip
    h.recorder.press(h.midi, 60, 100);
    h.play(5.85);
    h.recorder.release(h.midi, 60);
    expect(h.notes()).toEqual([{ pitch: 60, velocity: 100, start: 1.5, duration: 0.25 }]);
    // right at the loop's end it's the loop's start
    h.play(4.07);
    h.recorder.press(h.midi, 62, 100);
    h.play(4.2);
    h.recorder.release(h.midi, 62);
    expect(h.notes().find(n => n.pitch === 62)!.start).toBe(0);
  });
});
