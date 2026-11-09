import { describe, expect, it } from 'vitest';
import { paramsOf, paramSpec, resolveParams } from '../../src/devices/device-type';
import { midiToHz } from '../../src/devices/dsp/core';
import { clampParam } from '../../src/devices/params';
import { TABLE_SIZE, TABLE_NAMES, cyclesOf } from '../../src/devices/instruments/wavetable/tables';
import {
  DESTINATIONS, destinationOf, FILTER, FILTER_MODE, FILTER_TYPES, LFO_TRIG, PRISMA, ROUTE, SRC, USER_TABLE, VOICE_MODE, WARP, WARPS,
} from '../../src/devices/instruments/prisma/prisma';
import { PrismaCore } from '../../src/devices/instruments/prisma/prisma-core';
import { drawn, mods } from '../../src/devices/instruments/prisma/prisma-presets';
import { bend, drawnValue, LFO_SHAPE, pointsOf, pointValues } from '../../src/devices/instruments/prisma/shapes';
import { CurvedEnv } from '../../src/devices/instruments/prisma/curved-env';
import { NoteQueue } from '../../src/devices/worklet/note-queue';

const SR = 48000, BLOCK = 128;
const TABLE = Object.fromEntries(TABLE_NAMES.map((n, i) => [n, i])) as Record<string, number>;

function run(core: PrismaCore, queue: NoteQueue, frames: number): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (let f = 0; f < frames; f += BLOCK) {
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    queue.renderBlock(core, l, r, f);
    left.set(l.subarray(0, Math.min(BLOCK, frames - f)), f);
    right.set(r.subarray(0, Math.min(BLOCK, frames - f)), f);
  }
  return { left, right };
}

const synth = (params: Record<string, number> = {}, bpm = 120) => {
  const core = new PrismaCore(SR);
  core.setTempo(bpm);
  core.setParams(resolveParams(PRISMA, params));
  return { core, queue: new NoteQueue() };
};

/** A note for `seconds` (held the whole time, unless stated otherwise). */
const play = (params: Record<string, number>, pitch = 57, seconds = 0.5, hold = seconds, velocity = 100) => {
  const { core, queue } = synth(params);
  queue.add(pitch, velocity, 0, Math.round(hold * SR));
  return run(core, queue, Math.round(seconds * SR));
};

const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
};

const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** The amplitude of the component at `hz` (DFT over a Hann window). */
function amplitudeAt(x: ArrayLike<number>, hz: number, from: number, length: number): number {
  let re = 0, im = 0, w = 0;
  for (let i = 0; i < length; i++) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length), ph = (2 * Math.PI * hz * i) / SR;
    re += x[from + i] * win * Math.cos(ph);
    im += x[from + i] * win * Math.sin(ph);
    w += win;
  }
  return (2 * Math.hypot(re, im)) / w;
}

/** Oscillator A alone: no filter, fixed phase, full volume. */
const BARE = { aPos: 0, aLevel: 100, aRand: 0, f1On: 0, volume: 0, e1A: 0.001, e1S: 100, e1R: 0.01 };

describe('Prisma: parameters', () => {
  it('each parameter has a single id and a valid default', () => {
    const ids = paramsOf(PRISMA).map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(resolveParams(PRISMA, {}))).toHaveLength(ids.length);
  });

  it('the presets use only existing parameters, within their limits', () => {
    expect(PRISMA.presets.length).toBeGreaterThan(1);
    for (const preset of PRISMA.presets) {
      for (const [id, v] of Object.entries(preset.params)) {
        const spec = paramSpec(PRISMA, id);
        expect(spec, `${preset.name}.${id}`).toBeDefined();
        expect(clampParam(spec!, v), `${preset.name}.${id}`).toBeCloseTo(v, 9);
      }
    }
  });

  it('the targets are visible knobs, and only points and matrix fields stay hidden', () => {
    for (const d of DESTINATIONS) {
      const spec = paramSpec(PRISMA, d.param);
      expect(spec?.kind, d.param).toBe('number');
      expect(spec?.hidden, d.param).toBeFalsy();
    }
    const hidden = paramsOf(PRISMA).filter(p => p.hidden).map(p => p.id);
    for (const id of hidden) expect(id, id).toMatch(/^(l\d(Pts|[XYC]\d+)|m\d+(Src|Dst|Pol|Curve|Aux))$/);
  });

  it('the matrix rows are written by target name', () => {
    expect(mods([SRC.lfo1, 'f1Cutoff', 40, { bi: true }])).toEqual({ m1Src: SRC.lfo1, m1Dst: destinationOf('f1Cutoff'), m1Amt: 40, m1Pol: 1 });
    expect(() => mods([SRC.lfo1, 'aTable', 40])).toThrow();
  });
});

