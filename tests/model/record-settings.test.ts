import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../../src/core/id';
import { Project } from '../../src/model/project';
import {
  checkRecordQuantize, compensationBeats, NO_RECORD_QUANTIZE, quantizeRecorded, quantizeStep, type RecordQuantize,
} from '../../src/model/record-settings';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { setRecordQuantize } from '../../src/store/edits';
import { setup } from '../helpers/fixtures';

const q = (over: Partial<RecordQuantize> = {}): RecordQuantize => ({ grid: '1/16', triplet: false, strength: 1, ends: false, ...over });
const note = (start: number, duration = 0.2) => ({ pitch: 60, velocity: 100, start, duration });
const take = { start: 0, end: 4, loops: true };

describe('record quantization', () => {
  it('the grid\'s step, ⅔ with triplets, none when off', () => {
    expect(quantizeStep(q({ grid: '1/4' }))).toBe(1);
    expect(quantizeStep(q({ grid: '1/32' }))).toBe(0.125);
    expect(quantizeStep(q({ grid: '1/8', triplet: true }))).toBeCloseTo(1 / 3, 12);
    expect(quantizeStep(NO_RECORD_QUANTIZE)).toBeNull();
  });

  it('off, a note stays as played', () => {
    const n = note(1.07);
    expect(quantizeRecorded(n, NO_RECORD_QUANTIZE, take)).toBe(n);
  });

  it('the start goes to the nearest line, with the strength part of the way; the end stays where it was', () => {
    expect(quantizeRecorded(note(1.3, 0.5), q(), take)).toEqual(note(1.25, 0.55));
    const half = quantizeRecorded(note(1.3, 0.5), q({ strength: 0.5 }), take);
    expect(half.start).toBeCloseTo(1.275, 12);
    expect(half.start + half.duration).toBeCloseTo(1.8, 12);
    expect(quantizeRecorded(note(1.3, 0.5), q({ strength: 0 }), take)).toEqual(note(1.3, 0.5));
  });

  it('with the ends: the end too, at least a step after the start', () => {
    expect(quantizeRecorded(note(1.3, 0.5), q({ ends: true }), take)).toEqual(note(1.25, 0.5));
    // a very short note lasts a step
    expect(quantizeRecorded(note(2.01, 0.02), q({ ends: true }), take)).toEqual(note(2, 0.25));
  });

  it('a note quantized onto the loop\'s end goes to its start; it never goes past the end', () => {
    const wrapped = quantizeRecorded(note(3.95, 0.1), q(), take);
    expect(wrapped.start).toBe(0);
    expect(wrapped.duration).toBeCloseTo(0.05, 12);
    const overdub = { start: 2, end: 6, loops: true };
    expect(quantizeRecorded(note(5.98, 0.02), q(), overdub).start).toBe(2);
    // a clip that doesn't loop: at its end, the shortest note
    const once = quantizeRecorded(note(3.99, 0.01), q({ grid: '1/4' }), { start: 0, end: 4, loops: false });
    expect(once.start).toBeCloseTo(4 - 1 / 64, 12);
    expect(once.duration).toBe(1 / 64);
    // held past the end: it stops there
    expect(quantizeRecorded(note(3.2, 2), q({ grid: '1/4' }), take)).toEqual(note(3, 1));
  });

  it('settings that can\'t be are refused', () => {
    expect(() => checkRecordQuantize(q({ grid: '1/5' }))).toThrow(RangeError);
    expect(() => checkRecordQuantize(q({ strength: 1.5 }))).toThrow(RangeError);
    expect(() => checkRecordQuantize(q({ strength: Number.NaN }))).toThrow(RangeError);
    expect(() => checkRecordQuantize(NO_RECORD_QUANTIZE)).not.toThrow();
  });

  it('the latency compensation: the device\'s seconds and the hand ms, in beats at the tempo', () => {
    expect(compensationBeats(0.02, 0, 120)).toBeCloseTo(0.04, 12);
    expect(compensationBeats(0.02, 30, 60)).toBeCloseTo(0.05, 12);
    expect(compensationBeats(Number.NaN, -10, 120)).toBeCloseTo(-0.02, 12);
  });
});

describe('record quantization in the project', () => {
  it('none by default; the edit sets it (one undo), the same again changes nothing', () => {
    const { store } = setup();
    expect(store.project.recordQuantize).toEqual(NO_RECORD_QUANTIZE);
    store.apply(setRecordQuantize(q()));
    expect(store.project.recordQuantize).toEqual(q());
    const p = store.project;
    store.apply(setRecordQuantize(q()));
    expect(store.project).toBe(p);
    store.undo();
    expect(store.project.recordQuantize).toEqual(NO_RECORD_QUANTIZE);
    expect(() => store.apply(setRecordQuantize(q({ strength: 2 })))).toThrow(RangeError);
  });

  it('is saved and read back; without it the file has no field', () => {
    const codec = new ProjectCodec();
    const empty = Project.empty('p', sequentialIds());
    expect(codec.encode(empty)).not.toHaveProperty('recordQuantize');
    const p = empty.withRecordQuantize(q({ grid: '1/8', triplet: true, strength: 0.6, ends: true }));
    const back = codec.parse(codec.stringify(p));
    expect(back.recordQuantize).toEqual(q({ grid: '1/8', triplet: true, strength: 0.6, ends: true }));
    // set back to none: the field goes
    expect(codec.encode(p.withRecordQuantize(NO_RECORD_QUANTIZE))).not.toHaveProperty('recordQuantize');
  });
});
