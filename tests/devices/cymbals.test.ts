import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import { CYMBALS, PIECES, pieceParam, pieceSlot, SOURCE } from '../../src/devices/instruments/cymbals/cymbals';
import { CymbalsCore } from '../../src/devices/instruments/cymbals/cymbals-core';
import { instrumentType } from '../../src/devices/registry';
import { INSTRUMENT_CORES } from '../../src/devices/worklet/cores';

const SR = 48000;
const at = (s: number) => Math.round(s * SR);
const [CLOSED, PEDAL, OPEN, CRASH, RIDE, BELL] = [0, 1, 2, 3, 4, 5];

/** The instrument with these parameters (no velocity or variation, volume at 0 dB). */
function make(params: Record<string, number> = {}) {
  const core = new CymbalsCore(SR);
  core.setParams(resolveParams(CYMBALS, { velocity: 0, variation: 0, volume: 0, ...params }));
  return core;
}

/** Plays `notes` ([note, seconds]) and returns `seconds` of sound. */
function play(core: CymbalsCore, notes: readonly (readonly [number, number])[], seconds: number) {
  const n = at(seconds), left = new Float32Array(n), right = new Float32Array(n);
  const events = [...notes].sort((a, b) => a[1] - b[1]);
  let f = 0;
  for (const [pitch, time] of [...events, [-1, seconds] as const]) {
    const until = Math.min(n, at(time));
    for (; f < until; f += Math.min(128, until - f)) core.render(left, right, f, Math.min(until, f + 128));
    if (pitch >= 0) core.noteOn(1, pitch, 127);
  }
  return { left, right };
}