describe('Prisma: curves and shapes', () => {
  it('a curve always goes from 0 to 1; positive runs at the start', () => {
    for (const c of [-100, -30, 0, 30, 100]) {
      expect(bend(0, c)).toBeCloseTo(0, 9);
      expect(bend(1, c)).toBeCloseTo(1, 9);
    }
    expect(bend(0.2, 60)).toBeGreaterThan(0.2);
    expect(bend(0.2, -60)).toBeLessThan(0.2);
  });

  it('an LFO\'s points stay in order, with the first at the start and the last at the end', () => {
    const values = pointValues(1, [{ x: 0.3, y: 1, curve: 0 }, { x: 0.8, y: 0.2, curve: 0 }, { x: 0.4, y: 0.5, curve: 0 }, { x: 0.1, y: 0, curve: 0 }]);
    const p = pointsOf(values, 1);
    expect(p.map(q => q.x)).toEqual([0, 0.4, 0.8, 1]);
    expect(drawnValue(p, 0.2)).toBeCloseTo(0.75, 6); // halfway between (0, 1) and (0.4, 0.5)
    // two points at the same x: a step
    const step = pointsOf(pointValues(1, [{ x: 0, y: 1, curve: 0 }, { x: 0.5, y: 1, curve: 0 }, { x: 0.5, y: 0, curve: 0 }, { x: 1, y: 0, curve: 0 }]), 1);
    expect(drawnValue(step, 0.49)).toBe(1);
    expect(drawnValue(step, 0.51)).toBe(0);
  });

  it('the envelope does attack, hold, decay, sustain and release in its times', () => {
    const rate = 1000, env = new CurvedEnv(rate);
    env.set({ attack: 0.1, hold: 0.05, decay: 0.2, sustain: 0.5, release: 0.1, attackCurve: 0, decayCurve: 0, releaseCurve: 0 });
    env.trigger();
    const values = Array.from({ length: 500 }, () => env.next());
    expect(values[49]).toBeCloseTo(0.5, 1); // half attack, linear
    expect(values[120]).toBe(1); // hold
    expect(values[250]).toBeCloseTo(0.75, 1); // half decay, linear
    expect(values[400]).toBe(0.5);
    env.release();
    for (let i = 0; i < 50; i++) env.next();
    expect(env.value).toBeCloseTo(0.25, 1);
    for (let i = 0; i < 60; i++) env.next();
    expect(env.active).toBe(false);
  });
});

