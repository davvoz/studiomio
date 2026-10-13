import { describe, expect, it } from 'vitest';
import { ANALOG } from '../../src/instruments/analog/analog';
import { AnalogCore } from '../../src/instruments/analog/analog-core';
import { paramsOf, paramSpec, resolveParams } from '../../src/instruments/instrument-type';
import { clampParam, formatParam, paramFromUnit, paramToUnit } from '../../src/instruments/params';
import { NoteQueue } from '../../src/instruments/worklet/note-queue';

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