const rms = (x: Float32Array, from: number, to: number) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
};
const peak = (x: Float32Array) => x.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
const zeroCrossHz = (x: Float32Array, from: number, to: number) => {
  let n = 0;
  for (let i = from + 1; i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return (n * SR) / (to - from);
};
const note = (i: number) => PIECES[i].note;

describe('Hats and Cymbals: description', () => {
  it('six pieces on the General MIDI notes, with their names; it has its engine', () => {
    expect(instrumentType('cymbals')).toBe(CYMBALS);
    expect(INSTRUMENT_CORES.cymbals(SR)).toBeInstanceOf(CymbalsCore);
    expect(PIECES.map(p => p.note)).toEqual([42, 44, 46, 49, 51, 53]);
    expect(CYMBALS.noteNames!({}).get(46)).toBe('Open hat');
    expect(pieceParam(RIDE, 'bell')).toBe('rideBell');
  });

  it('each preset plays each piece, without exploding', () => {
    for (const preset of CYMBALS.presets) {
      const core = make({ ...preset.params, variation: preset.params.variation ?? 20 });
      for (const p of PIECES) {
        const { left, right } = play(core, [[p.note, 0]], 0.3);
        expect(left.every(Number.isFinite) && right.every(Number.isFinite), `${preset.name} ${p.label}`).toBe(true);
        expect(peak(left) + peak(right), `${preset.name} ${p.label}`).toBeGreaterThan(0.02);
        expect(peak(left), `${preset.name} ${p.label}`).toBeLessThan(2);
        core.silence();
        play(core, [], 0.02);
      }
    }
  });
});

describe('Hat and Cymbals: the sound', () => {
  it('high and bright; more brightness, higher', () => {
    const dull = play(make({ [pieceParam(CLOSED, 'tone')]: 20 }), [[note(CLOSED), 0]], 0.05).left;
    const bright = play(make({ [pieceParam(CLOSED, 'tone')]: 90 }), [[note(CLOSED), 0]], 0.05).left;
    expect(zeroCrossHz(dull, 0, at(0.04))).toBeGreaterThan(2000);
    expect(zeroCrossHz(bright, 0, at(0.04))).toBeGreaterThan(zeroCrossHz(dull, 0, at(0.04)));
  });

  it('the decay: the closed is short, the open and the cymbals last', () => {
    const closed = play(make(), [[note(CLOSED), 0]], 0.5).left;
    const open = play(make(), [[note(OPEN), 0]], 0.5).left;
    const crash = play(make(), [[note(CRASH), 0]], 1.5).left;
    expect(rms(closed, at(0.2), at(0.3))).toBeLessThan(1e-4);
    expect(rms(open, at(0.2), at(0.3))).toBeGreaterThan(0.005);
    expect(rms(crash, at(1), at(1.5))).toBeGreaterThan(0.002);
  });

  it('the closed and the pedal stop the open, in a few milliseconds', () => {
    for (const stop of [CLOSED, PEDAL]) {
      // the stopping hit is very short: afterwards, only the open would be heard
      const { left } = play(make({ [pieceParam(stop, 'level')]: -36, [pieceParam(stop, 'decay')]: 0.01 }), [[note(OPEN), 0], [note(stop), 0.1]], 0.2);
      expect(rms(left, at(0.05), at(0.09)), PIECES[stop].label).toBeGreaterThan(0.01);
      expect(rms(left, at(0.12), at(0.2)), PIECES[stop].label).toBeLessThan(1e-4);
    }
    // the crash doesn't
    const { left } = play(make({ [pieceParam(CLOSED, 'level')]: -36 }), [[note(CRASH), 0], [note(CLOSED), 0.1]], 0.2);
    expect(rms(left, at(0.12), at(0.2))).toBeGreaterThan(0.01);
  });

  it('the hits of the same piece overlap two by two: the third fades the first', () => {
    const one = play(make(), [[note(CRASH), 0]], 0.4).left;
    const two = play(make(), [[note(CRASH), 0], [note(CRASH), 0.2]], 0.4).left;
    expect(rms(two, at(0.25), at(0.4))).toBeGreaterThan(rms(one, at(0.25), at(0.4)) * 1.2);
    const { left } = play(make(), [[note(CRASH), 0], [note(CRASH), 0.1], [note(CRASH), 0.2]], 0.4);
    expect(left.every(Number.isFinite)).toBe(true);
  });

  it('the bell: tuned partials heard over the ride\'s noise', () => {
    const quiet = { [pieceParam(BELL, 'noise')]: 0, [pieceParam(BELL, 'tone')]: 0, [pieceParam(BELL, 'level')]: 0 };
    const none = play(make({ ...quiet, [pieceParam(BELL, 'bell')]: 0 }), [[note(BELL), 0]], 0.2).left;
    const bell = play(make({ ...quiet, [pieceParam(BELL, 'bell')]: 100 }), [[note(BELL), 0]], 0.2).left;
    expect(rms(bell, at(0.05), at(0.2))).toBeGreaterThan(rms(none, at(0.05), at(0.2)) * 1.5);
    expect(zeroCrossHz(bell, at(0.05), at(0.2))).toBeLessThan(zeroCrossHz(none, at(0.05), at(0.2)));
  });

  it('width: at zero the noise is in the centre, open the two channels separate', () => {
    const piece = { [pieceParam(CRASH, 'pan')]: 0 };
    const mono = play(make({ ...piece, width: 0 }), [[note(CRASH), 0]], 0.2);
    const wide = play(make({ ...piece, width: 100 }), [[note(CRASH), 0]], 0.2);
    const diff = (x: { left: Float32Array; right: Float32Array }) => rms(x.left.map((v, i) => v - x.right[i]), 0, at(0.2));
    expect(diff(mono)).toBeLessThan(1e-6);
    expect(diff(wide)).toBeGreaterThan(0.01);
  });

  it('a piece can play a sample, with its pitch', () => {
    const tone = Float32Array.from({ length: SR }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / SR) * 0.8);
    const core = make({ [pieceParam(RIDE, 'source')]: SOURCE.sample, [pieceParam(RIDE, 'tone')]: 50, [pieceParam(RIDE, 'level')]: 0, [pieceParam(RIDE, 'pan')]: 0 });
    expect(peak(play(core, [[note(RIDE), 0]], 0.1).left)).toBe(0); // without sample it's silent
    core.setSample(pieceSlot(RIDE), { sampleRate: SR, channels: [tone] });
    expect(zeroCrossHz(play(core, [[note(RIDE), 0]], 0.3).left, at(0.01), at(0.3))).toBeCloseTo(1000, -1);
    core.setParams(resolveParams(CYMBALS, { velocity: 0, variation: 0, volume: 0, [pieceParam(RIDE, 'source')]: SOURCE.sample,
      [pieceParam(RIDE, 'tone')]: 50, [pieceParam(RIDE, 'tune')]: 12 }));
    core.silence(); // the previous hit (the ride lasts) fades out
    play(core, [], 0.02);
    expect(zeroCrossHz(play(core, [[note(RIDE), 0]], 0.3).left, at(0.01), at(0.3))).toBeCloseTo(2000, -1);
  });

  it('the variation changes each hit a little; without, the hits are equal', () => {
    const hits = (variation: number) => {
      // without noise (which changes at every hit anyway)
      const core = make({ variation, [pieceParam(CLOSED, 'noise')]: 0 });
      return [0, 1].map(() => {
        core.silence();
        play(core, [], 0.01);
        return rms(play(core, [[note(CLOSED), 0]], 0.03).left, 0, at(0.03));
      });
    };
    const [a, b] = hits(0);
    expect(a).toBeCloseTo(b, 6);
    const [c, d] = hits(100);
    expect(Math.abs(c - d)).toBeGreaterThan(1e-4);
  });

  it('the other notes don\'t play', () => {
    expect(peak(play(make(), [[60, 0]], 0.1).left)).toBe(0);
  });
});