describe('Prisma: sound', () => {
  it('plays the right note, with the position\'s timbre', () => {
    const f = midiToHz(57);
    const sine = play({ ...BARE, aTable: TABLE.Basic, aPos: 0 }).left;
    expect(amplitudeAt(sine, f, 4800, 9600)).toBeGreaterThan(0.9);
    expect(amplitudeAt(sine, 2 * f, 4800, 9600)).toBeLessThan(0.01);
    const saw = play({ ...BARE, aTable: TABLE.Basic, aPos: 67 }).left;
    expect(amplitudeAt(saw, 2 * f, 4800, 9600) / amplitudeAt(saw, f, 4800, 9600)).toBeCloseTo(0.5, 1);
  });

  it('octave, semitones and global Pitch move the note', () => {
    const f = midiToHz(57);
    const up = play({ ...BARE, aOct: 1, aSemi: 7, tune: -2 }).left;
    expect(amplitudeAt(up, f * Math.pow(2, 17 / 12), 4800, 9600)).toBeGreaterThan(0.9);
  });

  /** The strongest of the audible aliases (the harmonics beyond Nyquist folded below 15 kHz),
   *  relative to the strongest harmonic. */
  const worstAlias = (x: Float32Array, f: number) => {
    let loudest = 0, worst = 0;
    for (let k = 1; k * f < SR / 2; k++) loudest = Math.max(loudest, amplitudeAt(x, k * f, 4800, 16384));
    for (let k = Math.ceil(SR / 2 / f); k <= 200; k++) {
      const folded = Math.abs(SR - k * f) % SR, alias = Math.min(folded, SR - folded), r = (alias / f) % 1;
      // those falling on a real harmonic can't be told apart
      if (alias < 15000 && Math.min(r, 1 - r) * f > 60) worst = Math.max(worst, amplitudeAt(x, alias, 4800, 16384));
    }
    return worst / loudest;
  };

  it('high notes don\'t alias', () => {
    const pitch = 96;
    const { left } = play({ ...BARE, aTable: TABLE.Sync, aPos: 47 }, pitch);
    expect(worstAlias(left, midiToHz(pitch))).toBeLessThan(0.003);
  });

  it('the sync warp reads a poorer version of the table and rounds off the restart', () => {
    for (const amount of [23, 41]) {
      const pitch = 84;
      const { left } = play({ ...BARE, aPos: 67, aWarp: WARP.sync, aWarpAmt: amount }, pitch);
      expect(worstAlias(left, midiToHz(pitch)), `sync ${amount}`).toBeLessThan(0.012);
    }
  });

  it('all the warps and all the filters play without exploding', () => {
    for (let warp = 0; warp < WARPS.length; warp++) {
      for (const amount of [0, 50, 100]) {
        const { left } = play({ ...BARE, aTable: TABLE.Basic, aPos: 67, aWarp: warp, aWarpAmt: amount, bOn: 1, bLevel: 0, subOn: 1, subLevel: 0 }, 57, 0.15);
        expect(left.every(Number.isFinite), `${WARPS[warp]} ${amount}`).toBe(true);
        expect(peak(left), `${WARPS[warp]} ${amount}`).toBeLessThan(4);
        expect(rms(left), `${WARPS[warp]} ${amount}`).toBeGreaterThan(0.01);
      }
    }
    for (let type = 0; type < FILTER_TYPES.length; type++) {
      for (const [cutoff, res] of [[200, 0], [1500, 70], [8000, 100]]) {
        const { left } = play({ ...BARE, aPos: 67, f1On: 1, f1Type: type, f1Cutoff: cutoff, f1Res: res, f1Drive: 40 }, 45, 0.2);
        expect(left.every(Number.isFinite), `${FILTER_TYPES[type]} ${cutoff} ${res}`).toBe(true);
        expect(peak(left), `${FILTER_TYPES[type]} ${cutoff} ${res}`).toBeLessThan(5);
      }
    }
  });

  it('the FM warp takes the other oscillator only if it\'s on', () => {
    const f = midiToHz(57);
    const base = { ...BARE, aWarp: WARP.fm, aWarpAmt: 60, bLevel: 0, bSemi: 12 };
    const off = play({ ...base, bOn: 0 }).left, on = play({ ...base, bOn: 1 }).left;
    expect(amplitudeAt(off, 3 * f, 4800, 9600)).toBeLessThan(0.01);
    expect(amplitudeAt(on, 3 * f, 4800, 9600)).toBeGreaterThan(0.05);
  });

  it('the low-pass removes the highs; "Direct" skips it', () => {
    const f = midiToHz(45);
    const lp = { ...BARE, aPos: 67, f1On: 1, f1Type: FILTER.lp24, f1Cutoff: 300 };
    const filtered = play(lp, 45).left, direct = play({ ...lp, aRoute: ROUTE.direct }, 45).left;
    expect(amplitudeAt(filtered, 10 * f, 4800, 9600)).toBeLessThan(0.002);
    expect(amplitudeAt(direct, 10 * f, 4800, 9600)).toBeGreaterThan(0.03);
  });

  it('in series low-pass and high-pass make a band-pass; in parallel they add up', () => {
    const f = midiToHz(45);
    const both = { ...BARE, aPos: 67, f1On: 1, f1Type: FILTER.lp24, f1Cutoff: 400, f2On: 1, f2Type: FILTER.hp24, f2Cutoff: 4000, aRoute: ROUTE.both };
    const serial = play({ ...both, fMode: FILTER_MODE.serial }, 45).left;
    const parallel = play({ ...both, fMode: FILTER_MODE.parallel }, 45).left;
    // in series almost nothing passes (the band-pass is empty), in parallel the lows and the highs
    expect(rms(serial, 4800)).toBeLessThan(rms(parallel, 4800) * 0.2);
    expect(amplitudeAt(parallel, f, 4800, 9600)).toBeGreaterThan(0.3);
    expect(amplitudeAt(parallel, 50 * f, 4800, 9600)).toBeGreaterThan(0.002);
  });

  it('the unison widens in stereo with the Width', () => {
    const wide = play({ ...BARE, aPos: 67, aUnison: 7, aDetune: 30, aWidth: 100, aRand: 100 });
    const mono = play({ ...BARE, aPos: 67, aUnison: 7, aDetune: 30, aWidth: 0, aRand: 100 });
    const diff = (x: { left: Float32Array; right: Float32Array }) => rms(x.left.map((v, i) => v - x.right[i]), 4800);
    expect(diff(wide)).toBeGreaterThan(0.1);
    expect(diff(mono)).toBeLessThan(1e-6);
    // the level stays that of a single copy, more or less
    expect(rms(wide.left, 4800)).toBeGreaterThan(0.25);
    expect(rms(wide.left, 4800)).toBeLessThan(0.9);
  });

  it('the sub and the noise play, each with its own character', () => {
    const f = midiToHz(57);
    const sub = play({ ...BARE, aOn: 0, subOn: 1, subLevel: 100, subOct: -1 }).left;
    expect(amplitudeAt(sub, f / 2, 4800, 9600)).toBeGreaterThan(0.9);
    for (let type = 0; type < 5; type++) {
      const noise = play({ ...BARE, aOn: 0, nOn: 1, nType: type, nLevel: 100 }).left;
      expect(noise.every(Number.isFinite)).toBe(true);
      expect(rms(noise, 4800), `noise ${type}`).toBeGreaterThan(0.01);
    }
  });
});

