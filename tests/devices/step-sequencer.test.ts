import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import type { InstrumentCore, TransportPosition } from '../../src/devices/dsp/core';
import { seqSettings, seqStep, StepSequencer } from '../../src/devices/dsp/step-sequencer';
import { ANALOG } from '../../src/devices/instruments/analog/analog';
import { NEURO } from '../../src/devices/instruments/neuro/neuro';
import { SEQ_RATE, SEQ_SCALE, SEQ_SCALES } from '../../src/devices/sequencer';
import { INSTRUMENT_CORES } from '../../src/devices/worklet/cores';
import { NoteQueue } from '../../src/devices/worklet/note-queue';

const SR = 48000, BLOCK = 128, BPM = 120;
/** Samples per beat at 120 BPM: a sixteenth is 6000 samples. */
const BEAT = 24000, STEP = BEAT / 4;

type Event = { kind: 'on' | 'off'; frame: number; id: number; pitch?: number; velocity?: number };

/** A fake instrument writing what it receives and when (the sample it resumes playing from). */
class Recorder implements InstrumentCore {
  readonly events: Event[] = [];
  frame = 0;
  setParams(): void {}
  noteOn(id: number, pitch: number, velocity: number): void { this.events.push({ kind: 'on', frame: this.frame, id, pitch, velocity }); }
  noteOff(id: number): void { this.events.push({ kind: 'off', frame: this.frame, id }); }
  silence(): void {}
  render(_l: Float32Array, _r: Float32Array, _from: number, to: number): void { this.frame = this.block + to; }
  block = 0;
}

interface Held { readonly pitch: number; readonly on: number; readonly off: number }

/** Plays the sequencer in blocks like the AudioWorklet: notes held from the queue, transport from 0. */
function play(params: Record<string, number>, held: readonly Held[], frames: number, transport: (f: number) => TransportPosition | null = f => ({ beat: f / BEAT, bpm: BPM, beatsPerBar: 4 })) {
  const rec = new Recorder();
  const seq = new StepSequencer(rec, SR);
  seq.setTempo(BPM);
  seq.setParams(resolveParams(ANALOG, { seqOn: 1, ...params }));
  const queue = new NoteQueue();
  for (const h of held) queue.add(h.pitch, 100, h.on, h.off);
  const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
  for (let f = 0; f < frames; f += BLOCK) {
    rec.block = f;
    rec.frame = f;
    seq.setTransport(transport(f));
    queue.renderBlock(seq, l, r, f);
  }
  return rec.events;
}

const ons = (events: readonly Event[]) => events.filter(e => e.kind === 'on');

