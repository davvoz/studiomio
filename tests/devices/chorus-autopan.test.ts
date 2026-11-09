import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import type { TransportPosition } from '../../src/devices/dsp/core';
import { LFO_SHAPE } from '../../src/devices/dsp/lfo';
import { AUTO_PAN, AUTO_PAN_SYNC } from '../../src/devices/effects/auto-pan/auto-pan';
import { AutoPanCore } from '../../src/devices/effects/auto-pan/auto-pan-core';
import { CHORUS, CHORUS_MODE, CHORUS_SYNC, MAX_DEPTH_MS } from '../../src/devices/effects/chorus/chorus';
import { ChorusCore } from '../../src/devices/effects/chorus/chorus-core';
import { TEMPO_RATE } from '../../src/devices/rates';

const SR = 48000, BLOCK = 128, BPM = 120;
const BPS = BPM / 60 / SR;
/** Samples in a quarter at 120 BPM. */
const BEAT = 24000;

type Transport = (frame: number) => TransportPosition | null;
const fromZero: Transport = f => ({ beat: f * BPS, bpm: BPM, beatsPerBar: 4 });

interface Core {
  setTempo(bpm: number): void;
  setTransport(t: TransportPosition | null): void;
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void;
}

/** Plays an effect in blocks; `after` receives the core after each block, with the sample it will restart from. */
function play<C extends Core>(core: C, o: {
  frames: number; left?: (n: number) => number; right?: (n: number) => number; transport?: Transport; after?: (core: C, frame: number) => void;
}): [Float32Array, Float32Array] {
  core.setTempo(BPM);
  const left = o.left ?? (() => 1), right = o.right ?? left, transport = o.transport ?? fromZero;
  const l = new Float32Array(o.frames), r = new Float32Array(o.frames);
  const inL = new Float32Array(BLOCK), inR = new Float32Array(BLOCK), outL = new Float32Array(BLOCK), outR = new Float32Array(BLOCK);
  for (let f = 0; f < o.frames; f += BLOCK) {
    for (let i = 0; i < BLOCK; i++) {
      inL[i] = left(f + i);
      inR[i] = right(f + i);
    }
    core.setTransport(transport(f));
    core.process(inL, inR, outL, outR, BLOCK);
    l.set(outL.subarray(0, Math.min(BLOCK, o.frames - f)), f);
    r.set(outR.subarray(0, Math.min(BLOCK, o.frames - f)), f);
    o.after?.(core, f + BLOCK);
  }
  return [l, r];
}

const chorus = (params: Record<string, number>) => {
  const core = new ChorusCore(SR);
  core.setParams(resolveParams(CHORUS, params));
  return core;
};
const autoPan = (params: Record<string, number>) => {
  const core = new AutoPanCore(SR);
  core.setParams(resolveParams(AUTO_PAN, params));
  return core;
};

const sine = (hz: number) => (n: number) => 0.5 * Math.sin((2 * Math.PI * hz * n) / SR);
const maxJump = (x: Float32Array) => x.reduce((m, y, n) => (n ? Math.max(m, Math.abs(y - x[n - 1])) : 0), 0);