describe('Prisma: modulations', () => {
  it('an LFO on the cutoff opens and closes the filter', () => {
    const f = midiToHz(45);
    const { left } = play({
      ...BARE, aPos: 67, f1On: 1, f1Type: FILTER.lp24, f1Cutoff: 600, l1Sync: 1, l1Rate: 2, l1Shape: LFO_SHAPE.square,
      ...mods([SRC.lfo1, 'f1Cutoff', 40]),
    }, 45, 1);
    // unipolar square at 2 Hz: open in the first quarter of a second (600 Hz + 4 octaves), closed in the second
    const open = amplitudeAt(left, 16 * f, 1200, 9600), closed = amplitudeAt(left, 16 * f, 13200, 9600);
    expect(open).toBeGreaterThan(closed * 10);
  });

  it('an envelope on the pitch makes the 808 dive', () => {
    const f = midiToHz(45);
    const { left } = play({ ...BARE, aTable: TABLE.Basic, aPos: 0, e2D: 0.05, e2Dc: 0, ...mods([SRC.env2, 'tune', 50]) }, 45, 0.5);
    // at the start two octaves up (50 % of the travel ±24 st), then the note
    expect(amplitudeAt(left, 4 * f, 0, 512)).toBeGreaterThan(amplitudeAt(left, f, 0, 512));
    expect(amplitudeAt(left, f, 9600, 9600)).toBeGreaterThan(0.9);
  });

  it('a slow envelope rises in its time even at a voice\'s first note', () => {
    const { left } = play({ ...BARE, aLevel: 0, e2A: 0.5, e2S: 100, ...mods([SRC.env2, 'aLevel', 100]) }, 57, 0.6);
    expect(rms(left, 0, 960)).toBeLessThan(0.1 * rms(left, 24000, 28800));
  });

  it('the velocity on the volume makes the loud notes louder; the aux scales the modulation', () => {
    const p = { ...BARE, volume: -20, ...mods([SRC.velocity, 'volume', 40]) };
    const soft = rms(play(p, 57, 0.3, 0.3, 20).left, 4800), loud = rms(play(p, 57, 0.3, 0.3, 127).left, 4800);
    expect(loud / soft).toBeGreaterThan(3);
    // with the aux on macro 1 at zero the velocity no longer does anything
    const gated = { ...BARE, volume: -20, ...mods([SRC.velocity, 'volume', 40, { aux: SRC.macro1 }]) };
    expect(rms(play(gated, 57, 0.3, 0.3, 127).left, 4800)).toBeCloseTo(rms(play(gated, 57, 0.3, 0.3, 20).left, 4800), 4);
  });

  it('bipolar moves around the knob, unipolar in one direction only', () => {
    const f = midiToHz(57);
    // a macro at half: in bipolar it's 0, in unipolar half the amount
    const bi = play({ ...BARE, macro1: 50, ...mods([SRC.macro1, 'aSemi', 50, { bi: true }]) }).left;
    const uni = play({ ...BARE, macro1: 50, ...mods([SRC.macro1, 'aSemi', 50]) }).left;
    expect(amplitudeAt(bi, f, 4800, 9600)).toBeGreaterThan(0.9);
    expect(amplitudeAt(uni, f * Math.pow(2, 6 / 12), 4800, 9600)).toBeGreaterThan(0.9); // 25 % di 24 st
  });

  it('a drawn "Once" LFO acts as an envelope and stays on the last value', () => {
    const f = midiToHz(57);
    const { left } = play({
      ...BARE, l1Sync: 1, l1Rate: 4, l1Trig: LFO_TRIG.once, ...drawn(1, [[0, 0], [0.5, 1], [1, 0.5]]),
      ...mods([SRC.lfo1, 'aSemi', 50]),
    }, 57, 1);
    // after a cycle (0.25 s) it stays at 0.5: half of 50 % of the travel (24 st), 6 st up
    expect(amplitudeAt(left, f * Math.pow(2, 6 / 12), 24000, 9600)).toBeGreaterThan(0.9);
  });

  it('the delay holds the LFO still, then the rise opens it', () => {
    const f = midiToHz(57);
    const { left } = play({ ...BARE, l1Sync: 1, l1Rate: 0.02, l1Delay: 0.3, l1Shape: LFO_SHAPE.sawDown, ...mods([SRC.lfo1, 'aSemi', 50]) }, 57, 0.6);
    expect(amplitudeAt(left, f, 2400, 9600)).toBeGreaterThan(0.9);
    expect(amplitudeAt(left, f * 2, 18000, 9600)).toBeGreaterThan(0.8);
  });

  it('in Legato the notes slide with the glide', () => {
    const { core, queue } = synth({ ...BARE, voiceMode: VOICE_MODE.legato, glide: 200 });
    queue.add(57, 100, 0, SR);
    queue.add(69, 100, SR / 4, SR);
    const { left } = run(core, queue, SR);
    const f = midiToHz(57);
    expect(amplitudeAt(left, f, 2400, 8192)).toBeGreaterThan(0.9);
    expect(amplitudeAt(left, 2 * f, SR - 9600, 9600)).toBeGreaterThan(0.9);
    expect(core.activeVoices).toBe(1);
  });

  it('an oscillator turned off while its position goes down, and turned back on, plays clean', () => {
    // off, the position's step isn't recomputed: if the position kept going down
    // it would end below zero, and turning it back on the reading would give NaN (the sound change of a
    // clip under a long note)
    const on = { bOn: 1, bPos: 80, voiceMode: VOICE_MODE.mono, l1Sync: 1, l1Rate: 0.5, ...mods([SRC.lfo1, 'bPos', -100, { bi: true }]) };
    const { core, queue } = synth(on);
    queue.add(57, 100, 0, 7 * SR);
    const off = Math.round((0.7 * SR) / BLOCK) * BLOCK, back = Math.round((6 * SR) / BLOCK) * BLOCK;
    let peakOut = 0;
    for (let f = 0; f < 7 * SR; f += BLOCK) {
      if (f === off) core.setParams(resolveParams(PRISMA, { ...on, bOn: 0 }));
      if (f === back) core.setParams(resolveParams(PRISMA, on));
      const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
      queue.renderBlock(core, l, r, f);
      for (let i = 0; i < BLOCK; i++) peakOut = Math.max(peakOut, Math.abs(l[i]), Math.abs(r[i]));
    }
    expect(peakOut).toBeGreaterThan(0.05);
    expect(peakOut).toBeLessThan(4);
  });
});

