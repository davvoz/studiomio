import { describe, expect, it } from 'vitest';
import { paramSpec, resolveParams } from '../../src/devices/device-type';
import type { SampleData } from '../../src/devices/dsp/core';
import { instrumentType } from '../../src/devices/registry';
import {
  FIRST_SLICE_NOTE, LOOP, LOOP_RELEASE, MODE, SAMPLE_SLOT, SAMPLER, SLICE, sliceStarts, sliceValues, TRIGGER, VOICE_MODE,
} from '../../src/devices/instruments/sampler/sampler';
import { SamplerCore } from '../../src/devices/instruments/sampler/sampler-core';
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

/** Un Sampler con il sample e i parametri (volume a 0 dB, velocity che non conta). */
const sampler = (sample: SampleData | null, params: Record<string, number> = {}) => {
  const core = new SamplerCore(SR);
  core.setParams(resolveParams(SAMPLER, { volume: 0, velocity: 0, ...params }));
  core.setSample(SAMPLE_SLOT, sample);
  return { core, queue: new NoteQueue() };
};

const sine = (hz: number, seconds: number, sr = SR, amp = 0.5): SampleData =>
  ({ sampleRate: sr, channels: [Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / sr))] });

/** Un sample a scalini: `levels.length` pezzi uguali, ognuno a un livello costante. */
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

describe('Sampler: descrizione', () => {
  it('è tra gli strumenti, e i preset usano solo parametri suoi', () => {
    expect(instrumentType('sampler')).toBe(SAMPLER);
    for (const p of SAMPLER.presets) for (const id of Object.keys(p.params)) expect(paramSpec(SAMPLER, id), `${p.name}: ${id}`).toBeDefined();
  });

  it('le fette in griglia dividono la regione in parti uguali', () => {
    const v = resolveParams(SAMPLER, { mode: MODE.slice, sliceBy: SLICE.grid, sliceGrid: 0, start: 20, end: 60 });
    expect(sliceStarts(v).map(x => +x.toFixed(6))).toEqual([0.2, 0.3, 0.4, 0.5]);
  });

  it('le fette ai transienti partono dall\'inizio e tengono solo quelle dentro la regione, in ordine', () => {
    const v = resolveParams(SAMPLER, { mode: MODE.slice, start: 10, end: 80, ...sliceValues([0.05, 0.6, 0.3, 0.9]) });
    expect(sliceStarts(v)).toEqual([0.1, 0.3, 0.6]);
    expect(SAMPLER.noteNames!(v).get(FIRST_SLICE_NOTE + 2)).toBe('Fetta 3');
    expect(SAMPLER.noteNames!(resolveParams(SAMPLER, {})).size).toBe(0);
  });
});

describe('Sampler: fette ai transienti', () => {
  /** Colpi secchi (rumore che decade) agli istanti dati, in un sample di `seconds`. */
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

  it('trova i colpi (non l\'inizio, che è già la prima fetta), dentro la regione', () => {
    const data = hits([0, 0.5, 1, 1.5], 2);
    const found = findTransients(data, false, 0.5);
    expect(found.map(x => Math.round(x * 4) / 4)).toEqual([0.25, 0.5, 0.75]);
    for (const [x, t] of found.map((x, i) => [x, [0.25, 0.5, 0.75][i]])) expect(Math.abs(x - t)).toBeLessThan(0.01);
    expect(findTransients(data, false, 0.5, 0.3, 1).map(x => Math.round(x * 4) / 4)).toEqual([0.5, 0.75]);
  });

  it('con Reverse li cerca nel sample rovesciato', () => {
    // al contrario un colpo finisce di scatto: gli attacchi sono le fini dei colpi originali
    const found = findTransients(hits([0.2], 1), true, 0.5);
    expect(found.every(x => x > 0.5)).toBe(true);
  });
});

