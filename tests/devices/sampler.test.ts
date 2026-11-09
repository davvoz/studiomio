import { describe, expect, it } from 'vitest';
import { keptOnPreset, paramSpec, resolveParams } from '../../src/devices/device-type';
import type { SampleData } from '../../src/devices/dsp/core';
import { instrumentType } from '../../src/devices/registry';
import {
  FIRST_SLICE_NOTE, layoutZones, LOOP, LOOP_RELEASE, MAX_ZONES, MODE, noteInName, ownSound, SAMPLE_SLOT, SAMPLER, SLICE, SOUND_KEYS, sliceStarts,
  sliceValues, spreadRanges, TRIGGER, upgradeZoneTune, VOICE_MODE, zoneDefaults, zoneKeys, zoneParam, zoneSlot, zoneSource, type ZoneKey,
} from '../../src/devices/instruments/sampler/sampler';
import { SamplerCore } from '../../src/devices/instruments/sampler/sampler-core';
import { presetParams } from '../../src/devices/user-presets';
import { NoteQueue } from '../../src/devices/worklet/note-queue';
import { findTransients } from '../../src/ui/device/sampler/slices';

const SR = 48000, BLOCK = 128;

function run(core: SamplerCore, queue: NoteQueue, frames: number): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (let f = 0; f < frames; f += BLOCK) {
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    queue.renderBlock(core, l, r, f);
    const n = Math.min(BLOCK, frames - f);
    left.set(l.subarray(0, n), f);
    right.set(r.subarray(0, n), f);
  }
  return { left, right };
}

/** A Sampler with the sample and the parameters (volume at 0 dB, velocity that doesn't count). */
const sampler = (sample: SampleData | null, params: Record<string, number> = {}) => {
  const core = new SamplerCore(SR);
  core.setParams(resolveParams(SAMPLER, { volume: 0, velocity: 0, ...params }));
  core.setSample(SAMPLE_SLOT, sample);
  return { core, queue: new NoteQueue() };
};

const sine = (hz: number, seconds: number, sr = SR, amp = 0.5): SampleData =>
  ({ sampleRate: sr, channels: [Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / sr))] });

/** A stepped sample: `levels.length` equal pieces, each at a constant level. */
const steps = (levels: readonly number[], seconds: number): SampleData => {
  const n = Math.round(seconds * SR), part = n / levels.length;
  return { sampleRate: SR, channels: [Float32Array.from({ length: n }, (_, i) => levels[Math.min(levels.length - 1, Math.floor(i / part))])] };
};

const zeroCrossHz = (x: Float32Array, from: number, to: number) => {
  let n = 0;
  for (let i = from + 1; i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return (n * SR) / (to - from);
};

const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
};

const lastSound = (x: Float32Array) => {
  for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]) > 1e-5) return i;
  return -1;
};

