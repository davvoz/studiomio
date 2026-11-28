import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArrangementRecorder, type ArrangementRecorderEngine } from '../../src/app/arrangement-recorder';
import type { TrackId } from '../../src/core/id';
import type { Moment } from '../../src/model/arrangement-take';
import { MidiClip } from '../../src/model/midi-clip';
import { addMidiClip, setMixer, setRecordQuantize } from '../../src/store/edits';
import { edit } from '../../src/store/project-store';
import { setup } from '../helpers/fixtures';

/** An engine whose playhead the test moves: `beat` on the timeline, `shift` added for the clock. */
class FakeEngine implements ArrangementRecorderEngine {
  playing = false;
  beat = 0;
  shift = 0;
  /** How far back the latency puts what's heard. */
  delays: number[] = [];
  private listener: ((playing: boolean) => void) | null = null;

  heard(delay: number): Moment | null {
    this.delays.push(delay);
    return this.playing ? { beat: this.beat, clock: this.beat + this.shift } : null;
  }

  play(): void {
    this.playing = true;
  }

  onStateChange(fn: (playing: boolean) => void) {
    this.listener = fn;
    return () => { this.listener = null; };
  }

  stop(): void {
    this.playing = false;
    this.listener?.(false);
  }
}

function rig(busy: ReadonlySet<TrackId> = new Set()) {
  const r = setup({ audio: 1, midi: 2 });
  const engine = new FakeEngine();
  const said: string[] = [];
  const midi = r.track(1), other = r.track(2), audio = r.track(0);
  const armed = new Set([midi]);
  const recorder = new ArrangementRecorder(engine, r.store, t => said.push(t), { delay: () => 0.5, busy: t => busy.has(t), armed: () => armed });
  const clips = (t: TrackId) => r.store.project.track(t)!.arrangement;
  const notes = (t: TrackId) => (clips(t)[0].clip as MidiClip).notes.map(n => [n.pitch, n.start, n.duration]);
  return { ...r, engine, recorder, said, midi, other, audio, armed, clips, notes };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('recording onto the timeline (● Rec)', () => {
  it('with the transport stopped it plays from the cursor; ● Rec again writes a clip from the punch-in', () => {
    const r = rig();
    r.engine.beat = 8;
    r.recorder.toggle();
    expect(r.engine.playing).toBe(true);
    expect(r.recorder.recording).toBe(true);
    r.engine.beat = 9;
    r.recorder.press(r.midi, 60, 100);
    r.engine.beat = 10;
    r.recorder.release(r.midi, 60);
    expect(r.recorder.current).toEqual({ span: { start: 8, end: 10 }, tracks: [r.midi] });
    r.engine.beat = 12;
    r.recorder.toggle();
    expect(r.recorder.recording).toBe(false);
    expect(r.recorder.current).toBeNull();
    expect(r.clips(r.midi).map(p => [p.start, p.length])).toEqual([[8, 4]]);
    expect(r.notes(r.midi)).toEqual([[60, 1, 1]]);
    // the transport goes on: ● Rec only punches out
    expect(r.engine.playing).toBe(true);
    // what's heard is behind the clock by the latency compensation
    expect(r.engine.delays.every(d => d === 0.5)).toBe(true);
    expect(r.said.at(-1)).toBe('Recorded: a new clip on the timeline.');
  });

  it('it replaces what was under it, quantized as the project says; it is one undo step', () => {
    const r = rig();
    r.store.apply(setRecordQuantize({ grid: '1/4', triplet: false, strength: 1, ends: false }));
    r.engine.playing = true;
    r.recorder.toggle();
    r.recorder.press(r.midi, 62, 90);
    r.engine.beat = 1.1;
    r.recorder.release(r.midi, 62);
    r.engine.beat = 2.2;
    r.recorder.press(r.midi, 64, 90);
    r.engine.beat = 4;
    r.recorder.toggle();
    expect(r.notes(r.midi)).toEqual([[62, 0, 1.1], [64, 2, 2]]);
    const before = r.store.project;
    r.engine.beat = 2;
    r.recorder.toggle();
    r.recorder.press(r.midi, 67, 100);
    r.engine.beat = 3;
    r.recorder.toggle();
    // the new clip covers [2, 3): the first one is cut in two around it
    expect(r.clips(r.midi).map(p => [p.start, p.length])).toEqual([[0, 2], [2, 1], [3, 1]]);
    r.store.undo();
    expect(r.store.project).toBe(before);
  });

  it('only armed MIDI tracks not recording into a session slot; nothing played, no clip', () => {
    const r = rig();
    const busy = rig(new Set([r.track(1)]));
    for (const x of [r, busy]) {
      x.recorder.toggle();
      x.recorder.press(x.audio, 60, 100);
      x.recorder.press(x.midi, 60, 100);
      x.engine.beat = 4;
      x.recorder.toggle();
    }
    expect(r.clips(r.audio)).toEqual([]);
    expect(r.clips(r.midi)).toHaveLength(1);
    expect(busy.clips(busy.midi)).toEqual([]);
    expect(busy.said.at(-1)).toMatch(/nothing was played/);
  });

  it('Stop ends the recording where the playhead was last seen', () => {
    const r = rig();
    r.recorder.toggle();
    r.recorder.press(r.midi, 60, 100);
    r.engine.beat = 2;
    vi.advanceTimersByTime(60);
    r.engine.stop();
    expect(r.recorder.recording).toBe(false);
    expect(r.clips(r.midi).map(p => [p.start, p.length])).toEqual([[0, 2]]);
    expect(r.notes(r.midi)).toEqual([[60, 0, 2]]);
  });

  it('a jump of the playhead writes the take so far and starts a new one there', () => {
    const r = rig();
    r.recorder.toggle();
    r.recorder.press(r.other, 60, 100);
    r.engine.beat = 2;
    vi.advanceTimersByTime(60);
    // a click on the ruler: the clock goes on, the beat jumps to 16
    r.engine.shift = 2 - 16;
    r.engine.beat = 16;
    r.recorder.release(r.other, 60);
    r.recorder.press(r.other, 62, 100);
    r.engine.beat = 17;
    r.recorder.toggle();
    expect(r.clips(r.other).map(p => [p.start, p.length])).toEqual([[0, 2], [16, 1]]);
    expect(r.said.at(-1)).toBe('Recorded: 2 new clips on the timeline.');
  });

  it('the movements of an armed track become the clip curves; the control goes back; one undo step', () => {
    const r = rig();
    r.recorder.recordMoves = true;
    const before = r.store.project;
    r.recorder.toggle();
    r.recorder.press(r.midi, 60, 100);
    r.engine.beat = 1;
    r.store.apply(setMixer(r.midi, { pan: 0.5 }));
    r.engine.beat = 2;
    r.store.apply(setMixer(r.midi, { pan: -0.25 }));
    // not armed: not recorded
    r.store.apply(setMixer(r.other, { pan: 0.75 }));
    r.engine.beat = 4;
    r.recorder.toggle();
    const [pl] = r.clips(r.midi);
    expect(pl.clip.envelopes).toEqual([{ target: { kind: 'mixer', param: 'pan' }, points: [
      { beat: 1, value: 0 }, { beat: 1, value: 0.5 }, { beat: 2, value: -0.25 },
    ] }]);
    expect(r.store.project.track(r.midi)!.mixer.pan).toBe(0);
    expect(r.store.project.track(r.other)!.mixer.pan).toBe(0.75);
    expect(r.clips(r.other)).toEqual([]);
    // the take (clip and control back) is one step: undone, the knob is where the hand left it
    r.store.undo();
    expect(r.store.project.track(r.midi)!.mixer.pan).toBe(-0.25);
    expect(r.clips(r.midi)).toEqual([]);
    r.store.undo();
    r.store.undo();
    r.store.undo();
    expect(r.store.project).toBe(before);
  });

  it('only movements, nothing played: the clip keeps the notes under it, the movements over them', () => {
    const r = rig();
    r.recorder.recordMoves = true;
    r.store.apply(addMidiClip(r.midi, 0, 8));
    r.store.apply(edit('notes', p => p.updatingTrack(r.midi, t => {
      const pl = t.arrangement[0];
      return t.updatingPlacement(pl.id, x => ({ ...x, clip: (x.clip as MidiClip).addingNotes({ pitch: 48, start: 2.5, duration: 4, velocity: 90 }, { pitch: 50, start: 6, duration: 1, velocity: 90 }) }), r.ids);
    })));
    r.engine.beat = 2;
    r.recorder.toggle();
    r.engine.beat = 3;
    r.store.apply(setMixer(r.midi, { volumeDb: -12 }));
    r.engine.beat = 4;
    r.recorder.toggle();
    expect(r.clips(r.midi).map(p => [p.start, p.length])).toEqual([[0, 2], [2, 2], [4, 4]]);
    const rec = r.clips(r.midi)[1].clip as MidiClip;
    // the note under it, cut to the stretch
    expect(rec.notes.map(n => [n.pitch, n.start, n.duration])).toEqual([[48, 0.5, 1.5]]);
    expect(rec.envelopes.map(e => e.target)).toEqual([{ kind: 'mixer', param: 'volume' }]);
    expect(r.store.project.track(r.midi)!.mixer.volumeDb).toBe(0);
  });

  it('without "record the movements" a moved control is not recorded', () => {
    const r = rig();
    r.recorder.toggle();
    r.engine.beat = 1;
    r.store.apply(setMixer(r.midi, { pan: 0.5 }));
    r.engine.beat = 2;
    r.recorder.toggle();
    expect(r.clips(r.midi)).toEqual([]);
    expect(r.store.project.track(r.midi)!.mixer.pan).toBe(0.5);
  });
});
