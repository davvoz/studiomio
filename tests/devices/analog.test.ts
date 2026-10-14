import { describe, expect, it } from 'vitest';
import { ANALOG, VOICE_MODE } from '../../src/devices/instruments/analog/analog';
import { AnalogCore } from '../../src/devices/instruments/analog/analog-core';
import { paramsOf, paramSpec, resolveParams } from '../../src/devices/device-type';
import { clampParam, formatParam, paramFromUnit, paramToUnit } from '../../src/devices/params';
import { NoteQueue } from '../../src/devices/worklet/note-queue';

const SR = 48000, BLOCK = 128;

/** Fa suonare `core` per `frames` campioni, a blocchi come l'AudioWorklet. */
function run(core: AnalogCore, queue: NoteQueue, frames: number, start = 0): Float32Array {
  const out = new Float32Array(frames), right = new Float32Array(BLOCK);
  for (let f = 0; f < frames; f += BLOCK) {
    const left = new Float32Array(BLOCK);
    right.fill(0);
    queue.renderBlock(core, left, right, start + f);
    out.set(left.subarray(0, Math.min(BLOCK, frames - f)), f);
  }
  return out;
}

const synth = (params: Record<string, number> = {}) => {
  const core = new AnalogCore(SR);
  core.setParams(resolveParams(ANALOG, params));
  return { core, queue: new NoteQueue() };
};

/** Seno puro, senza filtro né inviluppi che colorano. */
const PURE = { oscA: 3, mix: 0, cutoff: 20000, filterEnv: 0, keyTrack: 0, attack: 0.001, sustain: 100, velocity: 0, volume: 0 };

const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
};

describe('parametri', () => {
  const cutoff = paramSpec(ANALOG, 'cutoff')!;
  const wave = paramSpec(ANALOG, 'oscA')!;

  it('scala logaritmica, limiti, passi e formato', () => {
    expect(paramToUnit(cutoff, 20)).toBe(0);
    expect(paramToUnit(cutoff, 20000)).toBe(1);
    expect(paramFromUnit(cutoff, 0.5)).toBeCloseTo(Math.sqrt(20 * 20000), 6); // metà manopola = metà delle ottave
    expect(paramFromUnit(cutoff, paramToUnit(cutoff, 1234))).toBeCloseTo(1234, 6);
    expect(clampParam(cutoff, 99999)).toBe(20000);
    expect(clampParam(paramSpec(ANALOG, 'oscBSemi')!, 3.4)).toBe(3);
    expect(formatParam(cutoff, 2400)).toBe('2.40 kHz');
    expect(formatParam(paramSpec(ANALOG, 'attack')!, 0.05)).toBe('50 ms');
    expect(formatParam(wave, 2)).toBe('Triangle');
    expect(clampParam(wave, 7)).toBe(3);
  });

  it('valori mancanti → predefiniti; valori fuori range → limitati', () => {
    const r = resolveParams(ANALOG, { cutoff: 5, unknown: 3 });
    expect(r.cutoff).toBe(20);
    expect(r.resonance).toBe(20);
    expect('unknown' in r).toBe(false);
    expect(Object.keys(r)).toHaveLength(paramsOf(ANALOG).length);
  });

  it('i preset usano solo parametri esistenti, nei loro limiti', () => {
    for (const preset of ANALOG.presets) {
      for (const [id, v] of Object.entries(preset.params)) {
        const spec = paramSpec(ANALOG, id);
        expect(spec, `${preset.name}.${id}`).toBeDefined();
        expect(clampParam(spec!, v), `${preset.name}.${id}`).toBeCloseTo(v, 9);
      }
    }
  });
});