describe('Prisma: preset', () => {
  it('each preset plays a chord, clean and at a sensible level', () => {
    for (const preset of PRISMA.presets) {
      const { core, queue } = synth(preset.params);
      for (const p of [48, 55, 60, 64]) queue.add(p, 100, 0, SR);
      const { left, right } = run(core, queue, Math.round(1.5 * SR));
      expect(left.every(Number.isFinite) && right.every(Number.isFinite), preset.name).toBe(true);
      const level = Math.max(rms(left, 0, SR), rms(right, 0, SR));
      expect(level, preset.name).toBeGreaterThan(0.01);
      expect(Math.max(peak(left), peak(right)), preset.name).toBeLessThan(1.6);
    }
  });
});

describe('Prisma: imported tables', () => {
  it('a wavetable file becomes one shape per period', () => {
    const frames = 4, data = new Float32Array(frames * TABLE_SIZE);
    for (let f = 0; f < frames; f++) {
      for (let i = 0; i < TABLE_SIZE; i++) data[f * TABLE_SIZE + i] = Math.sin((2 * Math.PI * (f + 1) * i) / TABLE_SIZE);
    }
    expect(cyclesOf([data])).toHaveLength(frames);
    expect(cyclesOf([new Float32Array(600)])).toHaveLength(1);
    expect(cyclesOf([new Float32Array(48000)]).length).toBeGreaterThan(1);

    const play = (pos: number) => {
      const { core, queue } = synth({ ...BARE, aTable: USER_TABLE, aPos: pos });
      core.setSample('wtA', { sampleRate: SR, channels: [data] });
      queue.add(45, 100, 0, SR);
      return run(core, queue, SR / 2).left;
    };
    const f = midiToHz(45);
    // at the start the first shape (the fundamental), at the end the fourth (fourth harmonic)
    expect(amplitudeAt(play(0), f, 4800, 9600)).toBeGreaterThan(0.9);
    expect(amplitudeAt(play(100), 4 * f, 4800, 9600)).toBeGreaterThan(0.9);
  });

  it('without a file the imported table plays the first table', () => {
    const { left } = play({ ...BARE, aTable: USER_TABLE });
    expect(amplitudeAt(left, midiToHz(57), 4800, 9600)).toBeGreaterThan(0.9);
  });
});
