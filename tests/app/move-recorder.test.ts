import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionRecorder } from '../../src/app/session-recorder';
import { gestureCurve, trackKnobs } from '../../src/app/track-knobs';
import { DEVICE_ON, envelopeValueAt, INSTRUMENT_DEVICE, type ModTarget } from '../../src/model/envelope';
import type { MidiClip } from '../../src/model/midi-clip';
import { addEffect, setEffectEnabled, setMixer } from '../../src/store/edits';
import { groupDevices, mapMacro } from '../../src/store/rack-edits';
import { recordedClip, touchCurve } from '../../src/store/session-edits';
import { setup } from '../helpers/fixtures';
import { FakeRecorderEngine } from '../helpers/recorder-engine';

const PAN: ModTarget = { kind: 'mixer', param: 'pan' };
const VOLUME: ModTarget = { kind: 'mixer', param: 'volume' };

function rig() {
  const { store, track } = setup({ midi: 1 });
  const midi = track(0);
  const engine = new FakeRecorderEngine();
  const armed = new Set([midi]);
  const recorder = new SessionRecorder(engine, store, () => 4, () => undefined, { armed: () => armed });
  recorder.recordMoves = true;
  const t = () => store.project.track(midi)!;
  const clipAt = (slot: number) => t().slots[slot] as MidiClip | null;
  const at = (clock: number) => { engine.sessionClock = clock; };
  const pan = (v: number) => store.apply(setMixer(midi, { pan: v }));
  const wait = (time: number) => { vi.advanceTimersByTime(time); };
  return { store, midi, engine, recorder, armed, t, clipAt, at, pan, wait };
}

/** A take on slot 0 from clock 0 to 4 with `moves` in between (each at its clock). */
function take(r: ReturnType<typeof rig>, moves: readonly (readonly [number, () => void])[]) {
  const ref = { track: r.midi, slot: 0 };
  r.recorder.toggle(ref);
  for (const [clock, move] of moves) {
    r.at(clock);
    move();
  }
  r.at(3);
  r.recorder.toggle(ref);
  r.at(4);
  r.wait(100);
}

/** A 4-beat clip playing in slot 0 since clock 0, overdub on; `play(c)` moves the clock to `c`. */
function overdubbing(r: ReturnType<typeof rig>) {
  const ref = { track: r.midi, slot: 0 };
  r.store.apply(recordedClip(ref, r.store.ids.next('clip'), [{ pitch: 48, start: 0, duration: 1, velocity: 90 }], 4));
  r.engine.playing = true;
  const play = (clock: number) => {
    r.at(clock);
    r.engine.states.set(r.midi, { playing: { slot: 0, elapsed: clock }, queued: null, followsArrangement: false });
  };
  play(0);
  r.recorder.toggleOverdub();
  return play;
}