describe('Analog', () => {
  it('la nota parte esattamente al campione programmato, anche a metà blocco', () => {
    const { core, queue } = synth(PURE);
    queue.add(69, 100, 1000, 5000);
    const out = run(core, queue, 2000);
    expect(out.subarray(0, 1000).every(v => v === 0)).toBe(true);
    expect(out[1001]).not.toBe(0);
  });

  it('intonazione: un La4 è a 440 Hz', () => {
    const { core, queue } = synth(PURE);
    queue.add(69, 100, 0, SR);
    const out = run(core, queue, SR / 2);
    let crossings = 0;
    for (let i = SR / 10 + 1; i < out.length; i++) if (out[i - 1] < 0 && out[i] >= 0) crossings++;
    expect(crossings / (out.length / SR - 0.1)).toBeCloseTo(440, -0.5);
  });

  it('dopo il rilascio il suono si spegne e la voce si libera', () => {
    const { core, queue } = synth({ ...PURE, release: 0.1 });
    queue.add(60, 100, 0, 4800);
    const out = run(core, queue, SR);
    expect(rms(out, 2400, 4800)).toBeGreaterThan(0.3);
    expect(rms(out, 4800 + 0.2 * SR, SR)).toBe(0); // 60 dB in 0.1 s, silenzio vero a −100 dB
    expect(core.activeVoices).toBe(0);
  });

  it('16 voci: la diciassettesima ruba la più vecchia, nessun NaN', () => {
    const { core, queue } = synth();
    for (let k = 0; k < 17; k++) queue.add(48 + k, 100, k * 64, SR);
    const out = run(core, queue, SR / 4);
    expect(core.activeVoices).toBe(16);
    expect(out.every(Number.isFinite)).toBe(true);
    expect(Math.max(...out.map(Math.abs))).toBeLessThan(4);
  });

  it('il filtro passa-basso toglie gli acuti', () => {
    const brightness = (cutoff: number) => {
      const { core, queue } = synth({ oscA: 0, mix: 0, cutoff, filterEnv: 0, keyTrack: 0, resonance: 0, sustain: 100, volume: 0 });
      queue.add(48, 100, 0, SR);
      const out = run(core, queue, SR / 4);
      const diff = out.map((v, i) => (i ? v - out[i - 1] : 0));
      return rms(diff) / rms(out);
    };
    expect(brightness(300)).toBeLessThan(brightness(8000) / 3);
  });

  it('stop: tutto in silenzio in pochi millisecondi', () => {
    const { core, queue } = synth({ release: 3 });
    queue.add(60, 100, 0, SR * 10);
    queue.add(64, 100, 0, SR * 10);
    run(core, queue, 4800);
    queue.clear();
    core.silence();
    const after = run(core, queue, 4800, 4800);
    expect(rms(after, 0.03 * SR)).toBe(0);
    expect(core.activeVoices).toBe(0);
  });

  it('cambiare i parametri mentre suona non crea discontinuità nel volume', () => {
    const { core, queue } = synth(PURE);
    queue.add(69, 100, 0, SR);
    run(core, queue, 4800);
    core.setParams(resolveParams(ANALOG, { ...PURE, volume: -24 }));
    const out = run(core, queue, 256, 4800);
    // il guadagno scende gradualmente: i primi campioni sono ancora quasi pieni
    expect(Math.max(...out.subarray(0, 32).map(Math.abs))).toBeGreaterThan(0.5);
  });
});

/** Frequenza dai passaggi per lo zero in [from, to). */
const frequency = (x: Float32Array, from: number, to: number) => {
  let first = -1, last = -1, n = 0;
  for (let i = from + 1; i < to; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      if (first < 0) first = i;
      else n++;
      last = i;
    }
  }
  return n ? (n * SR) / (last - first) : 0;
};

describe('Analog a una voce: legato, glide, accento', () => {
  it('Legato: due note sovrapposte scivolano senza ripartire, su una voce sola', () => {
    const { core, queue } = synth({ ...PURE, voiceMode: VOICE_MODE.legato, glide: 40, decay: 0.05, sustain: 50 });
    queue.add(57, 100, 0, 9600); // La3 220 Hz, tenuta fin dentro la nota dopo
    queue.add(69, 100, 7200, 14400); // La4 440 Hz
    const out = run(core, queue, 14400);
    expect(core.activeVoices).toBe(1);
    expect(frequency(out, 2400, 7000)).toBeCloseTo(220, -0.5);
    expect(frequency(out, 7200 + 0.1 * SR, 14000)).toBeCloseTo(440, -0.5);
    // a metà del glide l'intonazione sta in mezzo
    const mid = frequency(out, 7200 + 0.004 * SR, 7200 + 0.016 * SR);
    expect(mid).toBeGreaterThan(240);
    expect(mid).toBeLessThan(420);
    // gli inviluppi non ripartono: il livello resta quello del sustain, niente nuovo attacco
    expect(rms(out, 7200, 7200 + 480)).toBeCloseTo(rms(out, 6000, 7200), 1);
  });

  it('Legato: note staccate ripartono da capo, senza glide', () => {
    const { core, queue } = synth({ ...PURE, voiceMode: VOICE_MODE.legato, glide: 200, decay: 0.05, sustain: 50 });
    queue.add(57, 100, 0, 4800);
    queue.add(69, 100, 7200, 14400);
    const out = run(core, queue, 14400);
    expect(frequency(out, 7200 + 0.002 * SR, 7200 + 0.03 * SR)).toBeCloseTo(440, -0.5);
    // l'attacco riparte: il livello all'inizio della seconda nota è sopra il sustain
    expect(rms(out, 7200, 7200 + 480)).toBeGreaterThan(rms(out, 12000, 14000) * 1.3);
  });

  it('Mono: ogni nota riparte, il glide parte dalla nota di prima', () => {
    const { core, queue } = synth({ ...PURE, voiceMode: VOICE_MODE.mono, glide: 100 });
    queue.add(57, 100, 0, 4800);
    queue.add(69, 100, 7200, 24000);
    const out = run(core, queue, 24000);
    expect(frequency(out, 7200 + 0.003 * SR, 7200 + 0.02 * SR)).toBeLessThan(400);
    expect(frequency(out, 7200 + 0.25 * SR, 24000)).toBeCloseTo(440, -0.5);
    expect(core.activeVoices).toBe(1);
  });

  it('accento: le note oltre velocity 100 suonano più forti e più aperte', () => {
    const play = (accent: number, velocity: number) => {
      const { core, queue } = synth({ oscA: 0, mix: 0, cutoff: 300, resonance: 50, filterEnv: 30, keyTrack: 0, sustain: 100, velocity: 0, volume: 0,
        voiceMode: VOICE_MODE.legato, accent });
      queue.add(45, velocity, 0, 4800);
      const out = run(core, queue, 4800);
      const diff = out.map((v, i) => (i ? v - out[i - 1] : 0));
      return { level: rms(out, 0, 2400), bright: rms(diff, 0, 2400) / rms(out, 0, 2400) };
    };
    const plain = play(100, 90), accented = play(100, 127), off = play(0, 127);
    expect(accented.level).toBeGreaterThan(plain.level * 1.4);
    expect(accented.bright).toBeGreaterThan(plain.bright * 1.5);
    expect(off.level).toBeCloseTo(plain.level, 2); // senza accento la velocity alta non cambia nulla
  });

  it('passare da poli a una voce ferma quello che suona e riparte pulito', () => {
    const { core, queue } = synth();
    for (const p of [48, 52, 55]) queue.add(p, 100, 0, SR);
    run(core, queue, 4800);
    core.setParams(resolveParams(ANALOG, { voiceMode: VOICE_MODE.mono }));
    queue.add(60, 100, 4800 + 2400, 4800 + 9600);
    const out = run(core, queue, 4800, 4800);
    expect(core.activeVoices).toBe(1); // le tre di prima sono sfumate, suona solo la nuova
    expect(out.every(Number.isFinite)).toBe(true);
  });
});