describe('Chorus', () => {
  it('without depth it\'s the sound delayed exactly by the Delay', () => {
    const impulse = (n: number) => (n === 0 ? 1 : 0);
    const [l, r] = play(chorus({ depth: 0, delay: 10, mix: 100 }), { frames: 1000, left: impulse, right: () => 0 });
    expect(l[480]).toBeCloseTo(1, 6);
    expect(l.reduce((s, y) => s + Math.abs(y), 0)).toBeCloseTo(1, 6);
    expect(r.every(y => y === 0)).toBe(true); // the channels don't mix
  });

  it('Dry/Wet at 0: the sound passes as it is', () => {
    const [l] = play(chorus({ mix: 0 }), { frames: 2000, left: sine(440) });
    for (let n = 0; n < 2000; n += 37) expect(l[n]).toBeCloseTo(sine(440)(n), 6);
  });

  it('the delay wobbles by Depth around the Delay, synced and locked to the bar', () => {
    const delays = new Map<number, number>();
    const params = { mode: CHORUS_MODE.vibrato, sync: CHORUS_SYNC.tempo, division: TEMPO_RATE['1/4'], depth: 50, delay: 5 };
    play(chorus(params), { frames: BEAT, after: (c, f) => delays.set(f, c.delayMs(0, 0)) });
    const swing = 0.5 * MAX_DEPTH_MS;
    // the Vibrato starts from Delay + Depth; at a sixteenth (6016 samples) it's at the top
    expect(delays.get(6016)!).toBeCloseTo(5 + 2 * swing, 2);
    expect(delays.get(18048)!).toBeCloseTo(5, 2);
  });

  it('Ensemble: three voices a third of a cycle apart; Width offsets the right one by a quarter', () => {
    const core = chorus({ mode: CHORUS_MODE.ensemble, depth: 100, delay: 10, width: 100 });
    play(core, { frames: BLOCK, transport: () => null });
    const v = [0, 1, 2].map(k => core.delayMs(k, 0));
    expect(v[0] + v[1] + v[2]).toBeCloseTo(30, 1); // three sines at 120° cancel out
    const right = core.delayMs(0, 1);
    expect(Math.abs(right - v[0])).toBeGreaterThan(1);
  });

  it('with the feedback at maximum it stays stable', () => {
    const [l] = play(chorus({ feedback: 90, delay: 2, depth: 80, mix: 100 }), { frames: SR, left: sine(220) });
    expect(l.every(Number.isFinite)).toBe(true);
    expect(Math.max(...l.map(Math.abs))).toBeLessThan(10);
  });

  it('no clicks while the delay wobbles', () => {
    const [l] = play(chorus({ depth: 100, rate: 3, sync: CHORUS_SYNC.hz, mix: 100 }), { frames: SR / 2, left: sine(220) });
    expect(maxJump(l)).toBeLessThan(0.04); // the sine alone: 0.014 per sample
  });
});

describe('Auto Pan', () => {
  /** The volume of the two channels at each block, by the start sample of the next block. */
  function gains(params: Record<string, number>, transport: Transport = fromZero, frames = BEAT) {
    const out = new Map<number, [number, number]>();
    play(autoPan(params), { frames, transport, after: (c, f) => out.set(f, [c.gain(0), c.gain(1)]) });
    return out;
  }
  const QUARTER = { division: TEMPO_RATE['1/4'] };

  it('at 180° the channels go in antiphase: at the top on the left, nothing on the right', () => {
    const g = gains(QUARTER);
    const [l, r] = g.get(6016)!; // a sixteenth: the sine is at the top
    expect(l).toBeCloseTo(1, 3);
    expect(r).toBeCloseTo(0, 2);
    const [l2, r2] = g.get(18048)!;
    expect(l2).toBeCloseTo(0, 2);
    expect(r2).toBeCloseTo(1, 3);
  });

  it('constant power: halfway −3 dB per channel (not −6), and at every point the sum of the powers is 1', () => {
    const g = gains(QUARTER);
    const [l] = g.get(128)!;
    expect(l).toBeCloseTo(Math.SQRT1_2, 1);
    for (const [a, b] of g.values()) expect(a * a + b * b).toBeCloseTo(1, 2);
  });

  it('Stereo at 0°: tremolo, the channels together; Amount says how far it drops', () => {
    const [l, r] = gains({ ...QUARTER, stereo: 0, amount: 50 }).get(18048)!;
    expect(l).toBeCloseTo(0.5, 2);
    expect(r).toBeCloseTo(l, 9);
  });

  it('Phase shifts the cycle relative to the bar', () => {
    const [l] = gains({ ...QUARTER, phase: 90 }).get(128)!;
    expect(l).toBeCloseTo(1, 3);
  });

  it('when stopped it runs free at the project\'s tempo; in Hz it doesn\'t look at the transport', () => {
    expect(gains(QUARTER, () => null).get(6016)![0]).toBeCloseTo(1, 3);
    const hz = gains({ sync: AUTO_PAN_SYNC.hz, rate: 1 }, f => ({ beat: 3.3 + f * BPS, bpm: BPM, beatsPerBar: 4 }), SR / 2);
    expect(hz.get(12032)![0]).toBeCloseTo(1, 3); // a quarter of a second
  });

  it('square wave: the volume jumps but the sound doesn\'t', () => {
    const [l] = play(autoPan({ shape: LFO_SHAPE.square, division: TEMPO_RATE['1/16'] }), { frames: BEAT, left: sine(220) });
    expect(maxJump(l)).toBeLessThan(0.03); // the sine alone: 0.014
  });
});
