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

describe('Sampler: zone', () => {
  /** Un Sampler con un sample per zona (in ordine) e i parametri. */
  const zoned = (samples: readonly (SampleData | null)[], params: Record<string, number> = {}) => {
    const core = new SamplerCore(SR);
    core.setParams(resolveParams(SAMPLER, { volume: 0, velocity: 0, ...params }));
    samples.forEach((s, i) => core.setSample(zoneSlot(i), s));
    return { core, queue: new NoteQueue() };
  };
  const level = (x: number) => steps([x], 1);
  /** Il livello che suona `pitch` (poco dopo l'attacco). */
  const heard = (samples: readonly (SampleData | null)[], params: Record<string, number>, pitch: number, velocity = 100) => {
    const { core, queue } = zoned(samples, params);
    queue.add(pitch, velocity, 0, SR);
    return run(core, queue, 4000).left[2000];
  };

  it('la prima zona usa i parametri e il posto del sample singolo; tutti i parametri esistono', () => {
    expect(zoneSlot(0)).toBe(SAMPLE_SLOT);
    expect(zoneSlot(1)).toBe('z2');
    expect(zoneParam(0, 'root')).toBe('root');
    expect(zoneParam(0, 'start')).toBe('start');
    expect(zoneParam(0, 'lo')).toBe('z1lo');
    expect(zoneParam(2, 'loopEnd')).toBe('z3loopEnd');
    const keys: ZoneKey[] = ['lo', 'hi', 'vlo', 'vhi', 'root', 'gain', 'pan', 'start', 'end', 'loopStart', 'loopEnd'];
    for (let i = 0; i < MAX_ZONES; i++) for (const k of keys) expect(paramSpec(SAMPLER, zoneParam(i, k)), `${i} ${k}`).toBeDefined();
    // il suono: quello della prima zona sono i parametri del Sampler
    expect(zoneParam(0, 'e1R')).toBe('e1R');
    expect(zoneParam(3, 'e1R')).toBe('z4e1R');
    for (let i = 1; i < MAX_ZONES; i++) {
      for (const k of ['own', ...SOUND_KEYS] as const) expect(paramSpec(SAMPLER, zoneParam(i, k)), `${i} ${k}`).toBeDefined();
      expect(Object.keys(zoneDefaults(i))).toContain(zoneParam(i, 'loop'));
    }
  });

  it('il suono di una zona è quello della prima finché non diventa suo', () => {
    const v = resolveParams(SAMPLER, { loop: LOOP.forward, e1R: 2, [zoneParam(1, 'e1R')]: 0.1 });
    expect(zoneSource(v, 1, 'e1R')).toBe('e1R');
    expect(zoneSource(v, 1, 'start')).toBe('z2start');
    const own = ownSound(v, 1);
    expect(own).toMatchObject({ [zoneParam(1, 'own')]: 1, [zoneParam(1, 'loop')]: LOOP.forward, [zoneParam(1, 'e1R')]: 2 });
    expect(ownSound({ ...v, ...own }, 1)).toEqual({});
    expect(zoneSource({ ...v, ...own }, 1, 'e1R')).toBe('z2e1R');
  });

  it('loop, reverse e inviluppo del volume: le zone seguono la prima, o hanno i loro', () => {
    const loop = { loop: LOOP.forward, loopStart: 20, loopEnd: 80, e1R: 0.01 };
    const tail = (params: Record<string, number>) => {
      const { core, queue } = zoned([null, sine(440, 0.2)], { ...loop, ...params });
      queue.add(60, 100, 0, SR * 0.5);
      return lastSound(run(core, queue, SR).left);
    };
    // la seconda zona segue la prima: va in loop fino al rilascio
    expect(tail({})).toBeGreaterThan(SR * 0.5);
    // con il suo suono (senza loop) finisce con il sample; con il suo rilascio lungo dura di più
    const own = { [zoneParam(1, 'own')]: 1, [zoneParam(1, 'loopStart')]: 20, [zoneParam(1, 'loopEnd')]: 80 };
    expect(tail(own)).toBeLessThan(SR * 0.2 + 10);
    expect(tail({ ...own, [zoneParam(1, 'loop')]: LOOP.forward, [zoneParam(1, 'e1R')]: 0.01 })).toBeLessThan(SR * 0.55);
    expect(tail({ ...own, [zoneParam(1, 'loop')]: LOOP.forward, [zoneParam(1, 'e1R')]: 0.3 })).toBeGreaterThan(SR * 0.7);
  });

  it('filtro, intonazione e LFO: ogni zona con il suo suono ha i suoi', () => {
    const own = { [zoneParam(1, 'own')]: 1 };
    // il filtro della seconda zona chiude le alte; la prima resta aperta
    const bright = (params: Record<string, number>) => {
      const { core, queue } = zoned([null, sine(3000, 1)], params);
      queue.add(60, 100, 0, SR);
      return rms(run(core, queue, SR / 4).left, SR / 8, SR / 4);
    };
    const closed = { fOn: 1, fType: 1, fCutoff: 200 };
    expect(bright(closed)).toBeLessThan(0.05);
    // con il suo suono il filtro della seconda zona è il suo, spento
    expect(bright({ ...closed, ...own, [zoneParam(1, 'fOn')]: 0 })).toBeGreaterThan(0.2);
    // il Transpose della seconda zona la sposta di un'ottava, la prima no
    const hz = (params: Record<string, number>, pitch: number) => {
      const { core, queue } = zoned([sine(440, 1), sine(440, 1)], { ...zoneKeys(0, 0, 59, 48), ...zoneKeys(1, 60, 127, 60), ...params });
      queue.add(pitch, 100, 0, SR);
      return zeroCrossHz(run(core, queue, 12000).left, 1000, 12000);
    };
    const up = { ...own, [zoneParam(1, 'transpose')]: 12 };
    expect(hz(up, 48)).toBeCloseTo(440, -1);
    expect(hz(up, 60)).toBeCloseTo(880, -1);
    // l'LFO sul volume solo nella seconda zona
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

  it('due zone sulla stessa nota con inviluppi diversi', () => {
    const { core, queue } = zoned([level(0.3), level(0.4)], {
      e1R: 0.01, [zoneParam(1, 'own')]: 1, [zoneParam(1, 'e1A')]: 0.001, [zoneParam(1, 'e1R')]: 0.5, [zoneParam(1, 'e1S')]: 100,
    });
    queue.add(60, 100, 0, SR / 10);
    const out = run(core, queue, SR / 2).left;
    expect(out[2000]).toBeCloseTo(0.7, 2);
    // dopo il rilascio resta solo la seconda, che sfuma piano
    expect(out[SR / 10 + SR * 0.05]).toBeGreaterThan(0.2);
    expect(out[SR / 10 + SR * 0.05]).toBeLessThan(0.4);
  });

  it('i Tune e Fine delle zone di prima vanno nel Transpose e Detune: ogni zona suona come prima', () => {
    // prima: la prima zona +2, la seconda +12.3, la terza niente, la quarta senza sample
    const old = { transpose: -1, z1tune: 2, z2tune: 12, z2fine: 30, z3lo: 40, z4tune: 7 };
    const samples = { [zoneSlot(0)]: 'a', [zoneSlot(1)]: 'b', [zoneSlot(2)]: 'c' };
    const before = (i: number) => old.transpose + ([2, 12.3, 0, 7][i] ?? 0);
    const now = resolveParams(SAMPLER, upgradeZoneTune(old, samples));
    expect(Object.keys(upgradeZoneTune(old, samples)).filter(k => /^z\d+(tune|fine)$/.test(k))).toEqual([]);
    for (const i of [0, 1, 2]) {
      const semis = now[zoneSource(now, i, 'transpose')] + now[zoneSource(now, i, 'detune')] / 100;
      expect(semis, `zona ${i + 1}`).toBeCloseTo(before(i), 6);
    }
    // la zona senza sample non diventa sua per niente
    expect(now[zoneParam(3, 'own')]).toBe(0);
    // senza Tune e Fine non cambia nulla
    const fresh = { transpose: 3 };
    expect(upgradeZoneTune(fresh)).toBe(fresh);
  });

  it('legge la nota scritta nel nome di un file', () => {
    expect(noteInName('Piano C3.wav')).toBe(60);
    expect(noteInName('bass_f#1.aif')).toBe(42);
    expect(noteInName('Vox-Eb2')).toBe(51);
    expect(noteInName('Strings A-1')).toBe(21);
    expect(noteInName('Grand_C2_soft.wav')).toBe(48);
    expect(noteInName('Bd1.wav')).toBeNull();
    expect(noteInName('Kick 808.wav')).toBeNull();
    expect(noteInName('Pad C30')).toBeNull();
  });

  it('divide la tastiera a metà strada tra le note base', () => {
    expect(spreadRanges([60, 48, 72])).toEqual([{ lo: 55, hi: 66 }, { lo: 0, hi: 54 }, { lo: 67, hi: 127 }]);
    expect(spreadRanges([60, 60])).toEqual([{ lo: 0, hi: 127 }, { lo: 0, hi: 127 }]);
  });

  it('più file: sulle note dei nomi se ci sono tutte, se no un tasto ciascuno', () => {
    expect(layoutZones(['Kick.wav', 'Snare.wav'], 36)).toEqual([{ lo: 36, hi: 36, root: 36 }, { lo: 37, hi: 37, root: 37 }]);
    expect(layoutZones(['Piano C2.wav', 'Piano C3.wav'], 36)).toEqual([{ lo: 0, hi: 54, root: 48 }, { lo: 55, hi: 127, root: 60 }]);
    expect(layoutZones(['Piano C2.wav', 'Kick.wav'], 40).map(z => z.lo)).toEqual([40, 41]);
    // un file solo va sul tasto, anche se il nome dice una nota
    expect(layoutZones(['Piano C2.wav'], 40)).toEqual([{ lo: 40, hi: 40, root: 40 }]);
  });

  it('ogni tasto suona la zona che lo contiene; fuori dalle zone tace', () => {
    const params = { ...zoneKeys(0, 36, 36, 36), ...zoneKeys(1, 37, 38, 37) };
    const samples = [level(0.3), level(0.6)];
    expect(heard(samples, params, 36)).toBeCloseTo(0.3, 2);
    expect(heard(samples, params, 38)).toBeCloseTo(0.6, 2);
    expect(heard(samples, params, 39)).toBe(0);
  });

  it('le zone sovrapposte suonano insieme, e lasciata la nota si chiudono tutte', () => {
    const { core, queue } = zoned([level(0.3), level(0.4)], { e1R: 0.01 });
    queue.add(60, 100, 0, SR / 10);
    const out = run(core, queue, SR / 2).left;
    expect(out[2000]).toBeCloseTo(0.7, 2);
    expect(lastSound(out)).toBeLessThan(SR / 10 + SR * 0.05);
  });

  it('le velocity scelgono la zona', () => {
    const params = { [zoneParam(0, 'vhi')]: 63, [zoneParam(1, 'vlo')]: 64 };
    const samples = [level(0.3), level(0.6)];
    expect(heard(samples, params, 60, 40)).toBeCloseTo(0.3, 2);
    expect(heard(samples, params, 60, 100)).toBeCloseTo(0.6, 2);
  });

  it('ogni zona ha la sua nota base, il suo Transpose e il suo volume', () => {
    const params = { ...zoneKeys(0, 0, 59, 48), ...zoneKeys(1, 60, 127, 60), [zoneParam(1, 'own')]: 1, [zoneParam(1, 'transpose')]: 12 };
    for (const [pitch, hz] of [[48, 440], [60, 880], [72, 1760]] as const) {
      const { core, queue } = zoned([sine(440, 1), sine(440, 1)], params);
      queue.add(pitch, 100, 0, SR);
      expect(zeroCrossHz(run(core, queue, 12000).left, 1000, 12000)).toBeCloseTo(hz, -1);
    }
    expect(heard([null, level(0.8)], { [zoneParam(1, 'gain')]: -6 }, 60)).toBeCloseTo(0.4, 2);
  });

  it('inizio e fine sono di ogni zona', () => {
    const { core, queue } = zoned([null, sine(440, 1)], { [zoneParam(1, 'start')]: 50, [zoneParam(1, 'end')]: 60 });
    queue.add(60, 100, 0, SR * 2);
    expect(lastSound(run(core, queue, SR).left)).toBeLessThan(SR * 0.1 + 10);
  });

  it('a una voce sola suona la prima zona, e passando a un\'altra zona cambia sample', () => {
    const { core, queue } = zoned([level(0.3), level(0.6)], { voiceMode: VOICE_MODE.legato, ...zoneKeys(0, 0, 59, 60), ...zoneKeys(1, 60, 127, 60) });
    queue.add(50, 100, 0, SR);
    queue.add(70, 100, 4000, SR);
    const out = run(core, queue, 8000).left;
    expect(out[2000]).toBeCloseTo(0.3, 2);
    expect(out[7000]).toBeCloseTo(0.6, 2);
  });

  it('in Slice suonano solo le fette della prima zona', () => {
    const params = { mode: MODE.slice, sliceBy: SLICE.grid, sliceGrid: 0, ...zoneKeys(1, 0, 127, 60) };
    const { core, queue } = zoned([steps([0.1, 0.2, 0.3, 0.4], 0.4), level(0.6)], params);
    queue.add(FIRST_SLICE_NOTE + 2, 100, 0, SR);
    expect(run(core, queue, 4000).left[2000]).toBeCloseTo(0.3, 2);
  });

  it('i cursori dicono la zona e la frazione del suo sample', () => {
    const { core, queue } = zoned([null, null, sine(440, 1)]);
    queue.add(60, 100, 0, SR);
    run(core, queue, SR / 4);
    const out = new Float32Array(16);
    expect(core.playheads(out)).toBe(1);
    expect(out[0]).toBeCloseTo(2.25, 2);
  });

  it('nel piano roll le zone di un tasto solo hanno il nome del loro sample', () => {
    const v = resolveParams(SAMPLER, { ...zoneKeys(0, 36, 36, 36), ...zoneKeys(1, 38, 38, 38), ...zoneKeys(2, 40, 52, 48) });
    const names = SAMPLER.noteNames!(v, new Map([[zoneSlot(0), 'Kick'], [zoneSlot(1), 'Snare'], [zoneSlot(2), 'Basso']]));
    expect([...names]).toEqual([[36, 'Kick'], [38, 'Snare']]);
  });

  it('i preset non toccano la mappa delle zone, e quelli salvati non la contengono', () => {
    const params = { ...zoneKeys(1, 40, 40, 40), root: 36, fCutoff: 500, start: 10, [zoneParam(1, 'own')]: 1, [zoneParam(1, 'e1R')]: 2 };
    expect(keptOnPreset(SAMPLER, params)).toEqual({ ...zoneKeys(1, 40, 40, 40), root: 36, [zoneParam(1, 'own')]: 1, [zoneParam(1, 'e1R')]: 2 });
    expect(presetParams(SAMPLER, params)).toEqual({ fCutoff: 500, start: 10 });
  });
});
