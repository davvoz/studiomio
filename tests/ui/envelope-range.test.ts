import { describe, expect, it } from 'vitest';
import { MOD_SCALES } from '../../src/model/envelope';
import { clearRange, paintStep, placeShape, replaceRange, rescalePoints, sliceRange } from '../../src/ui/envelopes/envelope-lane';
import { shapePoints, type ShapeChoice } from '../../src/ui/envelopes/envelope-shapes';

const pts = (...p: [number, number][]) => p.map(([beat, value]) => ({ beat, value }));

describe('ranges of a modulation curve', () => {
  const ramp = pts([0, 0], [4, 1]);

  it('a range is taken with its edges, relative to its start', () => {
    expect(sliceRange(ramp, 1, 3, 0)).toEqual(pts([0, 0.25], [2, 0.75]));
    // the points inside stay
    expect(sliceRange(pts([0, 0], [2, 1], [4, 0]), 1, 3, 0)).toEqual(pts([0, 0.5], [1, 1], [2, 0.5]));
  });

  it('on a step the range takes the right value on each side', () => {
    const step = pts([0, 0], [2, 0], [2, 1], [4, 1], [4, 0]);
    expect(sliceRange(step, 2, 4, 0)).toEqual(pts([0, 1], [2, 1]));
  });

  it('replaceRange keeps the curve outside the range, jumping at the edges', () => {
    const out = replaceRange(ramp, 1, 3, pts([1, 1], [3, 1]), 0);
    expect(out).toEqual(pts([0, 0], [1, 0.25], [1, 1], [3, 1], [3, 0.75], [4, 1]));
  });

  it('on an empty curve there are only the pasted points', () => {
    expect(replaceRange([], 4, 8, pts([4, 0.1], [6, 0.9], [8, 0.2]), 0)).toEqual(pts([4, 0.1], [6, 0.9], [8, 0.2]));
  });

  it('a step on an empty curve goes back to the neutral line at the end', () => {
    expect(paintStep([], 2, 3, 0.5, 0)).toEqual(pts([2, 0.5], [3, 0.5], [3, 0]));
  });

  it('clearing a range brings it back to neutral; if nothing else remains the curve disappears', () => {
    expect(clearRange(ramp, 1, 3, 0)).toEqual(pts([0, 0], [1, 0.25], [1, 0], [3, 0], [3, 0.75], [4, 1]));
    expect(clearRange(pts([1, 0.5], [3, 0.5]), 0, 4, 0)).toEqual([]);
  });

  it('copying and pasting at another point gives the same shape again', () => {
    const shape = pts([0, 0], [1, 1], [2, 0]);
    const copied = sliceRange(shape, 0, 2, 0).map(p => ({ beat: p.beat + 8, value: p.value }));
    expect(replaceRange(shape, 8, 10, copied, 0)).toEqual([...shape, ...pts([8, 0], [9, 1], [10, 0])]);
  });

  it('on another scale the neutral line stays neutral and the extremes go onto the extremes', () => {
    const { param, pan } = MOD_SCALES;
    expect(rescalePoints(pts([0, param.neutral], [1, param.max], [2, param.min]), param, pan))
      .toEqual(pts([0, pan.neutral], [1, pan.max], [2, pan.min]));
    expect(rescalePoints(ramp, param, param)).toEqual(ramp);
  });
});

