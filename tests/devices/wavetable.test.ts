import { describe, expect, it } from 'vitest';
import { paramsOf, paramSpec, resolveParams } from '../../src/devices/device-type';
import { midiToHz } from '../../src/devices/dsp/core';
import { clampParam } from '../../src/devices/params';
import { TEMPO_RATE } from '../../src/devices/rates';
import { FRAMES, LEVELS, levelFor, maxHarmonic, STRIDE, TABLE_SIZE, TABLES, wavetable } from '../../src/devices/instruments/wavetable/tables';
import { LFO_SHAPE, LFO_SYNC, MOD_DEST, TABLE, VOICE_MODE, WAVETABLE } from '../../src/devices/instruments/wavetable/wavetable';
import { WavetableCore } from '../../src/devices/instruments/wavetable/wavetable-core';
import { NoteQueue } from '../../src/devices/worklet/note-queue';

const SR = 48000, BLOCK = 128;

/** Plays `core` for `frames` samples, in blocks like the AudioWorklet. */
function run(core: WavetableCore, queue: NoteQueue, frames: number): { left: Float32Array; right: Float32Array } {
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
  const core = new WavetableCore(SR);
  core.setTempo(bpm);
  core.setParams(resolveParams(WAVETABLE, params));
  return { core, queue: new NoteQueue() };
};

const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
};

/** The amplitude of the component at `hz` (DFT over a Hann window). */
function amplitudeAt(x: ArrayLike<number>, hz: number, from: number, length: number, sr = SR): number {
  let re = 0, im = 0, w = 0;
  for (let i = 0; i < length; i++) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length), ph = (2 * Math.PI * hz * i) / sr;
    re += x[from + i] * win * Math.cos(ph);
    im += x[from + i] * win * Math.sin(ph);
    w += win;
  }
  return (2 * Math.hypot(re, im)) / w;
}

/** The amplitude of harmonic `k` of a table period (exact DFT). */
function harmonic(table: Float32Array, at: number, k: number): number {
  let re = 0, im = 0;
  for (let i = 0; i < TABLE_SIZE; i++) {
    const ph = (2 * Math.PI * k * i) / TABLE_SIZE;
    re += table[at + i] * Math.cos(ph);
    im += table[at + i] * Math.sin(ph);
  }
  return (2 * Math.hypot(re, im)) / TABLE_SIZE;
}

/** Oscillator A alone, without filter or colours. */
const BARE = { levelA: 100, levelB: 0, sub: 0, unison: 1, cutoff: 20000, resonance: 0, keyTrack: 0, velocity: 0, volume: 0, attack: 0.001, sustain: 100, release: 0.01 };

describe('Wavetable: parameters', () => {
  it('each parameter has a single id and a valid default', () => {
    const r = resolveParams(WAVETABLE, {});
    expect(Object.keys(r)).toHaveLength(paramsOf(WAVETABLE).length);
    expect(new Set(paramsOf(WAVETABLE).map(p => p.id)).size).toBe(paramsOf(WAVETABLE).length);
  });

  it('the presets use only existing parameters, within their limits', () => {
    for (const preset of WAVETABLE.presets) {
      for (const [id, v] of Object.entries(preset.params)) {
        const spec = paramSpec(WAVETABLE, id);
        expect(spec, `${preset.name}.${id}`).toBeDefined();
        expect(clampParam(spec!, v), `${preset.name}.${id}`).toBeCloseTo(v, 9);
      }
    }
  });
});

describe('Wavetable: tables', () => {
  it('each shape reaches ±1 and closes the period', () => {
    for (let t = 0; t < TABLES.length; t++) {
      const w = wavetable(t);
      expect(w.length).toBe(FRAMES * LEVELS * STRIDE);
      for (let f = 0; f < FRAMES; f++) {
        const at = f * LEVELS * STRIDE;
        let peak = 0;
        for (let i = 0; i < TABLE_SIZE; i++) peak = Math.max(peak, Math.abs(w[at + i]));
        expect(peak, `${TABLES[t].name} ${f}`).toBeCloseTo(1, 4);
        expect(w[at + TABLE_SIZE]).toBe(w[at]);
      }
    }
  });

  it('the per-octave versions have no harmonics beyond their limit', () => {
    const w = wavetable(TABLE.Sync), f = 7; // a sync at 4.27×: all the harmonics
    for (const level of [3, 6, 9]) {
      const at = (f * LEVELS + level) * STRIDE, h = maxHarmonic(level);
      expect(harmonic(w, at, h)).toBeGreaterThan(1e-4);
      expect(harmonic(w, at, h + 1)).toBeLessThan(1e-6);
      expect(harmonic(w, at, 2 * h + 3)).toBeLessThan(1e-6);
    }
  });

  it('the chosen version keeps all the harmonics below Nyquist', () => {
    for (const hz of [27.5, 110, 440, 1760, 7040, 15000]) {
      const dt = hz / SR, level = levelFor(dt);
      expect(maxHarmonic(level) * hz, `${hz} Hz`).toBeLessThanOrEqual(SR / 2);
      // and it doesn't throw away more than an octave of them
      if (level > 0) expect(maxHarmonic(level - 1) * hz).toBeGreaterThan(SR / 2);
    }
  });

  it('Base: at the start a sine, at two thirds a saw', () => {
    const w = wavetable(TABLE.Basic);
    const sine = 0, saw = 10 * LEVELS * STRIDE; // shape 10 of 15 = position 2/3
    expect(harmonic(w, sine, 2)).toBeLessThan(1e-6);
    expect(harmonic(w, saw, 2) / harmonic(w, saw, 1)).toBeCloseTo(0.5, 2);
    expect(harmonic(w, saw, 7) / harmonic(w, saw, 1)).toBeCloseTo(1 / 7, 2);
  });
});

