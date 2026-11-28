import { describe, expect, it } from 'vitest';
import { MOD_SCALES } from '../../src/model/envelope';
import { overRounds, thinned, touched } from '../../src/model/move-take';

const p = (beat: number, value: number) => ({ beat, value });

describe('recorded movements: points', () => {
  it('thinned: the first and the last always, between them those that move enough or after a while', () => {
    const samples = [p(0, 0), p(0.01, 0.001), p(0.02, 0.05), p(0.03, 0.0505), p(0.4, 0.051), p(0.5, 0.06)];
    expect(thinned(samples, MOD_SCALES.param)).toEqual([p(0, 0), p(0.02, 0.05), p(0.4, 0.051), p(0.5, 0.06)]);
    expect(thinned([p(1, 0.2)], MOD_SCALES.param)).toEqual([p(1, 0.2)]);
    expect(thinned([], MOD_SCALES.param)).toEqual([]);
  });

  it('thinned on/off: each change is a step', () => {
    const samples = [p(0, 1), p(1, 1), p(2, 0), p(3, 0), p(3.5, 1)];
    expect(thinned(samples, MOD_SCALES.onoff)).toEqual([p(0, 1), p(2, 1), p(2, 0), p(3.5, 0), p(3.5, 1)]);
  });

  it('touched: with no curve before, the knob\'s value up to the gesture, then the gesture, then it holds', () => {
    expect(touched([], [p(1, 0.2), p(2, 0.5)], 0)).toEqual([p(1, 0), p(1, 0.2), p(2, 0.5)]);
    // a gesture starting from where the knob is needs no step
    expect(touched([], [p(1, 0), p(2, 0.5)], 0)).toEqual([p(1, 0), p(2, 0.5)]);
    expect(touched([p(0, 0.1)], [], 0)).toEqual([p(0, 0.1)]);
  });

  it('touched over a curve: before the gesture it stays, its stretch is replaced, after it a step back to it', () => {
    const old = [p(0, 0), p(2, 0.4), p(4, 0)];
    expect(touched(old, [p(1, -0.5), p(3, -0.5)], 0)).toEqual([p(0, 0), p(1, 0.2), p(1, -0.5), p(3, -0.5), p(3, 0.2), p(4, 0)]);
    // ending where the old curve is: no step
    expect(touched(old, [p(1, 0.2), p(3, 0.2)], 0)).toEqual([p(0, 0), p(1, 0.2), p(3, 0.2), p(4, 0)]);
  });

  it('overRounds: in one run it is touched over nothing; when the beat goes back (a loop round) the later round wins', () => {
    const one = [p(1, 0.2), p(2, 0.4)];
    expect(overRounds(one, MOD_SCALES.param, 0)).toEqual(touched([], thinned(one, MOD_SCALES.param), 0));
    // first round 1 → 3, second round over 2 → 2.5 only
    const rounds = [p(1, 0.2), p(3, 0.6), p(2, -0.5), p(2.5, -0.5)];
    expect(overRounds(rounds, MOD_SCALES.param, 0)).toEqual([p(1, 0), p(1, 0.2), p(2, 0.4), p(2, -0.5), p(2.5, -0.5), p(2.5, 0.5), p(3, 0.6)]);
    expect(overRounds([], MOD_SCALES.param, 0)).toEqual([]);
  });
});
