import { describe, expect, it } from 'vitest';
import { EnvelopeFollower } from '../../src/devices/dsp/envelope-follower';
import { cycleRandom, LFO_SHAPE, LfoClock, lfoAt } from '../../src/devices/dsp/lfo';
import { FILTER_TYPE, MultimodeFilter } from '../../src/devices/dsp/multimode-filter';

const SR = 48000;
const bar = { bpm: 120, beatsPerBar: 4 };

describe('LFO: the waves', () => {
  it('sine and triangle start from 0 and rise, the saws and the square from the extremes', () => {
    expect(lfoAt(LFO_SHAPE.sine, 0.25)).toBeCloseTo(1, 12);
    expect(lfoAt(LFO_SHAPE.sine, 3.75)).toBeCloseTo(-1, 12);
    expect(lfoAt(LFO_SHAPE.triangle, 0)).toBe(0);
    expect(lfoAt(LFO_SHAPE.triangle, 0.25)).toBe(1);
    expect(lfoAt(LFO_SHAPE.triangle, 0.75)).toBe(-1);
    expect(lfoAt(LFO_SHAPE.sawDown, 2)).toBe(1);
    expect(lfoAt(LFO_SHAPE.sawUp, 2)).toBe(-1);
    expect(lfoAt(LFO_SHAPE.square, 0.1)).toBe(1);
    expect(lfoAt(LFO_SHAPE.square, 0.6)).toBe(-1);
  });

  it('S&H: one value per cycle, always the same for the same cycle (also backwards in time)', () => {
    const values = Array.from({ length: 64 }, (_, k) => lfoAt(LFO_SHAPE.sampleHold, k + 0.3));
    for (let k = 0; k < 64; k++) {
      expect(lfoAt(LFO_SHAPE.sampleHold, k + 0.9)).toBe(values[k]);
      expect(Math.abs(values[k])).toBeLessThanOrEqual(1);
    }
    expect(new Set(values).size).toBe(64);
    expect(lfoAt(LFO_SHAPE.sampleHold, -2.5)).toBe(cycleRandom(-3));
    // another seed, other values
    expect(lfoAt(LFO_SHAPE.sampleHold, 5.5, 7)).not.toBe(values[5]);
  });

  it('smooth S&H: it glides from one value to the next without jumps between one cycle and the next', () => {
    for (let k = 1; k < 20; k++) {
      expect(lfoAt(LFO_SHAPE.smoothRandom, k - 1e-9)).toBeCloseTo(lfoAt(LFO_SHAPE.smoothRandom, k), 6);
      expect(lfoAt(LFO_SHAPE.smoothRandom, k + 1 - 1e-9)).toBeCloseTo(lfoAt(LFO_SHAPE.sampleHold, k), 6);
    }
  });

  it('the random values stay in −1..1 and average zero', () => {
    let sum = 0;
    for (let k = 0; k < 10000; k++) {
      const r = cycleRandom(k);
      expect(r).toBeGreaterThanOrEqual(-1);
      expect(r).toBeLessThan(1);
      sum += r;
    }
    expect(Math.abs(sum / 10000)).toBeLessThan(0.03);
  });
});

describe('LFO: the clock', () => {
  it('synced, with the transport running, the position comes from the bar: a 1/4 cycle starts on the quarter', () => {
    const clock = new LfoClock(SR);
    clock.start({ beats: 1, hz: 0 }, { beat: 2.25, ...bar }, 120);
    expect(clock.cycles).toBeCloseTo(2.25, 12);
    for (let i = 0; i < 6000; i++) clock.next(); // a sixteenth at 120 BPM
    expect(clock.cycles).toBeCloseTo(2.5, 9);
  });

  it('after a jump it goes back to the same point of the piece, whatever happened before', () => {
    const a = new LfoClock(SR), b = new LfoClock(SR);
    a.start({ beats: 2, hz: 0 }, { beat: 0, ...bar }, 120);
    for (let i = 0; i < 100000; i++) a.next();
    a.start({ beats: 2, hz: 0 }, { beat: 9, ...bar }, 120);
    b.start({ beats: 2, hz: 0 }, { beat: 9, ...bar }, 120);
    expect(a.cycles).toBe(b.cycles);
  });

  it('when stopped it runs free at the project\'s tempo, without jumps between one block and the next', () => {
    const clock = new LfoClock(SR);
    for (let block = 0; block < 375; block++) { // 1 s in blocks of 128
      clock.start({ beats: 1, hz: 0 }, null, 120);
      for (let i = 0; i < 128; i++) clock.next();
    }
    expect(clock.cycles).toBeCloseTo(2, 9); // 1/4 at 120 BPM: 2 cycles per second
  });

  it('in Hz it doesn\'t look at the transport', () => {
    const clock = new LfoClock(SR);
    clock.start({ beats: null, hz: 3 }, { beat: 17, ...bar }, 120);
    expect(clock.cycles).toBe(0);
    for (let i = 0; i < SR; i++) clock.next();
    expect(clock.cycles).toBeCloseTo(3, 9);
  });
});

