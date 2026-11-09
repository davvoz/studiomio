import { describe, expect, it } from 'vitest';
import { paramSpec, resolveParams } from '../../src/devices/device-type';
import { BODY_SLOT, FIRST_NOTE, KICK, NOTE_COUNT, noteHz, SNAP_SLOT, SNAP_SOURCE, SOURCE } from '../../src/devices/instruments/kick/kick';
import { driveSample, KickCore } from '../../src/devices/instruments/kick/kick-core';
import { instrumentType } from '../../src/devices/registry';
import { INSTRUMENT_CORES } from '../../src/devices/worklet/cores';

const SR = 48000;

/** A hit with these parameters (no velocity, volume at 0 dB, no low cut), for `seconds`. */
function hit(params: Record<string, number> = {}, seconds = 1, pitch = 36, samples: Record<string, Float32Array> = {}) {
  const core = new KickCore(SR);
  core.setParams(resolveParams(KICK, { velocity: 0, volume: 0, lowCut: 15, drive: 0, ...params }));
  for (const [slot, data] of Object.entries(samples)) core.setSample(slot, { sampleRate: SR, channels: [data] });
  const n = Math.round(seconds * SR), left = new Float32Array(n), right = new Float32Array(n);
  core.noteOn(1, pitch, 127);
  for (let f = 0; f < n; f += 128) core.render(left, right, f, Math.min(n, f + 128));
  return { left, right, core };
}

const at = (s: number) => Math.round(s * SR);

const peak = (x: Float32Array, from = 0, to = x.length) => {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
};

const rms = (x: Float32Array, from: number, to: number) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
};

