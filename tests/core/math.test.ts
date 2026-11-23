import { describe, expect, it } from 'vitest';
import { clamp01, clamp11, countOf, pickAbove, signGlyph } from '../../src/core/math';

describe('numeric helpers', () => {
  it('clamp01 and clamp11 hold the value inside their range', () => {
    expect([clamp01(-3), clamp01(0.4), clamp01(7)]).toEqual([0, 0.4, 1]);
    expect([clamp11(-3), clamp11(-0.4), clamp11(7)]).toEqual([-1, -0.4, 1]);
  });

  it('signGlyph prints +, the typographic minus, or nothing for zero', () => {
    expect(signGlyph(2)).toBe('+');
    expect(signGlyph(-2)).toBe('−');
    expect(signGlyph(0)).toBe('');
  });

  it('pickAbove takes the first threshold the value exceeds, else the fallback', () => {
    const steps = [[100, 1], [50, 2], [10, 3]] as const;
    expect(pickAbove(120, steps, 9)).toBe(1);
    expect(pickAbove(60, steps, 9)).toBe(2);
    expect(pickAbove(11, steps, 9)).toBe(3);
    // the threshold itself isn't exceeded
    expect(pickAbove(10, steps, 9)).toBe(9);
    expect(pickAbove(5, [], 4)).toBe(4);
  });

  it('countOf pluralises everything but one', () => {
    expect(countOf(1, 'curve')).toBe('1 curve');
    expect(countOf(0, 'curve')).toBe('0 curves');
    expect(countOf(3, 'curve')).toBe('3 curves');
  });
});