describe('Analog: unison', () => {
  /** Fa suonare a blocchi e restituisce i due canali. */
  const stereo = (params: Record<string, number>, pitch = 57) => {
    const { core, queue } = synth({ oscA: 0, mix: 0, cutoff: 20000, filterEnv: 0, keyTrack: 0, sustain: 100, velocity: 0, volume: 0, ...params });
    queue.add(pitch, 100, 0, SR);
    const l = new Float32Array(SR / 2), r = new Float32Array(SR / 2);
    for (let f = 0; f < l.length; f += BLOCK) {
      const a = new Float32Array(BLOCK), b = new Float32Array(BLOCK);
      queue.renderBlock(core, a, b, f);
      l.set(a.subarray(0, Math.min(BLOCK, l.length - f)), f);
      r.set(b.subarray(0, Math.min(BLOCK, l.length - f)), f);
    }
    return { l, r };
  };
  const corr = (a: Float32Array, b: Float32Array) => {
    let ab = 0, aa = 0, bb = 0;
    for (let i = 4800; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
    return ab / Math.sqrt(aa * bb);
  };

  it('sette copie aperte: lo stereo si allarga, il livello resta quello di una', () => {
    const one = stereo({ unison: 1 }), seven = stereo({ unison: 7, detune: 30, spread: 100 });
    expect(corr(one.l, one.r)).toBeCloseTo(1, 6);
    expect(corr(seven.l, seven.r)).toBeLessThan(0.8);
    const level = (x: { l: Float32Array; r: Float32Array }) => Math.hypot(rms(x.l, 4800), rms(x.r, 4800));
    expect(Math.abs(20 * Math.log10(level(seven) / level(one)))).toBeLessThan(3);
    expect(seven.l.every(Number.isFinite)).toBe(true);
  });

  it('senza apertura resta al centro; la scordatura allarga la nota attorno alla sua altezza', () => {
    const narrow = stereo({ unison: 5, detune: 30, spread: 0 });
    expect(corr(narrow.l, narrow.r)).toBeCloseTo(1, 4);
    // le copie scordate battono tra loro: il volume a breve termine ondeggia (con una sola è piatto)
    const wobble = (x: Float32Array) => {
      const w = 2182, levels: number[] = []; // dieci periodi esatti di 220 Hz
      for (let i = 4800; i + w <= x.length; i += w) levels.push(rms(x, i, i + w));
      const mean = levels.reduce((a, b) => a + b) / levels.length;
      return Math.sqrt(levels.reduce((a, b) => a + (b - mean) ** 2, 0) / levels.length) / mean;
    };
    expect(wobble(stereo({ unison: 1 }).l)).toBeLessThan(0.01);
    expect(wobble(narrow.l)).toBeGreaterThan(0.08);
  });
});

describe('NoteQueue', () => {
  it('a parità di campione lo spegnimento viene prima dell\'accensione', () => {
    const calls: string[] = [];
    const core = {
      setParams() {}, silence() {}, render() {},
      noteOn: (id: number) => calls.push(`on${id}`),
      noteOff: (id: number) => calls.push(`off${id}`),
    };
    const q = new NoteQueue();
    q.add(60, 100, 100, 200);
    q.add(60, 100, 200, 300);
    q.renderBlock(core, new Float32Array(400), new Float32Array(400), 0);
    expect(calls).toEqual(['on1', 'off1', 'on2', 'off2']);
    expect(q.size).toBe(0);
  });
});