describe('Sampler: suono', () => {
  it('senza sample tace', () => {
    const { core, queue } = sampler(null);
    queue.add(60, 100, 0, 4800);
    expect(rms(run(core, queue, 4800).left)).toBe(0);
  });

  it('alla nota base suona il sample com\'è; un\'ottava sopra va al doppio', () => {
    for (const [pitch, hz] of [[60, 440], [72, 880], [48, 220]] as const) {
      const { core, queue } = sampler(sine(440, 1));
      queue.add(pitch, 100, 0, 24000);
      expect(zeroCrossHz(run(core, queue, 12000).left, 1000, 12000)).toBeCloseTo(hz, -1);
    }
  });

  it('un file a un\'altra frequenza di campionamento resta intonato', () => {
    const { core, queue } = sampler(sine(440, 1, 22050));
    queue.add(60, 100, 0, 24000);
    expect(zeroCrossHz(run(core, queue, 12000).left, 1000, 12000)).toBeCloseTo(440, -1);
  });

  it('con Key track a zero tutti i tasti suonano alla stessa altezza; Transpose la sposta', () => {
    const { core, queue } = sampler(sine(440, 1), { keyTrack: 0, transpose: 12 });
    queue.add(40, 100, 0, 24000);
    expect(zeroCrossHz(run(core, queue, 12000).left, 1000, 12000)).toBeCloseTo(880, -1);
  });

  it('senza loop finisce con la regione anche se la nota è tenuta; Inizio e Fine la scelgono', () => {
    const { core, queue } = sampler(sine(440, 1), { start: 25, end: 50 });
    queue.add(60, 100, 0, SR * 2);
    const out = run(core, queue, SR).left;
    const end = lastSound(out);
    expect(end).toBeGreaterThan(SR * 0.25 - 200);
    expect(end).toBeLessThan(SR * 0.25 + 10);
  });

  it('il loop tiene la nota oltre la fine del sample, e il rilascio la chiude', () => {
    const { core, queue } = sampler(sine(440, 0.2), { loop: LOOP.forward, loopStart: 20, loopEnd: 80, xfade: 20, e1R: 0.05 });
    queue.add(60, 100, 0, SR);
    const out = run(core, queue, SR * 1.5).left;
    expect(rms(out, SR * 0.8, SR * 0.95)).toBeGreaterThan(0.2);
    expect(lastSound(out)).toBeLessThan(SR * 1.2);
  });

  it('il crossfade del loop non fa salti', () => {
    // il loop contiene 29 periodi e mezzo: senza dissolvenza c'è un gradino
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

  it('ping-pong va avanti e indietro e continua a suonare', () => {
    const { core, queue } = sampler(sine(440, 0.1), { loop: LOOP.pingPong, loopStart: 0, loopEnd: 100 });
    queue.add(60, 100, 0, SR);
    const out = run(core, queue, SR * 0.9).left;
    expect(rms(out, SR * 0.6, SR * 0.9)).toBeGreaterThan(0.2);
  });

  it('con "Fino alla fine" lasciata la nota esce dal loop e finisce con il sample', () => {
    const { core, queue } = sampler(sine(440, 0.5), {
      loop: LOOP.forward, loopStart: 0, loopEnd: 20, loopRelease: LOOP_RELEASE.exit, e1R: 10,
    });
    queue.add(60, 100, 0, SR * 0.3);
    const out = run(core, queue, SR * 2).left;
    const end = lastSound(out);
    // dal punto del loop al rilascio mancano meno di 0.5 s di sample: poi tace, nonostante il rilascio lungo
    expect(end).toBeGreaterThan(SR * 0.3);
    expect(end).toBeLessThan(SR * 0.8);
  });

  it('Reverse legge il sample dalla fine', () => {
    const ramp: SampleData = { sampleRate: SR, channels: [Float32Array.from({ length: SR / 10 }, (_, i) => i / (SR / 10))] };
    const { core, queue } = sampler(ramp, { reverse: 1 });
    queue.add(60, 100, 0, SR);
    const out = run(core, queue, SR / 10).left;
    expect(out[200]).toBeGreaterThan(0.9);
    expect(out[SR / 10 - 400]).toBeLessThan(0.2);
  });

  it('One-Shot in Trigger suona tutto anche con una nota corta; in Gate si ferma con la nota', () => {
    const play = (trigger: number) => {
      const { core, queue } = sampler(sine(440, 0.5), { mode: MODE.oneShot, trigger, e1R: 0.01 });
      queue.add(60, 100, 0, 480);
      return lastSound(run(core, queue, SR).left);
    };
    expect(play(TRIGGER.trigger)).toBeGreaterThan(SR * 0.49);
    expect(play(TRIGGER.gate)).toBeLessThan(SR * 0.05);
  });

  it('in Slice ogni nota da C1 suona la sua fetta, le altre tacciono', () => {
    const levels = [0.1, 0.2, 0.3, 0.4];
    const params = { mode: MODE.slice, sliceBy: SLICE.grid, sliceGrid: 0, e1A: 0.001 };
    for (const [k, level] of levels.entries()) {
      const { core, queue } = sampler(steps(levels, 0.4), params);
      queue.add(FIRST_SLICE_NOTE + k, 100, 0, SR);
      const out = run(core, queue, SR / 2).left;
      expect(out[2000]).toBeCloseTo(level, 2);
      // la fetta dura un quarto del sample, poi tace
      expect(lastSound(out)).toBeLessThan(SR * 0.1 + 10);
    }
    const { core, queue } = sampler(steps(levels, 0.4), params);
    queue.add(FIRST_SLICE_NOTE + 4, 100, 0, SR);
    queue.add(FIRST_SLICE_NOTE - 1, 100, 0, SR);
    expect(rms(run(core, queue, SR / 4).left)).toBe(0);
  });

  it('le fette ai transienti usano i punti salvati', () => {
    const { core, queue } = sampler(steps([0.1, 0.5], 0.4), { mode: MODE.slice, ...sliceValues([0.5]) });
    queue.add(FIRST_SLICE_NOTE + 1, 100, 0, SR);
    expect(run(core, queue, 4000).left[2000]).toBeCloseTo(0.5, 2);
  });

  it('il filtro passa-basso toglie le alte', () => {
    const play = (fOn: number) => {
      const { core, queue } = sampler(sine(6000, 0.5), { fOn, fType: 1, fCutoff: 300 });
      queue.add(60, 100, 0, SR);
      return rms(run(core, queue, SR / 4).left, 2000);
    };
    expect(play(1)).toBeLessThan(play(0) * 0.05);
  });

  it('l\'inviluppo del pitch fa cadere l\'intonazione', () => {
    const { core, queue } = sampler(sine(440, 2), { pitchEnv: 12, e3A: 0.001, e3D: 0.3, e3S: 0 });
    queue.add(60, 100, 0, SR * 2);
    const out = run(core, queue, SR).left;
    expect(zeroCrossHz(out, 100, 2500)).toBeGreaterThan(700);
    expect(zeroCrossHz(out, SR * 0.7, SR)).toBeCloseTo(440, -1);
  });

  it('una nota che riparte in Mono non fa click', () => {
    const { core, queue } = sampler(sine(440, 1), { voiceMode: VOICE_MODE.mono });
    queue.add(60, 100, 0, SR);
    // riparte a metà di un'onda, lontano dallo zero
    queue.add(60, 100, 2009, SR);
    const out = run(core, queue, 6000).left;
    const smooth = (2 * Math.PI * 440 * 0.5) / SR;
    expect(maxJump(out, 1900, 2200)).toBeLessThan(smooth * 3);
  });

  it('dice dove leggono le voci che suonano', () => {
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
