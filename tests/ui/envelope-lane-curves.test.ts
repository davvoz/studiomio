import { describe, expect, it, vi } from 'vitest';
import { MOD_SCALES } from '../../src/model/envelope';
import { BeatAxis } from '../../src/ui/clip-editor/clip-geometry';
import { clearRange, paintStep, rescalePoints, simplify, valueBefore, wheelTime } from '../../src/ui/envelopes/envelope-lane';

const pts = (...p: [number, number][]) => p.map(([beat, value]) => ({ beat, value }));

const wheel = (over: Partial<WheelEvent>) =>
  ({ deltaX: 0, deltaY: 0, ctrlKey: false, metaKey: false, preventDefault: vi.fn(), ...over }) as unknown as WheelEvent;

describe('the wheel on a lane', () => {
  it('scrolls the time by the wheel distance in beats and stops the page from scrolling', () => {
    const e = wheel({ deltaY: 80 });
    const out = wheelTime(e, 100, new BeatAxis(40, 2));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(out.startBeat).toBeCloseTo(4, 9);
    expect(out.pxPerBeat).toBe(40);
  });

  it('a horizontal wheel takes priority over the vertical one', () => {
    expect(wheelTime(wheel({ deltaX: 40, deltaY: 400 }), 0, new BeatAxis(40, 0)).startBeat).toBeCloseTo(1, 9);
  });

  it('Ctrl or Meta zooms around the pointer: wheel up zooms in, the beat under it stays', () => {
    const axis = new BeatAxis(40, 2);
    const up = wheelTime(wheel({ deltaY: -100, ctrlKey: true }), 200, axis);
    expect(up.pxPerBeat).toBeGreaterThan(40);
    expect(up.xToBeat(200)).toBeCloseTo(axis.xToBeat(200), 9);
    const down = wheelTime(wheel({ deltaY: 100, metaKey: true }), 200, axis);
    expect(down.pxPerBeat).toBeLessThan(40);
  });
});

describe('reading a curve', () => {
  const ramp = pts([0, 0], [4, 1]);

  it('valueBefore interpolates, takes the left value of a step and clamps at the ends', () => {
    expect(valueBefore([], 3, 0.5)).toBe(0.5);
    expect(valueBefore(ramp, 2, 0)).toBeCloseTo(0.5, 9);
    expect(valueBefore(ramp, -1, 0)).toBe(0);
    expect(valueBefore(ramp, 9, 0)).toBe(1);
    const step = pts([0, 0], [2, 0], [2, 1], [4, 1]);
    expect(valueBefore(step, 2, 0)).toBe(0);
    expect(valueBefore(step, 3, 0)).toBe(1);
  });

  it('simplify drops duplicates, points between equal values and a point shadowed on the same beat', () => {
    expect(simplify(pts([0, 1], [0, 1], [2, 1]))).toEqual(pts([0, 1], [2, 1]));
    expect(simplify(pts([0, 1], [1, 1], [2, 1], [3, 0]))).toEqual(pts([0, 1], [2, 1], [3, 0]));
    expect(simplify(pts([0, 0], [0, 1], [2, 1]))).toEqual(pts([0, 1], [2, 1]));
    expect(simplify([])).toEqual([]);
    expect(simplify(pts([1, 0.3]))).toEqual(pts([1, 0.3]));
  });

  it('paintStep draws a step into an empty curve and returns to neutral after it', () => {
    expect(paintStep([], 2, 4, 0.8, 0.5)).toEqual(pts([2, 0.8], [4, 0.8], [4, 0.5]));
  });
});

describe('clearing a range', () => {
  it('a curve fully inside the range disappears', () => {
    expect(clearRange(pts([1, 0.2], [2, 0.9]), 0, 4, 0)).toEqual([]);
  });

  it('outside the range the curve stays, inside it goes neutral', () => {
    const out = clearRange(pts([0, 1], [8, 1]), 2, 4, 0);
    expect(out).toEqual(pts([0, 1], [2, 1], [2, 0], [4, 0], [4, 1], [8, 1]));
  });

  it('a curve that is neutral everywhere else is removed too', () => {
    expect(clearRange(pts([0, 0], [2, 1], [4, 0], [8, 0]), 0, 4, 0)).toEqual([]);
  });
});

describe('moving a curve between scales', () => {
  it('the same scale is a copy', () => {
    const p = pts([0, 0.2]);
    const out = rescalePoints(p, MOD_SCALES.param, MOD_SCALES.param);
    expect(out).toEqual(p);
    expect(out).not.toBe(p);
  });

  it('neutral stays neutral and the extremes land on the extremes of the other scale', () => {
    const { param, volume, pan } = MOD_SCALES;
    const out = rescalePoints(pts([0, param.neutral], [1, param.max], [2, param.min]), param, volume);
    expect(out[0].value).toBeCloseTo(volume.neutral, 9);
    expect(out[1].value).toBeCloseTo(volume.max, 9);
    expect(out[2].value).toBeCloseTo(volume.min, 9);
    // halfway up the upper half stays halfway, and so below neutral
    const { transpose } = MOD_SCALES;
    expect(rescalePoints(pts([0, 24]), transpose, pan)[0].value).toBeCloseTo(0.5, 9);
    expect(rescalePoints(pts([0, -12]), transpose, pan)[0].value).toBeCloseTo(-0.25, 9);
    expect(rescalePoints(pts([0, 0.5]), volume, pan)[0].value).toBeCloseTo(-0.5, 9);
  });

  it('a scale with no room above or below does not divide by zero', () => {
    const flat = { min: 0, neutral: 0, max: 1 } as unknown as typeof MOD_SCALES.param;
    const out = rescalePoints(pts([0, 0.5], [1, -0.5]), flat, MOD_SCALES.param);
    expect(out.every(p => Number.isFinite(p.value))).toBe(true);
  });
});