const maxJump = (x: Float32Array, from: number, to: number) => {
  let m = 0;
  for (let i = from + 1; i < to; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
  return m;
};

describe('Sampler: description', () => {
  it('it\'s among the instruments, and the presets use only its own parameters', () => {
    expect(instrumentType('sampler')).toBe(SAMPLER);
    for (const p of SAMPLER.presets) for (const id of Object.keys(p.params)) expect(paramSpec(SAMPLER, id), `${p.name}: ${id}`).toBeDefined();
  });

  it('the grid slices divide the region into equal parts', () => {
    const v = resolveParams(SAMPLER, { mode: MODE.slice, sliceBy: SLICE.grid, sliceGrid: 0, start: 20, end: 60 });
    expect(sliceStarts(v).map(x => +x.toFixed(6))).toEqual([0.2, 0.3, 0.4, 0.5]);
  });

  it('the slices at the transients start from the beginning and keep only those inside the region, in order', () => {
    const v = resolveParams(SAMPLER, { mode: MODE.slice, start: 10, end: 80, ...sliceValues([0.05, 0.6, 0.3, 0.9]) });
    expect(sliceStarts(v)).toEqual([0.1, 0.3, 0.6]);
    expect(SAMPLER.noteNames!(v).get(FIRST_SLICE_NOTE + 2)).toBe('Slice 3');
    expect(SAMPLER.noteNames!(resolveParams(SAMPLER, {})).size).toBe(0);
  });
});

describe('Sampler: slices at the transients', () => {
  /** Dry hits (decaying noise) at the given instants, in a sample of `seconds`. */
  const hits = (times: readonly number[], seconds: number): SampleData => {
    const x = new Float32Array(Math.round(seconds * SR));
    let seed = 7;
    for (const t of times) for (let i = 0; i < SR * 0.1; i++) {
      seed = (seed * 16807) % 2147483647;
      const k = Math.round(t * SR) + i;
      if (k < x.length) x[k] += 0.8 * Math.exp(-i / (SR * 0.015)) * ((seed / 2147483647) * 2 - 1);
    }
    return { sampleRate: SR, channels: [x] };
  };

  it('finds the hits (not the start, which is already the first slice), inside the region', () => {
    const data = hits([0, 0.5, 1, 1.5], 2);
    const found = findTransients(data, false, 0.5);
    expect(found.map(x => Math.round(x * 4) / 4)).toEqual([0.25, 0.5, 0.75]);
    for (const [x, t] of found.map((x, i) => [x, [0.25, 0.5, 0.75][i]])) expect(Math.abs(x - t)).toBeLessThan(0.01);
    expect(findTransients(data, false, 0.5, 0.3, 1).map(x => Math.round(x * 4) / 4)).toEqual([0.5, 0.75]);
  });

  it('with Reverse it looks for them in the reversed sample', () => {
    // reversed a hit ends abruptly: the attacks are the ends of the original hits
    const found = findTransients(hits([0.2], 1), true, 0.5);
    expect(found.every(x => x > 0.5)).toBe(true);
  });
});

describe('Sampler: sound', () => {
  it('without sample it\'s silent', () => {
    const { core, queue } = sampler(null);
    queue.add(60, 100, 0, 4800);
    expect(rms(run(core, queue, 4800).left)).toBe(0);
  });

  it('at the root note it plays the sample as it is; an octave up goes at double', () => {
    for (const [pitch, hz] of [[60, 440], [72, 880], [48, 220]] as const) {
      const { core, queue } = sampler(sine(440, 1));
      queue.add(pitch, 100, 0, 24000);
      expect(zeroCrossHz(run(core, queue, 12000).left, 1000, 12000)).toBeCloseTo(hz, -1);
    }
  });

  it('a file at another sample rate stays in tune', () => {
    const { core, queue } = sampler(sine(440, 1, 22050));
    queue.add(60, 100, 0, 24000);
    expect(zeroCrossHz(run(core, queue, 12000).left, 1000, 12000)).toBeCloseTo(440, -1);
  });

  it('with Key track at zero all the keys play at the same pitch; Transpose moves it', () => {
    const { core, queue } = sampler(sine(440, 1), { keyTrack: 0, transpose: 12 });
    queue.add(40, 100, 0, 24000);
    expect(zeroCrossHz(run(core, queue, 12000).left, 1000, 12000)).toBeCloseTo(880, -1);
  });

  it('without loop it ends with the region even if the note is held; Start and End choose it', () => {
    const { core, queue } = sampler(sine(440, 1), { start: 25, end: 50 });
    queue.add(60, 100, 0, SR * 2);
    const out = run(core, queue, SR).left;
    const end = lastSound(out);
    expect(end).toBeGreaterThan(SR * 0.25 - 200);
    expect(end).toBeLessThan(SR * 0.25 + 10);
  });

  it('the loop holds the note past the end of the sample, and the release closes it', () => {
    const { core, queue } = sampler(sine(440, 0.2), { loop: LOOP.forward, loopStart: 20, loopEnd: 80, xfade: 20, e1R: 0.05 });
    queue.add(60, 100, 0, SR);
    const out = run(core, queue, SR * 1.5).left;
    expect(rms(out, SR * 0.8, SR * 0.95)).toBeGreaterThan(0.2);
    expect(lastSound(out)).toBeLessThan(SR * 1.2);
  });

  it('the loop crossfade doesn\'t jump', () => {
    // the loop contains 29 and a half periods: without crossfade there's a step
    const loop = { loop: LOOP.forward, loopStart: 10.37, loopEnd: 64 };
    const jumps = (xfade: number) => {
      const { core, queue } = sampler(sine(220, 0.25), { ...loop, xfade });
      queue.add(60, 100, 0, SR);
      return maxJump(run(core, queue, SR).left, 1000, SR - 1000);
    };
    const smooth = (2 * Math.PI * 220 * 0.5) / SR;
    expect(jumps(0)).toBeGreaterThan(smooth * 4);
    expect(jumps(30)).toBeLessThan(smooth * 1.5);
  });

  it('ping-pong goes back and forth and keeps playing', () => {
    const { core, queue } = sampler(sine(440, 0.1), { loop: LOOP.pingPong, loopStart: 0, loopEnd: 100 });
    queue.add(60, 100, 0, SR);
    const out = run(core, queue, SR * 0.9).left;
    expect(rms(out, SR * 0.6, SR * 0.9)).toBeGreaterThan(0.2);
  });

  it('with "To the end" once the note is released it leaves the loop and ends with the sample', () => {
    const { core, queue } = sampler(sine(440, 0.5), {
      loop: LOOP.forward, loopStart: 0, loopEnd: 20, loopRelease: LOOP_RELEASE.exit, e1R: 10,
    });
    queue.add(60, 100, 0, SR * 0.3);
    const out = run(core, queue, SR * 2).left;
    const end = lastSound(out);
    // from the loop point to the release less than 0.5 s of sample is missing: then it's silent, despite the long release
    expect(end).toBeGreaterThan(SR * 0.3);
    expect(end).toBeLessThan(SR * 0.8);
  });

  it('Reverse reads the sample from the end', () => {
    const ramp: SampleData = { sampleRate: SR, channels: [Float32Array.from({ length: SR / 10 }, (_, i) => i / (SR / 10))] };
    const { core, queue } = sampler(ramp, { reverse: 1 });
    queue.add(60, 100, 0, SR);
    const out = run(core, queue, SR / 10).left;
    expect(out[200]).toBeGreaterThan(0.9);
    expect(out[SR / 10 - 400]).toBeLessThan(0.2);
  });

  it('One-Shot in Trigger plays everything even with a short note; in Gate it stops with the note', () => {
    const play = (trigger: number) => {
      const { core, queue } = sampler(sine(440, 0.5), { mode: MODE.oneShot, trigger, e1R: 0.01 });
      queue.add(60, 100, 0, 480);
      return lastSound(run(core, queue, SR).left);
    };
    expect(play(TRIGGER.trigger)).toBeGreaterThan(SR * 0.49);
    expect(play(TRIGGER.gate)).toBeLessThan(SR * 0.05);
  });

  it('in Slice each note from C1 plays its slice, the others are silent', () => {
    const levels = [0.1, 0.2, 0.3, 0.4];
    const params = { mode: MODE.slice, sliceBy: SLICE.grid, sliceGrid: 0, e1A: 0.001 };
    for (const [k, level] of levels.entries()) {
      const { core, queue } = sampler(steps(levels, 0.4), params);
      queue.add(FIRST_SLICE_NOTE + k, 100, 0, SR);
      const out = run(core, queue, SR / 2).left;
      expect(out[2000]).toBeCloseTo(level, 2);
      // the slice lasts a quarter of the sample, then it's silent
      expect(lastSound(out)).toBeLessThan(SR * 0.1 + 10);
    }
    const { core, queue } = sampler(steps(levels, 0.4), params);
    queue.add(FIRST_SLICE_NOTE + 4, 100, 0, SR);
    queue.add(FIRST_SLICE_NOTE - 1, 100, 0, SR);
    expect(rms(run(core, queue, SR / 4).left)).toBe(0);
  });

  it('the slices at the transients use the saved points', () => {
    const { core, queue } = sampler(steps([0.1, 0.5], 0.4), { mode: MODE.slice, ...sliceValues([0.5]) });
    queue.add(FIRST_SLICE_NOTE + 1, 100, 0, SR);
    expect(run(core, queue, 4000).left[2000]).toBeCloseTo(0.5, 2);
  });

  it('the low-pass filter removes the highs', () => {
    const play = (fOn: number) => {
      const { core, queue } = sampler(sine(6000, 0.5), { fOn, fType: 1, fCutoff: 300 });
      queue.add(60, 100, 0, SR);
      return rms(run(core, queue, SR / 4).left, 2000);
    };
    expect(play(1)).toBeLessThan(play(0) * 0.05);
  });

  it('the pitch envelope makes the pitch fall', () => {
    const { core, queue } = sampler(sine(440, 2), { pitchEnv: 12, e3A: 0.001, e3D: 0.3, e3S: 0 });
    queue.add(60, 100, 0, SR * 2);
    const out = run(core, queue, SR).left;
    expect(zeroCrossHz(out, 100, 2500)).toBeGreaterThan(700);
    expect(zeroCrossHz(out, SR * 0.7, SR)).toBeCloseTo(440, -1);
  });

  it('a note restarting in Mono doesn\'t click', () => {
    const { core, queue } = sampler(sine(440, 1), { voiceMode: VOICE_MODE.mono });
    queue.add(60, 100, 0, SR);
    // it restarts halfway through a wave, far from zero
    queue.add(60, 100, 2009, SR);
    const out = run(core, queue, 6000).left;
    const smooth = (2 * Math.PI * 440 * 0.5) / SR;
    expect(maxJump(out, 1900, 2200)).toBeLessThan(smooth * 3);
  });

  it('it says where the playing voices read', () => {
    const { core, queue } = sampler(sine(440, 1));
    queue.add(60, 100, 0, SR);
    queue.add(72, 100, 0, SR);
    run(core, queue, SR / 4);
    const out = new Float32Array(16);
    const n = core.playheads(out);
    expect(n).toBe(2);
    expect([...out.subarray(0, n)].sort().map(x => +x.toFixed(2))).toEqual([0.25, 0.5]);
  });
});

describe('Sampler: zone', () => {
  /** A Sampler with one sample per zone (in order) and the parameters. */
  const zoned = (samples: readonly (SampleData | null)[], params: Record<string, number> = {}) => {
    const core = new SamplerCore(SR);
    core.setParams(resolveParams(SAMPLER, { volume: 0, velocity: 0, ...params }));
    samples.forEach((s, i) => core.setSample(zoneSlot(i), s));
    return { core, queue: new NoteQueue() };
  };
  const level = (x: number) => steps([x], 1);
  /** The level `pitch` plays (shortly after the attack). */
  const heard = (samples: readonly (SampleData | null)[], params: Record<string, number>, pitch: number, velocity = 100) => {
    const { core, queue } = zoned(samples, params);
    queue.add(pitch, velocity, 0, SR);
    return run(core, queue, 4000).left[2000];
  };

  it('the first zone uses the parameters and the slot of the single sample; all the parameters exist', () => {
    expect(zoneSlot(0)).toBe(SAMPLE_SLOT);
    expect(zoneSlot(1)).toBe('z2');
    expect(zoneParam(0, 'root')).toBe('root');
    expect(zoneParam(0, 'start')).toBe('start');
    expect(zoneParam(0, 'lo')).toBe('z1lo');
    expect(zoneParam(2, 'loopEnd')).toBe('z3loopEnd');
    const keys: ZoneKey[] = ['lo', 'hi', 'vlo', 'vhi', 'root', 'gain', 'pan', 'start', 'end', 'loopStart', 'loopEnd'];
    for (let i = 0; i < MAX_ZONES; i++) for (const k of keys) expect(paramSpec(SAMPLER, zoneParam(i, k)), `${i} ${k}`).toBeDefined();
    // the sound: the first zone's is the Sampler's parameters
    expect(zoneParam(0, 'e1R')).toBe('e1R');
    expect(zoneParam(3, 'e1R')).toBe('z4e1R');
    for (let i = 1; i < MAX_ZONES; i++) {
      for (const k of ['own', ...SOUND_KEYS] as const) expect(paramSpec(SAMPLER, zoneParam(i, k)), `${i} ${k}`).toBeDefined();
      expect(Object.keys(zoneDefaults(i))).toContain(zoneParam(i, 'loop'));
    }
  });

  it('a zone\'s sound is the first\'s until it becomes its own', () => {
    const v = resolveParams(SAMPLER, { loop: LOOP.forward, e1R: 2, [zoneParam(1, 'e1R')]: 0.1 });
    expect(zoneSource(v, 1, 'e1R')).toBe('e1R');
    expect(zoneSource(v, 1, 'start')).toBe('z2start');
    const own = ownSound(v, 1);
    expect(own).toMatchObject({ [zoneParam(1, 'own')]: 1, [zoneParam(1, 'loop')]: LOOP.forward, [zoneParam(1, 'e1R')]: 2 });
    expect(ownSound({ ...v, ...own }, 1)).toEqual({});
    expect(zoneSource({ ...v, ...own }, 1, 'e1R')).toBe('z2e1R');
  });

  it('loop, reverse and volume envelope: the zones follow the first, or have their own', () => {
    const loop = { loop: LOOP.forward, loopStart: 20, loopEnd: 80, e1R: 0.01 };
    const tail = (params: Record<string, number>) => {
      const { core, queue } = zoned([null, sine(440, 0.2)], { ...loop, ...params });
      queue.add(60, 100, 0, SR * 0.5);
      return lastSound(run(core, queue, SR).left);
    };
    // the second zone follows the first: it loops until the release
    expect(tail({})).toBeGreaterThan(SR * 0.5);
    // with its own sound (without loop) it ends with the sample; with its long release it lasts longer
    const own = { [zoneParam(1, 'own')]: 1, [zoneParam(1, 'loopStart')]: 20, [zoneParam(1, 'loopEnd')]: 80 };
    expect(tail(own)).toBeLessThan(SR * 0.2 + 10);
    expect(tail({ ...own, [zoneParam(1, 'loop')]: LOOP.forward, [zoneParam(1, 'e1R')]: 0.01 })).toBeLessThan(SR * 0.55);
    expect(tail({ ...own, [zoneParam(1, 'loop')]: LOOP.forward, [zoneParam(1, 'e1R')]: 0.3 })).toBeGreaterThan(SR * 0.7);
  });

  it('filter, pitch and LFO: each zone with its own sound has its own', () => {
    const own = { [zoneParam(1, 'own')]: 1 };
    // the second zone's filter closes the highs; the first stays open
    const bright = (params: Record<string, number>) => {
      const { core, queue } = zoned([null, sine(3000, 1)], params);
      queue.add(60, 100, 0, SR);
      return rms(run(core, queue, SR / 4).left, SR / 8, SR / 4);
    };
    const closed = { fOn: 1, fType: 1, fCutoff: 200 };
    expect(bright(closed)).toBeLessThan(0.05);
    // with its own sound the second zone's filter is its own, off
    expect(bright({ ...closed, ...own, [zoneParam(1, 'fOn')]: 0 })).toBeGreaterThan(0.2);
    // the second zone's Transpose moves it an octave, the first's doesn't
    const hz = (params: Record<string, number>, pitch: number) => {
      const { core, queue } = zoned([sine(440, 1), sine(440, 1)], { ...zoneKeys(0, 0, 59, 48), ...zoneKeys(1, 60, 127, 60), ...params });
      queue.add(pitch, 100, 0, SR);
      return zeroCrossHz(run(core, queue, 12000).left, 1000, 12000);
    };
    const up = { ...own, [zoneParam(1, 'transpose')]: 12 };
    expect(hz(up, 48)).toBeCloseTo(440, -1);
    expect(hz(up, 60)).toBeCloseTo(880, -1);
    // the LFO on the volume only in the second zone
    const wobble = (zone: number) => {
      const { core, queue } = zoned(zone === 0 ? [level(0.5)] : [null, level(0.5)], {
        ...own, [zoneParam(1, 'lfoVolume')]: 100, [zoneParam(1, 'lfoRate')]: 8, [zoneParam(1, 'lfoSync')]: 1,
      });
      queue.add(60, 100, 0, SR);
      const out = run(core, queue, SR / 2).left.subarray(SR / 10);
      return Math.max(...out) - Math.min(...out);
    };
    expect(wobble(0)).toBeLessThan(0.01);
    expect(wobble(1)).toBeGreaterThan(0.2);
  });

  it('two zones on the same note with different envelopes', () => {
    const { core, queue } = zoned([level(0.3), level(0.4)], {
      e1R: 0.01, [zoneParam(1, 'own')]: 1, [zoneParam(1, 'e1A')]: 0.001, [zoneParam(1, 'e1R')]: 0.5, [zoneParam(1, 'e1S')]: 100,
    });
    queue.add(60, 100, 0, SR / 10);
    const out = run(core, queue, SR / 2).left;
    expect(out[2000]).toBeCloseTo(0.7, 2);
    // after the release only the second remains, fading slowly
    expect(out[SR / 10 + SR * 0.05]).toBeGreaterThan(0.2);
    expect(out[SR / 10 + SR * 0.05]).toBeLessThan(0.4);
  });

  it('the Tune and Fine of the old zones go into Transpose and Detune: each zone sounds as before', () => {
    // before: the first zone +2, the second +12.3, the third nothing, the fourth without sample
    const old = { transpose: -1, z1tune: 2, z2tune: 12, z2fine: 30, z3lo: 40, z4tune: 7 };
    const samples = { [zoneSlot(0)]: 'a', [zoneSlot(1)]: 'b', [zoneSlot(2)]: 'c' };
    const before = (i: number) => old.transpose + ([2, 12.3, 0, 7][i] ?? 0);
    const now = resolveParams(SAMPLER, upgradeZoneTune(old, samples));
    expect(Object.keys(upgradeZoneTune(old, samples)).filter(k => /^z\d+(tune|fine)$/.test(k))).toEqual([]);
    for (const i of [0, 1, 2]) {
      const semis = now[zoneSource(now, i, 'transpose')] + now[zoneSource(now, i, 'detune')] / 100;
      expect(semis, `zone ${i + 1}`).toBeCloseTo(before(i), 6);
    }
    // the zone without sample doesn't become its own for nothing
    expect(now[zoneParam(3, 'own')]).toBe(0);
    // without Tune and Fine nothing changes
    const fresh = { transpose: 3 };
    expect(upgradeZoneTune(fresh)).toBe(fresh);
  });

  it('reads the note written in a file\'s name', () => {
    expect(noteInName('Piano C3.wav')).toBe(60);
    expect(noteInName('bass_f#1.aif')).toBe(42);
    expect(noteInName('Vox-Eb2')).toBe(51);
    expect(noteInName('Strings A-1')).toBe(21);
    expect(noteInName('Grand_C2_soft.wav')).toBe(48);
    expect(noteInName('Bd1.wav')).toBeNull();
    expect(noteInName('Kick 808.wav')).toBeNull();
    expect(noteInName('Pad C30')).toBeNull();
  });

  it('splits the keyboard halfway between the root notes', () => {
    expect(spreadRanges([60, 48, 72])).toEqual([{ lo: 55, hi: 66 }, { lo: 0, hi: 54 }, { lo: 67, hi: 127 }]);
    expect(spreadRanges([60, 60])).toEqual([{ lo: 0, hi: 127 }, { lo: 0, hi: 127 }]);
  });

  it("several files: on the notes in the names if they are all there, otherwise one key each", () => {
    expect(layoutZones(['Kick.wav', 'Snare.wav'], 36)).toEqual([{ lo: 36, hi: 36, root: 36 }, { lo: 37, hi: 37, root: 37 }]);
    expect(layoutZones(['Piano C2.wav', 'Piano C3.wav'], 36)).toEqual([{ lo: 0, hi: 54, root: 48 }, { lo: 55, hi: 127, root: 60 }]);
    expect(layoutZones(['Piano C2.wav', 'Kick.wav'], 40).map(z => z.lo)).toEqual([40, 41]);
    // a single file goes on the key, even if the name says a note
    expect(layoutZones(['Piano C2.wav'], 40)).toEqual([{ lo: 40, hi: 40, root: 40 }]);
  });

  it('each key plays the zone containing it; outside the zones it\'s silent', () => {
    const params = { ...zoneKeys(0, 36, 36, 36), ...zoneKeys(1, 37, 38, 37) };
    const samples = [level(0.3), level(0.6)];
    expect(heard(samples, params, 36)).toBeCloseTo(0.3, 2);
    expect(heard(samples, params, 38)).toBeCloseTo(0.6, 2);
    expect(heard(samples, params, 39)).toBe(0);
  });

  it('the overlapping zones play together, and once the note is released they all close', () => {
    const { core, queue } = zoned([level(0.3), level(0.4)], { e1R: 0.01 });
    queue.add(60, 100, 0, SR / 10);
    const out = run(core, queue, SR / 2).left;
    expect(out[2000]).toBeCloseTo(0.7, 2);
    expect(lastSound(out)).toBeLessThan(SR / 10 + SR * 0.05);
  });

  it('the velocities choose the zone', () => {
    const params = { [zoneParam(0, 'vhi')]: 63, [zoneParam(1, 'vlo')]: 64 };
    const samples = [level(0.3), level(0.6)];
    expect(heard(samples, params, 60, 40)).toBeCloseTo(0.3, 2);
    expect(heard(samples, params, 60, 100)).toBeCloseTo(0.6, 2);
  });

  it('each zone has its root note, its Transpose and its volume', () => {
    const params = { ...zoneKeys(0, 0, 59, 48), ...zoneKeys(1, 60, 127, 60), [zoneParam(1, 'own')]: 1, [zoneParam(1, 'transpose')]: 12 };
    for (const [pitch, hz] of [[48, 440], [60, 880], [72, 1760]] as const) {
      const { core, queue } = zoned([sine(440, 1), sine(440, 1)], params);
      queue.add(pitch, 100, 0, SR);
      expect(zeroCrossHz(run(core, queue, 12000).left, 1000, 12000)).toBeCloseTo(hz, -1);
    }
    expect(heard([null, level(0.8)], { [zoneParam(1, 'gain')]: -6 }, 60)).toBeCloseTo(0.4, 2);
  });

  it('start and end belong to each zone', () => {
    const { core, queue } = zoned([null, sine(440, 1)], { [zoneParam(1, 'start')]: 50, [zoneParam(1, 'end')]: 60 });
    queue.add(60, 100, 0, SR * 2);
    expect(lastSound(run(core, queue, SR).left)).toBeLessThan(SR * 0.1 + 10);
  });

  it('monophonic the first zone plays, and switching to another zone changes sample', () => {
    const { core, queue } = zoned([level(0.3), level(0.6)], { voiceMode: VOICE_MODE.legato, ...zoneKeys(0, 0, 59, 60), ...zoneKeys(1, 60, 127, 60) });
    queue.add(50, 100, 0, SR);
    queue.add(70, 100, 4000, SR);
    const out = run(core, queue, 8000).left;
    expect(out[2000]).toBeCloseTo(0.3, 2);
    expect(out[7000]).toBeCloseTo(0.6, 2);
  });

  it('in Slice only the first zone\'s slices play', () => {
    const params = { mode: MODE.slice, sliceBy: SLICE.grid, sliceGrid: 0, ...zoneKeys(1, 0, 127, 60) };
    const { core, queue } = zoned([steps([0.1, 0.2, 0.3, 0.4], 0.4), level(0.6)], params);
    queue.add(FIRST_SLICE_NOTE + 2, 100, 0, SR);
    expect(run(core, queue, 4000).left[2000]).toBeCloseTo(0.3, 2);
  });

  it('the cursors say the zone and the fraction of its sample', () => {
    const { core, queue } = zoned([null, null, sine(440, 1)]);
    queue.add(60, 100, 0, SR);
    run(core, queue, SR / 4);
    const out = new Float32Array(16);
    expect(core.playheads(out)).toBe(1);
    expect(out[0]).toBeCloseTo(2.25, 2);
  });

  it('in the piano roll the single-key zones have the name of their sample', () => {
    const v = resolveParams(SAMPLER, { ...zoneKeys(0, 36, 36, 36), ...zoneKeys(1, 38, 38, 38), ...zoneKeys(2, 40, 52, 48) });
    const names = SAMPLER.noteNames!(v, new Map([[zoneSlot(0), 'Kick'], [zoneSlot(1), 'Snare'], [zoneSlot(2), 'Bass']]));
    expect([...names]).toEqual([[36, 'Kick'], [38, 'Snare']]);
  });

  it('the presets don\'t touch the zone map, and the saved ones don\'t contain it', () => {
    const params = { ...zoneKeys(1, 40, 40, 40), root: 36, fCutoff: 500, start: 10, [zoneParam(1, 'own')]: 1, [zoneParam(1, 'e1R')]: 2 };
    expect(keptOnPreset(SAMPLER, params)).toEqual({ ...zoneKeys(1, 40, 40, 40), root: 36, [zoneParam(1, 'own')]: 1, [zoneParam(1, 'e1R')]: 2 });
    expect(presetParams(SAMPLER, params)).toEqual({ fCutoff: 500, start: 10 });
  });
});