describe('step sequencer', () => {
  it('off it lets the notes through as they are', () => {
    const rec = new Recorder();
    const seq = new StepSequencer(rec, SR);
    seq.setParams(resolveParams(ANALOG, {}));
    seq.noteOn(7, 48, 100);
    seq.noteOff(7);
    expect(rec.events.map(e => [e.kind, e.id, e.pitch])).toEqual([['on', 7, 48], ['off', 7, undefined]]);
  });

  it('on it plays the steps on the sixteenths, transposed onto the held note, while it\'s held', () => {
    const events = play({ seqDensity: 100, seqRange: 0, seqSlide: 0, seqGate: 50 }, [{ pitch: 36, on: 0, off: 8 * STEP }], 12 * STEP);
    const on = ons(events);
    expect(on).toHaveLength(8);
    on.forEach((e, k) => {
      expect(e.frame).toBe(k * STEP);
      expect(e.pitch).toBe(36);
    });
    // gate at 50 %: each note ends halfway through its step
    const offs = events.filter(e => e.kind === 'off');
    expect(offs[0].frame).toBe(STEP / 2);
    expect(events.at(-1)!.kind).toBe('off');
  });

  it('a held note arriving a moment after the boundary plays the first step anyway', () => {
    const events = play({ seqDensity: 100, seqRange: 0 }, [{ pitch: 40, on: 300, off: 4 * STEP }], 6 * STEP);
    expect(ons(events)[0].frame).toBe(300);
    expect(ons(events)[0].pitch).toBe(40);
    expect(ons(events)).toHaveLength(4);
  });

  it('turned on a block after its note (the clip turning it on) it takes that note and plays the first step', () => {
    const rec = new Recorder();
    const seq = new StepSequencer(rec, SR);
    seq.setTempo(BPM);
    seq.setParams(resolveParams(ANALOG, {}));
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    for (let f = 0; f < 4 * STEP; f += BLOCK) {
      rec.block = rec.frame = f;
      if (f === BLOCK) seq.setParams(resolveParams(ANALOG, { seqOn: 1, seqDensity: 100, seqRange: 0 }));
      seq.setTransport({ beat: f / BEAT, bpm: BPM, beatsPerBar: 4 });
      if (f === 0) seq.noteOn(1, 41, 100);
      seq.render(l, r, 0, BLOCK);
    }
    // the note passed directly turns off; the first step plays right away, the others on the sixteenths
    expect(rec.events[0]).toMatchObject({ kind: 'on', id: 1, pitch: 41 });
    expect(rec.events[1]).toMatchObject({ kind: 'off', id: 1, frame: BLOCK });
    const steps = ons(rec.events).slice(1).filter(e => e.frame < 4 * STEP);
    expect(steps.map(e => e.frame)).toEqual([BLOCK, STEP, 2 * STEP, 3 * STEP]);
    expect(steps.every(e => e.pitch === 41)).toBe(true);
  });

  it('with higher density steps are added, the existing ones stay', () => {
    const s = (density: number) => seqSettings(resolveParams(ANALOG, { seqDensity: density }));
    const hits = (density: number) => Array.from({ length: 16 }, (_, i) => seqStep(s(density), 5, i, i / 4).hit);
    let prev = hits(0);
    expect(prev.every(h => !h)).toBe(true);
    for (const d of [20, 40, 60, 80, 100]) {
      const now = hits(d);
      prev.forEach((h, i) => { if (h) expect(now[i]).toBe(true); });
      prev = now;
    }
    expect(prev.every(Boolean)).toBe(true);
    // with little density first the eighth's offbeats come in (between one kick and the next)
    const few = Array.from({ length: 64 }, (_, pattern) => Array.from({ length: 16 }, (_, i) => (seqStep(s(25), pattern, i, i / 4).hit ? [i % 4] : [])).flat()).flat();
    expect(few.length).toBeGreaterThan(64);
    expect(few.filter(p => p === 2).length / few.length).toBeGreaterThan(0.75);
  });

  it('the pitch widens the scale in order: at 0 only the root', () => {
    const at = (range: number) => seqSettings(resolveParams(ANALOG, { seqRange: range, seqScale: SEQ_SCALE['Phrygian and tritone'] }));
    const intervals = (range: number) => new Set(Array.from({ length: 32 }, (_, i) => seqStep(at(range), 9, i, i / 4).interval));
    expect([...intervals(0)]).toEqual([0]);
    const scale = SEQ_SCALES[SEQ_SCALE['Phrygian and tritone']][1];
    for (const i of intervals(100)) expect(scale).toContain(i);
    expect(intervals(100).size).toBeGreaterThan(4);
  });

  it('"Leave to the kick": no step on the beat', () => {
    const events = play({ seqDensity: 100, seqKick: 1 }, [{ pitch: 36, on: 0, off: 16 * STEP }], 16 * STEP);
    expect(ons(events).length).toBe(12);
    for (const e of ons(events)) expect(e.frame % BEAT).not.toBe(0);
  });

  it('the slide turns on the new note before turning off the previous one (the 303\'s legato)', () => {
    const events = play({ seqDensity: 100, seqSlide: 100, seqRange: 100, seqPattern: 3 }, [{ pitch: 36, on: 0, off: 4 * STEP }], 4 * STEP);
    const second = events.findIndex((e, i) => i > 0 && e.kind === 'on');
    expect(events[second + 1]).toMatchObject({ kind: 'off', id: events[0].id, frame: STEP });
  });

  it('a new pattern comes in at the start of the loop', () => {
    const rec = new Recorder();
    const seq = new StepSequencer(rec, SR);
    const base = { seqOn: 1, seqDensity: 100, seqRange: 100, seqLength: 16, seqPattern: 1 };
    seq.setTempo(BPM);
    seq.setParams(resolveParams(ANALOG, base));
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    seq.noteOn(1, 36, 100);
    for (let f = 0; f < 32 * STEP; f += BLOCK) {
      // the pattern changes halfway through the first loop
      if (f === 8 * STEP) seq.setParams(resolveParams(ANALOG, { ...base, seqPattern: 2 }));
      rec.block = rec.frame = f;
      seq.setTransport({ beat: f / BEAT, bpm: BPM, beatsPerBar: 4 });
      seq.render(l, r, 0, BLOCK);
    }
    const pitches = ons(rec.events).map(e => e.pitch! - 36);
    const s = seqSettings(resolveParams(ANALOG, base));
    const expected = (pattern: number) => Array.from({ length: 16 }, (_, i) => seqStep(s, pattern, i, i / 4).interval);
    expect(pitches.slice(0, 16)).toEqual(expected(1));
    expect(pitches.slice(16, 32)).toEqual(expected(2));
  });

  it('with the transport stopped, it\'s silent; a jump restarts from there', () => {
    const events = play({ seqDensity: 100, seqRange: 0 }, [{ pitch: 36, on: 8 * STEP, off: 40 * STEP }], 20 * STEP, f => (f < 8 * STEP ? null : { beat: 100 + (f - 8 * STEP) / BEAT, bpm: BPM, beatsPerBar: 4 }));
    // from beat 100 the steps fall on the sixteenths again
    const on = ons(events).filter(e => e.frame < 20 * STEP);
    expect(on[0].frame).toBe(8 * STEP);
    expect(on).toHaveLength(12);
    on.forEach((e, k) => expect(e.frame).toBe((8 + k) * STEP));
  });

  it('when stopped a held note makes it run, from the first step and while it\'s held', () => {
    const events = play({ seqDensity: 100, seqRange: 0 }, [{ pitch: 36, on: 3 * STEP, off: 7 * STEP }], 12 * STEP, () => null);
    const on = ons(events);
    expect(on.map(e => e.frame)).toEqual([3, 4, 5, 6].map(k => k * STEP));
    expect(new Set(on.map(e => e.pitch))).toEqual(new Set([36]));
    expect(events.filter(e => e.kind === 'off')).toHaveLength(on.length);
  });

  it("one note after the other, when stopped, it restarts each time from the first step", () => {
    const events = play({ seqDensity: 100, seqRange: 0 }, [{ pitch: 36, on: 0, off: 2 * STEP }, { pitch: 40, on: 5 * STEP + 100, off: 6 * STEP + 100 }], 10 * STEP, () => null);
    expect(ons(events).map(e => e.frame)).toEqual([0, STEP, 5 * STEP + 100]);
  });

  it('the transport starting with a held note picks up the grid', () => {
    const events = play({ seqDensity: 100, seqRange: 0 }, [{ pitch: 36, on: 0, off: 12 * STEP }], 12 * STEP, f => (f < 4 * STEP + 7 ? null : { beat: (f - 4 * STEP) / BEAT, bpm: BPM, beatsPerBar: 4 }));
    const after = ons(events).filter(e => e.frame >= 5 * STEP);
    after.forEach((e, k) => expect(e.frame).toBe((5 + k) * STEP));
    expect(after).toHaveLength(7);
  });

  it('the rates: eighths, sixteenths, triplets, thirty-seconds', () => {
    for (const [rate, count] of [['1/8', 4], ['1/16', 8], ['1/16T', 12], ['1/32', 16]] as const) {
      const events = play({ seqDensity: 100, seqRate: SEQ_RATE[rate] }, [{ pitch: 36, on: 0, off: 2 * BEAT }], 2 * BEAT);
      expect(ons(events), rate).toHaveLength(count);
    }
  });

  it('Analog and Neuro have the sequencer, off: the saved projects play as before', () => {
    for (const type of [ANALOG, NEURO]) {
      expect(resolveParams(type, {}).seqOn).toBe(0);
      const core = INSTRUMENT_CORES[type.type](SR);
      expect(core).toBeInstanceOf(StepSequencer);
    }
  });

  it('with a real Analog it plays: there\'s signal where the steps are', () => {
    const core = INSTRUMENT_CORES.analog(SR) as StepSequencer;
    core.setTempo(BPM);
    core.setParams(resolveParams(ANALOG, { seqOn: 1, seqDensity: 100, seqRange: 0, seqGate: 50, voiceMode: 2 }));
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    let energy = 0;
    core.noteOn(1, 45, 100);
    for (let f = 0; f < 2 * BEAT; f += BLOCK) {
      l.fill(0);
      r.fill(0);
      core.setTransport({ beat: f / BEAT, bpm: BPM, beatsPerBar: 4 });
      core.render(l, r, 0, BLOCK);
      for (let i = 0; i < BLOCK; i++) energy += l[i] * l[i];
    }
    expect(energy).toBeGreaterThan(1);
  });
});