describe('recording movements: takes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a control moved during a take becomes the clip\'s curve, and goes back where it was', () => {
    const r = rig();
    take(r, [[1, () => r.pan(0.2)], [1.5, () => r.pan(0.5)]]);
    expect(r.clipAt(0)!.envelope(PAN)!.points).toEqual([{ beat: 1, value: 0 }, { beat: 1, value: 0.2 }, { beat: 1.5, value: 0.5 }]);
    expect(r.t().mixer.pan).toBe(0);
    // the clip and the control back: one undo step
    r.store.undo();
    expect(r.clipAt(0)).toBeNull();
  });

  it('with the movements off nothing is recorded and the control stays where it was moved', () => {
    const r = rig();
    r.recorder.recordMoves = false;
    expect(r.recorder.recordMoves).toBe(false);
    take(r, [[1, () => r.pan(0.4)]]);
    expect(r.clipAt(0)!.envelopes).toEqual([]);
    expect(r.t().mixer.pan).toBe(0.4);
  });

  it('the volume: the fader goes to the highest point and the curve lowers it, before the gesture too', () => {
    const r = rig();
    r.store.apply(setMixer(r.midi, { volumeDb: -6 }));
    take(r, [[1, () => r.store.apply(setMixer(r.midi, { volumeDb: 0 }))], [2, () => r.store.apply(setMixer(r.midi, { volumeDb: -12 }))]]);
    expect(r.t().mixer.volumeDb).toBe(0);
    const [before, ...gesture] = r.clipAt(0)!.envelope(VOLUME)!.points;
    expect(before.beat).toBe(1);
    expect(before.value).toBeCloseTo(Math.pow(10, -6 / 40), 9);
    expect(gesture[0]).toEqual({ beat: 1, value: 1 });
    expect(gesture[1].value).toBeCloseTo(Math.pow(10, -12 / 40), 9);
  });

  it('an effect switched off and on: steps', () => {
    const r = rig();
    r.store.apply(addEffect(r.midi, 'delay', 'Delay'));
    const fx = r.t().effects[0].id;
    take(r, [[1, () => r.store.apply(setEffectEnabled(r.midi, fx, false))], [2, () => r.store.apply(setEffectEnabled(r.midi, fx, true))]]);
    const target: ModTarget = { kind: 'device', device: fx, param: DEVICE_ON };
    expect(r.clipAt(0)!.envelope(target)!.points).toEqual([
      { beat: 1, value: 1 }, { beat: 1, value: 0 }, { beat: 2, value: 0 }, { beat: 2, value: 1 },
    ]);
    expect(r.t().effects[0].enabled).toBe(true);
  });

  it('stopping the transport writes the take and puts the controls back; a take ended before it began too', () => {
    const r = rig();
    const ref = { track: r.midi, slot: 0 };
    r.recorder.toggle(ref);
    r.at(1);
    r.recorder.press(r.midi, 60, 100);
    r.pan(0.3);
    r.at(1.5);
    r.recorder.release(r.midi, 60);
    r.engine.stop();
    expect(r.clipAt(0)!.envelope(PAN)!.points.at(-1)).toEqual({ beat: 1, value: 0.3 });
    expect(r.t().mixer.pan).toBe(0);
    // playing: a take ended before its start (the next boundary) keeps nothing
    r.engine.playing = true;
    r.at(5);
    r.recorder.toggle({ track: r.midi, slot: 1 });
    r.at(9);
    r.pan(0.6);
    r.at(7);
    r.recorder.toggle({ track: r.midi, slot: 1 });
    expect(r.clipAt(1)).toBeNull();
    expect(r.t().mixer.pan).toBe(0);
  });
});

describe('recording movements: overdub', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a touched control records up to the loop's end, also where it stays still (Live's latch); then it goes back", () => {
    const r = rig();
    const play = overdubbing(r);
    // an old curve: a ramp from 0.5 to -0.5
    r.store.apply(touchCurve({ track: r.midi, slot: 0 }, r.clipAt(0)!.id, PAN, [{ beat: 0, value: 0.5 }, { beat: 4, value: -0.5 }]));
    const old = r.clipAt(0)!.envelope(PAN)!.points;
    play(5);
    r.pan(0.3);
    play(5.25);
    r.pan(0.6);
    // still: nothing written until the loop comes round, the control where it was left
    play(6);
    r.wait(100);
    play(7);
    r.wait(100);
    expect(r.clipAt(0)!.envelope(PAN)!.points).toBe(old);
    expect(r.t().mixer.pan).toBe(0.6);
    // round: from the touch to the loop's end the gesture, then the value held; before the touch the old ramp
    play(8.5);
    r.wait(100);
    const at = (beat: number) => envelopeValueAt(r.clipAt(0)!.envelope(PAN)!.points, beat);
    expect(at(1.125)).toBeCloseTo(0.45, 9);
    expect([2, 3, 3.99].map(at)).toEqual([0.6, 0.6, 0.6]);
    expect(at(0.5)).toBeCloseTo(0.375, 9);
    expect(r.t().mixer.pan).toBe(0);
    // the control put back isn't a movement
    const points = r.clipAt(0)!.envelope(PAN)!.points;
    play(10);
    r.wait(1000);
    expect(r.clipAt(0)!.envelope(PAN)!.points).toBe(points);
  });

  it("moved over the loop's end it goes on, up to the end of the loop where it last moved", () => {
    const r = rig();
    const play = overdubbing(r);
    play(1);
    r.pan(0.2);
    play(4.5);
    r.pan(0.4);
    play(5.2);
    r.pan(0.5);
    // still in the second turn: held to its end
    play(6);
    r.wait(100);
    expect(r.t().mixer.pan).toBe(0.5);
    play(8.2);
    r.wait(100);
    expect(r.t().mixer.pan).toBe(0);
    const at = (beat: number) => envelopeValueAt(r.clipAt(0)!.envelope(PAN)!.points, beat);
    expect([0, 0.5, 1.2, 2, 3.99].map(at)).toEqual([0.2, 0.4, 0.5, 0.5, 0.5]);
  });

  it("a gesture over the loop's end: the stretch so far is written, the value held goes on from the loop's start", () => {
    const r = rig();
    const play = overdubbing(r);
    play(3.5);
    r.pan(0.5);
    play(3.75);
    r.pan(0.6);
    // the loop came round: beat 0.5, the knob still relative to where it was before the gesture
    play(4.5);
    r.pan(-0.5);
    play(4.75);
    r.pan(-0.4);
    // turning overdub off writes what's left
    r.recorder.toggleOverdub();
    const points = r.clipAt(0)!.envelope(PAN)!.points;
    expect(points.map(q => q.beat)).toEqual([0, 0, 0.5, 0.75, 0.75, 3.5, 3.5, 3.75, 4]);
    expect(points.map(q => q.value)).toEqual([0, 0.6, -0.5, expect.closeTo(-0.4, 9), 0, 0, 0.5, expect.closeTo(0.6, 9), expect.closeTo(0.6, 9)]);
    expect(r.t().mixer.pan).toBe(0);
  });

  it('its clip stopping ends the gesture', () => {
    const r = rig();
    const play = overdubbing(r);
    play(1);
    r.pan(0.3);
    r.engine.states.set(r.midi, { playing: null, queued: null, followsArrangement: false });
    r.wait(100);
    expect(r.clipAt(0)!.envelope(PAN)!.points.at(-1)).toEqual({ beat: 1, value: 0.3 });
    expect(r.t().mixer.pan).toBe(0);
  });

  it('only on the armed tracks, only with overdub on; the transport stopping writes the gestures', () => {
    const r = rig();
    const play = overdubbing(r);
    r.armed.clear();
    play(1);
    r.pan(0.2);
    r.wait(400);
    expect(r.clipAt(0)!.envelope(PAN)).toBeUndefined();
    r.armed.add(r.midi);
    play(2);
    r.pan(0.4);
    r.engine.stop();
    expect(r.clipAt(0)!.envelope(PAN)!.points.at(-1)).toEqual({ beat: 2, value: 0.2 });
  });

  it('a pass is one undo step with its notes', () => {
    const r = rig();
    const play = overdubbing(r);
    play(1);
    r.recorder.press(r.midi, 60, 100);
    r.pan(0.5);
    play(1.5);
    r.recorder.release(r.midi, 60);
    r.wait(400);
    r.recorder.toggleOverdub();
    expect(r.clipAt(0)!.notes).toHaveLength(2);
    expect(r.clipAt(0)!.envelope(PAN)).toBeDefined();
    r.store.undo();
    expect(r.clipAt(0)!.notes).toHaveLength(1);
    expect(r.clipAt(0)!.envelope(PAN)).toBeUndefined();
  });
});

