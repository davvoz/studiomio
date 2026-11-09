import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import type { TransportPosition } from '../../src/devices/dsp/core';
import { LFO_SHAPE } from '../../src/devices/dsp/lfo';
import { FILTER_TYPE } from '../../src/devices/dsp/multimode-filter';
import { AUTO_FILTER, AUTO_FILTER_SYNC, LFO_OCTAVES } from '../../src/devices/effects/auto-filter/auto-filter';
import { AutoFilterCore } from '../../src/devices/effects/auto-filter/auto-filter-core';
import { TEMPO_RATE } from '../../src/devices/rates';

const SR = 48000, BLOCK = 128, BPM = 120;
const BEAT = 24000;
const BPS = BPM / 60 / SR;

type Transport = (frame: number) => TransportPosition | null;
const fromZero: Transport = f => ({ beat: f * BPS, bpm: BPM, beatsPerBar: 4 });

interface Run {
  readonly frames: number;
  readonly input?: (n: number) => number;
  readonly key?: (n: number) => number;
  readonly transport?: Transport;
  /** Called after each block with the sample it will restart from. */
  readonly after?: (core: AutoFilterCore, frame: number) => void;
}

const sine = (hz: number, amp = 0.5) => (n: number) => amp * Math.sin((2 * Math.PI * hz * n) / SR);

/** Plays the Auto Filter in blocks, like the AudioWorklet. */
function play(params: Record<string, number>, o: Run): { core: AutoFilterCore; l: Float32Array; r: Float32Array } {
  const core = new AutoFilterCore(SR);
  core.setTempo(BPM);
  core.setParams(resolveParams(AUTO_FILTER, params));
  const input = o.input ?? sine(220), transport = o.transport ?? fromZero;
  const l = new Float32Array(o.frames), r = new Float32Array(o.frames);
  const inL = new Float32Array(BLOCK), inR = new Float32Array(BLOCK), kl = new Float32Array(BLOCK);
  const outL = new Float32Array(BLOCK), outR = new Float32Array(BLOCK);
  for (let f = 0; f < o.frames; f += BLOCK) {
    for (let i = 0; i < BLOCK; i++) {
      inL[i] = inR[i] = input(f + i);
      if (o.key) kl[i] = o.key(f + i);
    }
    core.setKey(o.key ? kl : null, o.key ? kl : null);
    core.setTransport(transport(f));
    core.process(inL, inR, outL, outR, BLOCK);
    l.set(outL.subarray(0, Math.min(BLOCK, o.frames - f)), f);
    r.set(outR.subarray(0, Math.min(BLOCK, o.frames - f)), f);
    o.after?.(core, f + BLOCK);
  }
  return { core, l, r };
}

const rms = (x: Float32Array, from = 0, to = x.length) => Math.sqrt(x.subarray(from, to).reduce((s, y) => s + y * y, 0) / (to - from));

/** The cutoff (of the two channels) at each block, by start sample of the next block. */
function cutoffs(params: Record<string, number>, o: Omit<Run, 'after'>) {
  const left = new Map<number, number>(), right = new Map<number, number>();
  play(params, { ...o, after: (core, f) => { left.set(f, core.cutoff(0)); right.set(f, core.cutoff(1)); } });
  return { left, right };
}

/** A sine LFO at 100% on 1000 Hz: the cutoff goes from 1000/16 to 1000·16. */
const WOBBLE = { freq: 1000, lfoAmount: 100, lfoShape: LFO_SHAPE.sine, lfoDivision: TEMPO_RATE['1/4'] };
const TOP = 1000 * 2 ** LFO_OCTAVES, BOTTOM = 1000 / 2 ** LFO_OCTAVES;

describe('Auto Filter: the filter', () => {
  it('low-pass at 2 kHz: the lows pass, the highs don\'t', () => {
    const low = play({ resonance: 0 }, { frames: SR / 2, input: sine(200) });
    const high = play({ resonance: 0 }, { frames: SR / 2, input: sine(12000) });
    expect(rms(low.l, SR / 4)).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(rms(high.l, SR / 4)).toBeLessThan(0.02);
  });

  it('Dry/Wet at 0 and Output: the sound as it was, louder or quieter', () => {
    const { l } = play({ mix: 0, output: -6 }, { frames: BLOCK * 4, input: sine(12000) });
    for (let n = 0; n < l.length; n += 37) expect(l[n]).toBeCloseTo(sine(12000)(n) * 10 ** (-6 / 20), 6);
  });

  it('the drive saturates but never exceeds the level of a full sound', () => {
    const { l } = play({ drive: 24, freq: 20000, resonance: 0 }, { frames: SR / 4, input: sine(100, 1) });
    expect(Math.max(...l.map(Math.abs))).toBeLessThan(1.1);
    expect(l.every(Number.isFinite)).toBe(true);
  });
});