describe('ready-made shapes', () => {
  const { param, volume, transpose } = MOD_SCALES;
  const choice = (over: Partial<ShapeChoice> = {}): ShapeChoice => ({ shape: 'rampUp', cycle: 0, depth: 1, invert: false, seed: 1, ...over });
  const values = (p: readonly { value: number }[]) => p.map(q => q.value);

  it('without a cycle it makes a single shape over the whole range', () => {
    expect(shapePoints(choice(), 4, 8, param)).toEqual(pts([4, -1], [8, 1]));
  });

  it('the cycle repeats, with the jump between one cycle and the next', () => {
    expect(shapePoints(choice({ cycle: 1 }), 0, 2, param)).toEqual(pts([0, -1], [1, 1], [1, -1], [2, 1]));
  });

  it('a cycle that doesn\'t fit is cut at the end of the range, on its line', () => {
    expect(shapePoints(choice({ cycle: 2 }), 0, 3, param)).toEqual(pts([0, -1], [2, 1], [2, -1], [3, 0]));
  });

  it('amplitude and direction stay around the neutral line', () => {
    expect(values(shapePoints(choice({ depth: 0.5 }), 0, 1, param))).toEqual([-0.5, 0.5]);
    expect(values(shapePoints(choice({ invert: true }), 0, 1, param))).toEqual([1, -1]);
  });

  it('on the volume it uses the part below the neutral, all of it', () => {
    expect(values(shapePoints(choice(), 0, 1, volume))).toEqual([0, 1]);
    expect(values(shapePoints(choice({ depth: 0.25 }), 0, 1, volume))).toEqual([0.75, 1]);
  });

  it('on the transposition it stays within an octave', () => {
    expect(values(shapePoints(choice(), 0, 1, transpose))).toEqual([-12, 12]);
  });

  it('the sine starts and returns to neutral, without jumps between the cycles', () => {
    const p = shapePoints(choice({ shape: 'sine', cycle: 1 }), 0, 2, param);
    expect(p[0].value).toBeCloseTo(0);
    expect(p[p.length - 1].value).toBeCloseTo(0);
    expect(Math.max(...values(p))).toBeCloseTo(1);
    for (let i = 1; i < p.length; i++) expect(Math.abs(p[i].value - p[i - 1].value)).toBeLessThan(0.5);
  });

  it('many repetitions don\'t make the points explode', () => {
    expect(shapePoints(choice({ shape: 'sine', cycle: 0.25 }), 0, 256, param).length).toBeLessThan(10000);
  });

  it('the random shapes depend on the seed and stay in the scale', () => {
    const a = shapePoints(choice({ shape: 'steps', cycle: 1, seed: 3 }), 0, 8, param);
    expect(shapePoints(choice({ shape: 'steps', cycle: 1, seed: 3 }), 0, 8, param)).toEqual(a);
    expect(shapePoints(choice({ shape: 'steps', cycle: 1, seed: 4 }), 0, 8, param)).not.toEqual(a);
    expect(values(a).every(v => v >= -1 && v <= 1)).toBe(true);
  });

  it('the smooth random doesn\'t jump between one cycle and the next', () => {
    const p = shapePoints(choice({ shape: 'drift', cycle: 1, seed: 3 }), 0, 4, param);
    for (let i = 1; i < p.length; i++) if (p[i].beat === p[i - 1].beat) expect(p[i].value).toBe(p[i - 1].value);
  });

  it('on an empty curve outside the range the neutral remains', () => {
    const out = placeShape([], 2, 4, pts([2, -1], [4, 1]), 0);
    expect(out).toEqual(pts([0, 0], [2, 0], [2, -1], [4, 1], [4, 0]));
  });

  it('on an existing curve it replaces only the range', () => {
    const out = placeShape(pts([0, 0.5], [8, 0.5]), 2, 4, pts([2, -1], [4, 1]), 0);
    expect(out).toEqual(pts([0, 0.5], [2, 0.5], [2, -1], [4, 1], [4, 0.5], [8, 0.5]));
  });

  it('putting a shape again in the same range leaves no trace of the first', () => {
    const once = placeShape([], 2, 4, pts([2, -1], [4, 1]), 0);
    expect(placeShape(once, 2, 4, pts([2, 1], [3, 1], [3, -1], [4, -1]), 0))
      .toEqual(placeShape([], 2, 4, pts([2, 1], [3, 1], [3, -1], [4, -1]), 0));
  });
});