describe('the controls a recording reads', () => {
  it('volume, pan, the instrument, the effects with their on/off, the macros; not what a macro moves', () => {
    const { store, track } = setup({ midi: 1 });
    const midi = track(0);
    store.apply(addEffect(midi, 'delay', 'Delay'));
    const fx = store.project.track(midi)!.effects[0].id;
    store.apply(groupDevices(midi, [INSTRUMENT_DEVICE, fx]));
    const rack = store.project.track(midi)!.racks[0];
    store.apply(mapMacro(midi, rack.id, 1, fx, 'mix'));
    const keys = [...trackKnobs(store.project, midi).keys()];
    expect(keys).toEqual(expect.arrayContaining(['mixer:volume', 'mixer:pan', `${fx}:${DEVICE_ON}`, `${rack.id}:macro2`]));
    expect(keys.some(k => k.startsWith(`${INSTRUMENT_DEVICE}:`))).toBe(true);
    expect(keys).not.toContain(`${fx}:mix`);
    expect(trackKnobs(store.project, 'missing' as never).size).toBe(0);
    // a macro is set as itself
    const macro = trackKnobs(store.project, midi).get(`${rack.id}:macro2`)!;
    store.apply(macro.set(100));
    expect(store.project.track(midi)!.racks[0].macros[1].value).toBe(100);
  });

  it('a parameter\'s curve is its knob offset; the volume at silence is 0', () => {
    const { store, track } = setup({ midi: 1 });
    const knobs = trackKnobs(store.project, track(0));
    const param = [...knobs.values()].find(k => k.target.kind === 'device' && k.target.device === INSTRUMENT_DEVICE)!;
    const moved = { ...param, raw: param.raw, unit: Math.min(1, param.unit + 0.25) };
    expect(gestureCurve(param, [{ beat: 0, knob: moved }]).points[0].value).toBeCloseTo(moved.unit - param.unit, 9);
    const volume = knobs.get('mixer:volume')!;
    const silent = { ...volume, raw: -80 };
    expect(gestureCurve(volume, [{ beat: 0, knob: silent }]).points[0].value).toBe(0);
  });
});