describe('Auto Filter: the LFO locked to the bar', () => {
  it('a 1/4 cycle: at the sixteenth the cutoff is at the top, at the third sixteenth at the bottom', () => {
    const { left } = cutoffs(WOBBLE, { frames: 2 * BEAT });
    // at 120 BPM a sixteenth is 6000 samples; 6016 is the start of a block
    expect(left.get(6016)! / TOP).toBeGreaterThan(0.95);
    expect(left.get(18048)! / BOTTOM).toBeLessThan(1.05);
    expect(left.get(30080)! / TOP).toBeGreaterThan(0.95); // and at the next quarter
  });

  it('after a transport jump it restarts from the right point of the bar', () => {
    // the transport jumps from 0.5 to 2.25 beats after 12032 samples: right away at the top
    const jump: Transport = f => ({ beat: f < 12032 ? f * BPS : 2.25 + (f - 12032) * BPS, bpm: BPM, beatsPerBar: 4 });
    const { left } = cutoffs(WOBBLE, { frames: 14000, transport: jump });
    expect(left.get(12032 + 640)! / TOP).toBeGreaterThan(0.95); // after the settling (2 ms)
  });

  it('Phase shifts the cycle, Stereo offsets the right one', () => {
    const { left, right } = cutoffs({ ...WOBBLE, lfoPhase: 90, lfoStereo: 180 }, { frames: BEAT });
    // at 90° the cycle starts from the top; the right one, at 180°, from the bottom
    expect(left.get(256)! / TOP).toBeGreaterThan(0.9);
    expect(right.get(256)! / BOTTOM).toBeLessThan(1.1);
  });

  it('when stopped it runs free at the project\'s tempo', () => {
    const { left } = cutoffs(WOBBLE, { frames: BEAT, transport: () => null });
    // it starts from 0: at the top after a quarter of a cycle (1/4 at 120 BPM: half a second per cycle)
    expect(left.get(6016)! / TOP).toBeGreaterThan(0.95);
  });

  it('in Hz it goes its own way', () => {
    const { left } = cutoffs({ ...WOBBLE, lfoSync: AUTO_FILTER_SYNC.hz, lfoRate: 1 }, { frames: SR / 2, transport: f => ({ beat: 7.25 + f * BPS, bpm: BPM, beatsPerBar: 4 }) });
    expect(left.get(12032)! / TOP).toBeGreaterThan(0.95); // a quarter of a second
  });

  it('square wave at maximum: the cutoff jumps but the sound doesn\'t (no click)', () => {
    const { l } = play({ ...WOBBLE, lfoShape: LFO_SHAPE.square, lfoDivision: TEMPO_RATE['1/16'], resonance: 50 }, { frames: BEAT, input: sine(220) });
    let jump = 0;
    for (let n = 1; n < l.length; n++) jump = Math.max(jump, Math.abs(l[n] - l[n - 1]));
    expect(jump).toBeLessThan(0.05); // the sine alone: 0.014 per sample
  });
});

describe('Auto Filter: the envelope', () => {
  const ENV = { freq: 200, resonance: 0, envAmount: 100, envAttack: 1, envRelease: 50 };

  it('the loud sound opens the filter, the silence closes it again', () => {
    const burst = (n: number) => (n < SR / 4 ? sine(220, 0.9)(n) : 0);
    const { left } = cutoffs(ENV, { frames: SR, input: burst });
    expect(left.get(6016)!).toBeGreaterThan(200 * 2 ** 4);
    expect(left.get(SR - 128)!).toBeLessThan(220);
  });

  it('negative closes it', () => {
    const { left } = cutoffs({ ...ENV, freq: 5000, envAmount: -100 }, { frames: SR / 4, input: sine(220, 0.9) });
    expect(left.get(6016)!).toBeLessThan(5000 / 2 ** 4);
  });

  it('with the sidechain it listens to the key, not the sound it filters', () => {
    const quiet = sine(220, 0.01), loud = sine(60, 0.9);
    expect(cutoffs(ENV, { frames: SR / 4, input: quiet, key: loud }).left.get(6016)!).toBeGreaterThan(200 * 2 ** 4);
    expect(cutoffs(ENV, { frames: SR / 4, input: loud, key: () => 0 }).left.get(6016)!).toBeLessThan(205);
  });
});

describe('Auto Filter: the types', () => {
  it('high-pass and notch do what they say', () => {
    const hp = play({ type: FILTER_TYPE.highPass, freq: 2000, resonance: 0 }, { frames: SR / 2, input: sine(200) });
    expect(rms(hp.l, SR / 4)).toBeLessThan(0.01);
    const notch = play({ type: FILTER_TYPE.notch, freq: 1000, resonance: 0, slope: 1 }, { frames: SR / 2, input: sine(1000) });
    expect(rms(notch.l, SR / 4)).toBeLessThan(0.01);
  });
});