describe('Wavetable: sound', () => {
  it('plays the right note, with the position\'s timbre', () => {
    const play = (posA: number) => {
      const { core, queue } = synth({ ...BARE, tableA: TABLE.Basic, posA });
      queue.add(57, 100, 0, SR);
      return run(core, queue, SR / 2).left;
    };
    const f = midiToHz(57);
    const sine = play(0), saw = play(67);
    expect(amplitudeAt(sine, f, 4800, 9600)).toBeGreaterThan(0.9);
    expect(amplitudeAt(sine, 2 * f, 4800, 9600)).toBeLessThan(0.01);
    const s1 = amplitudeAt(saw, f, 4800, 9600);
    expect(amplitudeAt(saw, 2 * f, 4800, 9600) / s1).toBeCloseTo(0.5, 1);
  });

  it('high notes don\'t alias', () => {
    const { core, queue } = synth({ ...BARE, tableA: TABLE.Sync, posA: 47 }); // sync at 4.3×: all the harmonics
    const pitch = 100, f = midiToHz(pitch); // 2637 Hz: already the tenth harmonic is above Nyquist
    queue.add(pitch, 100, 0, SR);
    const { left } = run(core, queue, SR / 2);
    const fundamental = amplitudeAt(left, f, 4800, 16384);
    for (let k = 10; k <= 20; k++) {
      const folded = Math.abs(SR - k * f) % SR;
      const alias = Math.min(folded, SR - folded);
      expect(amplitudeAt(left, alias, 4800, 16384) / fundamental, `harmonic ${k} → ${alias.toFixed(0)} Hz`).toBeLessThan(0.003);
    }
  });

  it("the modulation envelope moves the position: the timbre changes while the note plays", () => {
    const { core, queue } = synth({ ...BARE, tableA: TABLE.Basic, posA: 0, mDecay: 1, mSustain: 0, envDest: MOD_DEST.posA, envAmount: 67 });
    queue.add(57, 100, 0, SR);
    const { left } = run(core, queue, SR);
    const f = midiToHz(57);
    const bright = (from: number) => amplitudeAt(left, 2 * f, from, 2048) / amplitudeAt(left, f, from, 2048);
    expect(bright(300)).toBeGreaterThan(0.2); // at the attack the saw
    expect(bright(SR / 2)).toBeLessThan(0.01); // then back to the sine
  });

  it('the sub plays one or two octaves below', () => {
    const play = (subOctave: number) => {
      const { core, queue } = synth({ ...BARE, levelA: 0, sub: 100, subOctave });
      queue.add(57, 100, 0, SR);
      return run(core, queue, SR / 2).left;
    };
    const f = midiToHz(57);
    expect(amplitudeAt(play(0), f / 2, 4800, 16384)).toBeGreaterThan(0.9);
    expect(amplitudeAt(play(1), f / 4, 4800, 16384)).toBeGreaterThan(0.9);
  });

  it("the unison spreads the stereo without raising the level; alone the copy is in the centre", () => {
    const one = synth({ ...BARE, posA: 67 }), seven = synth({ ...BARE, posA: 67, unison: 7, detune: 30, spread: 100 });
    const m = (s: typeof one) => { s.queue.add(57, 100, 0, SR); return run(s.core, s.queue, SR / 2); };
    const a = m(one), b = m(seven);
    expect(a.left).toEqual(a.right);
    let diff = 0;
    for (let i = 4800; i < 24000; i++) diff += (b.left[i] - b.right[i]) ** 2;
    expect(Math.sqrt(diff / 19200)).toBeGreaterThan(0.1);
    const level = (x: { left: Float32Array; right: Float32Array }) => Math.hypot(rms(x.left, 4800), rms(x.right, 4800));
    expect(Math.abs(20 * Math.log10(level(b) / level(a)))).toBeLessThan(3);
  });

  it('with "Positions" the copies read different shapes of the table', () => {
    const play = (posSpread: number) => {
      const { core, queue } = synth({ ...BARE, tableA: TABLE.Basic, posA: 0, unison: 5, detune: 0, spread: 0, posSpread });
      queue.add(57, 100, 0, SR);
      return run(core, queue, SR / 2).left;
    };
    const f = midiToHz(57);
    // without: five sines together; with: half of the copies go towards the triangle (the third harmonic)
    expect(amplitudeAt(play(0), 3 * f, 4800, 9600)).toBeLessThan(1e-3);
    expect(amplitudeAt(play(100), 3 * f, 4800, 9600)).toBeGreaterThan(0.02);
  });

  it("the LFO is synced: a 1/4 square on the volume at 120 BPM opens and closes every half second", () => {
    const lfo = { lfo1Shape: LFO_SHAPE.square, lfo1Sync: LFO_SYNC.tempo, lfo1Division: TEMPO_RATE['1/4'], lfo1Dest: MOD_DEST.volume, lfo1Amount: 100 };
    const { core, queue } = synth({ ...BARE, ...lfo });
    queue.add(57, 100, 0, 2 * SR);
    const { left } = run(core, queue, 2 * SR);
    const half = SR / 4;
    for (let k = 0; k < 4; k++) {
      const on = rms(left, k * 2 * half + 600, (k * 2 + 1) * half - 600);
      const off = rms(left, (k * 2 + 1) * half + 600, (k * 2 + 2) * half - 600);
      expect(on).toBeGreaterThan(0.5);
      expect(off).toBeLessThan(on * 0.01);
    }
  });

  it('in Legato overlapping notes slide on a single voice', () => {
    const { core, queue } = synth({ ...BARE, voiceMode: VOICE_MODE.legato, glide: 30, attack: 0.2 });
    queue.add(45, 100, 0, SR / 2 + 100);
    queue.add(57, 100, SR / 2, SR);
    const { left } = run(core, queue, SR);
    expect(core.activeVoices).toBe(1);
    expect(rms(left, SR / 2, SR / 2 + 2400)).toBeGreaterThan(0.5); // the slow attack doesn't restart
    expect(amplitudeAt(left, midiToHz(57), SR / 2 + 7200, 9600)).toBeGreaterThan(0.9);
  });

  it('after the release it dies out; stop: silence in a few milliseconds', () => {
    const { core, queue } = synth({ ...BARE, release: 0.1 });
    queue.add(60, 100, 0, 4800);
    const { left } = run(core, queue, SR);
    expect(rms(left, 2400, 4800)).toBeGreaterThan(0.3);
    expect(rms(left, 4800 + 0.2 * SR)).toBe(0);
    expect(core.activeVoices).toBe(0);

    const held = synth({ release: 3 });
    for (const p of [48, 52, 55]) held.queue.add(p, 100, 0, 10 * SR);
    run(held.core, held.queue, 4800);
    held.queue.clear();
    held.core.silence();
    expect(rms(run(held.core, held.queue, 4800).left, 0.03 * SR)).toBe(0);
  });

  it('the presets play without exploding and end after the release', () => {
    for (const preset of WAVETABLE.presets) {
      const { core, queue } = synth(preset.params);
      for (const p of [48, 55, 64]) queue.add(p, 110, 0, SR / 2);
      const frames = 4 * SR;
      const { left, right } = run(core, queue, frames);
      let peak = 0;
      for (let i = 0; i < frames; i++) {
        expect(Number.isFinite(left[i]) && Number.isFinite(right[i])).toBe(true);
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      }
      expect(peak, preset.name).toBeGreaterThan(0.02);
      expect(peak, preset.name).toBeLessThan(2);
      expect(rms(left, frames - 4800), preset.name).toBeLessThan(1e-4);
    }
  });

  it('it costs little: ten seconds of four notes with seven copies, two oscillators, in less than a second', () => {
    const { core, queue } = synth({ ...WAVETABLE.presets.find(p => p.name === 'Breathing pad')!.params, unison: 7 });
    for (const p of [48, 55, 60, 64]) queue.add(p, 100, 0, 10 * SR);
    run(core, queue, SR / 10); // the tables are computed at the first note
    const t = performance.now();
    run(core, queue, 10 * SR);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});