/** How much (in dB) of a sine at the given frequency passes, at steady state. */
function gainDb(filter: MultimodeFilter, hz: number): number {
  let inSum = 0, outSum = 0;
  for (let i = 0; i < SR / 2; i++) {
    const x = Math.sin((2 * Math.PI * hz * i) / SR), y = filter.process(x);
    if (i >= SR / 4) {
      inSum += x * x;
      outSum += y * y;
    }
  }
  return 10 * Math.log10(outSum / inSum);
}

const filter = (cutoff: number, type: number, poles: 2 | 4 = 2, resonance = 0) => {
  const f = new MultimodeFilter(SR);
  f.set(cutoff, resonance, type, poles);
  return f;
};

describe('Multimode filter', () => {
  it('low-pass: −3 dB at the cutoff, then 12 or 24 dB per octave', () => {
    expect(gainDb(filter(1000, FILTER_TYPE.lowPass), 100)).toBeCloseTo(0, 1);
    expect(gainDb(filter(1000, FILTER_TYPE.lowPass), 1000)).toBeCloseTo(-3, 0);
    expect(gainDb(filter(1000, FILTER_TYPE.lowPass, 4), 1000)).toBeCloseTo(-3, 0);
    expect(gainDb(filter(1000, FILTER_TYPE.lowPass), 4000)).toBeLessThan(-22);
    expect(gainDb(filter(1000, FILTER_TYPE.lowPass, 4), 4000)).toBeLessThan(-45);
  });

  it('high-pass: the mirror', () => {
    expect(gainDb(filter(1000, FILTER_TYPE.highPass), 10000)).toBeCloseTo(0, 1);
    expect(gainDb(filter(1000, FILTER_TYPE.highPass), 250)).toBeLessThan(-22);
    expect(gainDb(filter(1000, FILTER_TYPE.highPass, 4), 250)).toBeLessThan(-45);
  });

  it('band-pass: everything at the centre, little at the sides; notch: the opposite', () => {
    expect(gainDb(filter(1000, FILTER_TYPE.bandPass), 1000)).toBeCloseTo(0, 1);
    expect(gainDb(filter(1000, FILTER_TYPE.bandPass, 4), 1000)).toBeCloseTo(0, 1);
    expect(gainDb(filter(1000, FILTER_TYPE.bandPass), 8000)).toBeLessThan(-15);
    expect(gainDb(filter(1000, FILTER_TYPE.notch), 1000)).toBeLessThan(-30);
    expect(gainDb(filter(1000, FILTER_TYPE.notch), 8000)).toBeCloseTo(0, 0);
  });

  it('the resonance raises the peak at the cutoff', () => {
    const flat = gainDb(filter(1000, FILTER_TYPE.lowPass, 2, 0), 1000);
    const half = gainDb(filter(1000, FILTER_TYPE.lowPass, 2, 0.5), 1000);
    const full = gainDb(filter(1000, FILTER_TYPE.lowPass, 4, 1), 1000);
    expect(half).toBeGreaterThan(flat + 3);
    expect(full).toBeGreaterThan(20);
  });

  it('with the cutoff jumping continuously it stays stable', () => {
    const f = new MultimodeFilter(SR);
    let peak = 0;
    for (let i = 0; i < SR; i++) {
      if (i % 8 === 0) f.set(20 * Math.pow(1000, cycleRandom(i) * 0.5 + 0.5), 0.9, FILTER_TYPE.lowPass, 4);
      const y = f.process(Math.sin(i * 0.05));
      expect(Number.isFinite(y)).toBe(true);
      peak = Math.max(peak, Math.abs(y));
    }
    expect(peak).toBeLessThan(100);
  });
});

describe('Envelope follower', () => {
  it('rises with the attack and falls with the release', () => {
    const env = new EnvelopeFollower(SR);
    env.set(0.01, 0.1);
    for (let i = 0; i < SR / 100; i++) env.process(i % 2 ? -1 : 1);
    expect(env.value).toBeCloseTo(1 - Math.exp(-1), 2);
    for (let i = 0; i < SR / 10; i++) env.process(0);
    expect(env.value).toBeCloseTo((1 - Math.exp(-1)) * Math.exp(-1), 2);
  });
});