/** Average frequency from the (upward) zero crossings in [from, to). */
const zeroCrossHz = (x: Float32Array, from: number, to: number) => {
  let n = 0;
  for (let i = from + 1; i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return (n * SR) / (to - from);
};

/** Only the sine: no snap, no bent body. */
const PURE = { snapLevel: 0, shape: 0, tailDrive: 0 };

describe('Kick: description', () => {
  it('it\'s an instrument, with its engine; the notes go from C0 to C2, the first choice is F0', () => {
    expect(instrumentType('kick')).toBe(KICK);
    expect(INSTRUMENT_CORES.kick(SR)).toBeInstanceOf(KickCore);
    const note = paramSpec(KICK, 'note')!;
    expect(note.kind === 'choice' && note.options.length).toBe(NOTE_COUNT);
    expect(note.kind === 'choice' && note.options[0]).toBe('C0 · 32.7 Hz');
    expect(note.kind === 'choice' && note.options[note.default]).toBe('F0 · 43.7 Hz');
    expect(FIRST_NOTE + NOTE_COUNT - 1).toBe(48);
  });

  it('each preset plays, without exploding', () => {
    for (const preset of KICK.presets) {
      const { left } = hit({ ...preset.params, volume: preset.params.volume ?? -6 }, 1.5);
      expect(left.every(Number.isFinite), preset.name).toBe(true);
      expect(peak(left), preset.name).toBeGreaterThan(0.05);
      expect(peak(left), preset.name).toBeLessThan(2);
    }
  });
});

describe('Kick: the sound', () => {
  it('tuned: the tail sits on the chosen note, and the played note doesn\'t count if it\'s Fixed', () => {
    for (const note of [5, 7, 12]) {
      const { left } = hit({ ...PURE, note, tailLevel: 100, tailDecay: 3, decay: 0.05, hold: 0 }, 1.2, 50);
      expect(zeroCrossHz(left, at(0.4), at(1.2))).toBeCloseTo(noteHz(FIRST_NOTE + note), 0);
    }
  });

  it('Follow: C1 plays the chosen note, the other notes shift it', () => {
    const follow = { ...PURE, note: 5, follow: 1, tailLevel: 100, tailDecay: 3, decay: 0.05, hold: 0 };
    const { left } = hit(follow, 1.2, 36 + 7);
    expect(zeroCrossHz(left, at(0.4), at(1.2))).toBeCloseTo(noteHz(FIRST_NOTE + 5 + 7), 0);
  });

  it('the body falls from above to the note; with more drop it starts higher', () => {
    const { left } = hit({ ...PURE, pitch: 36, pitchTime: 80, hold: 200, decay: 1 }, 0.5);
    // the sine's first cycle: up high it lasts much less than a period of the note
    const firstCycle = (x: Float32Array) => x.findIndex((v, i) => i > 1 && x[i - 1] < 0 && v >= 0) / SR;
    const flat = hit({ ...PURE, pitch: 0, hold: 200, decay: 1 }, 0.5).left;
    expect(firstCycle(flat)).toBeCloseTo(1 / noteHz(29), 2); // the low cut shifts the phase a little
    expect(firstCycle(left)).toBeLessThan(firstCycle(flat) / 3);
    expect(zeroCrossHz(left, at(0.3), at(0.5))).toBeCloseTo(noteHz(29), -1);
  });

  it('hold and decay: the body stays and then dies out; the tail lasts as long as its length', () => {
    const short = hit({ ...PURE, hold: 10, decay: 0.05, tailLevel: 0 }, 0.6).left;
    expect(peak(short, at(0.3), at(0.6))).toBeLessThan(1e-3);
    const tail = hit({ ...PURE, hold: 10, decay: 0.05, tailLevel: 50, tailDecay: 2 }, 0.6).left;
    expect(peak(tail, at(0.3), at(0.6))).toBeGreaterThan(0.1);
  });

  it('the snap adds the high hit at the start: click, noise or sample', () => {
    const none = hit({ ...PURE, snapLevel: 0 }, 0.05).left;
    for (const snapSource of [SNAP_SOURCE.click, SNAP_SOURCE.noise]) {
      const with_ = hit({ ...PURE, snapSource, snapLevel: 100, snapTone: 5000 }, 0.05).left;
      // the snap alone: high, loud, and over soon (afterwards, the body is the same as before)
      const snap = with_.map((v, i) => v - none[i]);
      expect(zeroCrossHz(snap, 0, at(0.004)), `snap ${snapSource}`).toBeGreaterThan(3000);
      expect(peak(snap, 0, at(0.004)), `snap ${snapSource}`).toBeGreaterThan(0.3);
      expect(peak(snap, at(0.04), at(0.05)), `snap ${snapSource}`).toBeLessThan(0.01);
    }
    const tick = Float32Array.from({ length: 480 }, (_, i) => (i % 4 < 2 ? 0.8 : -0.8));
    const sample = hit({ ...PURE, snapSource: SNAP_SOURCE.sample, snapLevel: 100, snapDecay: 400 }, 0.05, 36, { [SNAP_SLOT]: tick }).left;
    expect(zeroCrossHz(sample, 0, at(0.008))).toBeGreaterThan(5000);
  });

  it('the body can be a sample, with its pitch; the synth tail stays underneath', () => {
    const sine = (hz: number) => Float32Array.from({ length: SR }, (_, i) => Math.sin((2 * Math.PI * hz * i) / SR) * 0.9);
    const body = { ...PURE, bodySource: SOURCE.sample, hold: 300, decay: 2, tailLevel: 0 };
    const { left } = hit(body, 0.3, 36, { [BODY_SLOT]: sine(100) });
    expect(zeroCrossHz(left, at(0.05), at(0.3))).toBeCloseTo(100, -1);
    const up = hit({ ...body, sampleTune: 12 }, 0.3, 36, { [BODY_SLOT]: sine(100) }).left;
    expect(zeroCrossHz(up, at(0.05), at(0.3))).toBeCloseTo(200, -1);
    // without sample the body is silent
    expect(peak(hit(body, 0.3).left)).toBeLessThan(1e-6);
  });

  it('a new hit turns off the previous one in a few milliseconds, without jumps', () => {
    const core = new KickCore(SR);
    core.setParams(resolveParams(KICK, { velocity: 0, volume: 0, ...PURE, tailLevel: 100, tailDecay: 4 }));
    const n = at(0.6), left = new Float32Array(n), right = new Float32Array(n);
    core.noteOn(1, 36, 127);
    core.render(left, right, 0, at(0.3));
    core.noteOn(2, 36, 127);
    core.render(left, right, at(0.3), n);
    let jump = 0;
    for (let i = at(0.3) - 2; i < at(0.31); i++) jump = Math.max(jump, Math.abs(left[i + 1] - left[i]));
    expect(jump).toBeLessThan(0.2);
  });

  it('the rumble: a dark tail after the hit, which ducks under the hit', () => {
    const dry = hit({ ...PURE, decay: 0.15, hold: 10, tailLevel: 0 }, 1).left;
    const wet = hit({ ...PURE, decay: 0.15, hold: 10, tailLevel: 0, rumbleOn: 1, rumble: 100, rumbleTime: 1.5 }, 1).left;
    expect(rms(wet, at(0.5), at(0.8))).toBeGreaterThan(rms(dry, at(0.5), at(0.8)) * 20 + 0.005);
    // dark: nothing above a few hundred Hz
    expect(zeroCrossHz(wet, at(0.5), at(0.8))).toBeLessThan(400);
    const ducked = hit({ ...PURE, decay: 0.15, hold: 10, tailLevel: 0, rumbleOn: 1, rumble: 100, rumbleTime: 1.5, rumbleDuck: 100 }, 1).left;
    const open = hit({ ...PURE, decay: 0.15, hold: 10, tailLevel: 0, rumbleOn: 1, rumble: 100, rumbleTime: 1.5, rumbleDuck: 0 }, 1).left;
    expect(rms(ducked, at(0.02), at(0.06))).toBeLessThan(rms(open, at(0.02), at(0.06)));
  });

  it('the saturation: at zero clean, then soft, hard or folded', () => {
    expect(driveSample(0.5, 0, 0)).toBe(0.5);
    expect(driveSample(2, 1, 1)).toBe(1);
    expect(Math.abs(driveSample(0.9, 1, 0))).toBeLessThanOrEqual(1);
    expect(driveSample(0.25, 1, 2)).toBeLessThan(0); // folded: beyond the edge it goes back down
    expect(driveSample(0.25, 1, 1)).toBe(1);
  });

  it('velocity: the soft hits are weaker', () => {
    const core = new KickCore(SR);
    core.setParams(resolveParams(KICK, { velocity: 100, volume: 0 }));
    const n = at(0.1), loud = new Float32Array(n), soft = new Float32Array(n);
    core.noteOn(1, 36, 127);
    core.render(loud, new Float32Array(n), 0, n);
    core.silence();
    core.render(new Float32Array(at(0.05)), new Float32Array(at(0.05)), 0, at(0.05));
    core.noteOn(2, 36, 40);
    core.render(soft, new Float32Array(n), 0, n);
    expect(peak(soft)).toBeLessThan(peak(loud) * 0.5);
  });
});
