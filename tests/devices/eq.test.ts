import { describe, expect, it } from 'vitest';
import { paramActive, paramSpec, resolveParams } from '../../src/devices/device-type';
import { BAND, bandParam, bandsOf, EQ } from '../../src/devices/effects/eq/eq';
import { EqCore } from '../../src/devices/effects/eq/eq-core';
import { bandResponseDb, butterworthQs, responseDb } from '../../src/devices/effects/eq/eq-math';

const SR = 48000, BLOCK = 128;

/** Elabora `input` (mono, uguale sui due canali) a blocchi; restituisce il canale sinistro. */
function run(core: EqCore, input: Float32Array, onBlock?: (frame: number) => void): Float32Array {
  const out = new Float32Array(input.length);
  for (let f = 0; f < input.length; f += BLOCK) {
    onBlock?.(f);
    const n = Math.min(BLOCK, input.length - f);
    const inL = input.slice(f, f + n), l = new Float32Array(n), r = new Float32Array(n);
    core.process(inL, inL, l, r, n);
    out.set(l, f);
  }
  return out;
}

const impulse = (n: number) => Object.assign(new Float32Array(n), { 0: 1 });

/** |H(f)| in dB dalla risposta all'impulso (DFT a una frequenza). */
function measuredDb(h: Float32Array, freq: number): number {
  let re = 0, im = 0;
  const w = (2 * Math.PI * freq) / SR;
  for (let n = 0; n < h.length; n++) {
    re += h[n] * Math.cos(w * n);
    im -= h[n] * Math.sin(w * n);
  }
  return 10 * Math.log10(re * re + im * im);
}

/** Parametri con una sola banda (la 3) e le altre spente. */
function oneBand(band: Record<string, number>): Record<string, number> {
  const p: Record<string, number> = {};
  for (let i = 0; i < 8; i++) p[bandParam(i, 'on')] = 0;
  p[bandParam(2, 'on')] = 1;
  for (const [k, v] of Object.entries(band)) p[`b3${k}`] = v;
  return p;
}

const eq = (params: Record<string, number>) => {
  const core = new EqCore(SR);
  core.setParams(resolveParams(EQ, params));
  return core;
};

const FREQS = [30, 60, 100, 200, 500, 1000, 2000, 5000, 10000, 16000];

describe('EQ', () => {
  it.each([
    ['campana +6 dB a 1 kHz', { type: BAND.bell, freq: 1000, gain: 6, q: 1 }],
    ['campana −12 dB stretta', { type: BAND.bell, freq: 300, gain: -12, q: 6 }],
    ['low shelf −6 dB a 200 Hz', { type: BAND.lowShelf, freq: 200, gain: -6, q: 0.71 }],
    ['high shelf +4 dB a 5 kHz', { type: BAND.highShelf, freq: 5000, gain: 4, q: 1.5 }],
    ['low cut 48 dB a 100 Hz', { type: BAND.lowCut, freq: 100, q: 0.71, slope: 2 }],
    ['high cut 12 dB risonante a 3 kHz', { type: BAND.highCut, freq: 3000, q: 2, slope: 0 }],
    ['notch a 1 kHz', { type: BAND.notch, freq: 1000, q: 2 }],
  ])('il suono è la curva disegnata: %s', (_name, band) => {
    const params = resolveParams(EQ, oneBand(band));
    const h = run(eq(params), impulse(1 << 15));
    for (const f of FREQS) {
      const expected = responseDb(bandsOf(params), 0, f, SR);
      // vicino agli zeri (notch, tagli ripidi) basta essere molto in basso
      if (expected < -40) expect(measuredDb(h, f)).toBeLessThan(-35);
      else expect(measuredDb(h, f)).toBeCloseTo(expected, 1);
    }
  });

  it('le forme: campana al centro, tagli Butterworth a −3 dB e pendenza giusta', () => {
    const band = (o: Record<string, number>) => bandsOf(resolveParams(EQ, oneBand(o)))[2];
    expect(bandResponseDb(band({ type: BAND.bell, freq: 1000, gain: 6 }), 1000, SR)).toBeCloseTo(6, 5);
    expect(bandResponseDb(band({ type: BAND.lowShelf, freq: 200, gain: -6 }), 25, SR)).toBeCloseTo(-6, 1);
    for (const slope of [0, 1, 2]) {
      const cut = band({ type: BAND.lowCut, freq: 1000, q: Math.SQRT1_2, slope });
      expect(bandResponseDb(cut, 1000, SR)).toBeCloseTo(-3.01, 1);
      // un'ottava sotto: circa 12, 24, 48 dB in meno
      expect(bandResponseDb(cut, 250, SR) - bandResponseDb(cut, 500, SR)).toBeCloseTo(-12 * [1, 2, 4][slope], 0);
    }
    expect(butterworthQs(2).map(q => +q.toFixed(3))).toEqual([0.541, 1.307]);
  });

  it('appena aggiunto non cambia il suono; l\'uscita è un guadagno', () => {
    const x = Float32Array.from({ length: 4096 }, (_, i) => Math.sin(i * 0.05) * 0.5);
    const y = run(eq({}), x);
    expect(Math.max(...y.map((v, i) => Math.abs(v - x[i])))).toBeLessThan(1e-6);
    const z = run(eq({ output: -6 }), x);
    expect(z[1000] / x[1000]).toBeCloseTo(0.501, 3);
    expect(responseDb(bandsOf(resolveParams(EQ, {})), 0, 1234, SR)).toBe(0);
  });

  it('trascinare un punto non fa scatti: il guadagno scorre, la banda si accende in dissolvenza', () => {
    const core = eq(oneBand({ type: BAND.bell, freq: 1000, gain: 0 }));
    const x = Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / SR) * 0.5);
    const y = run(core, x, f => {
      if (f === 4992) core.setParams(resolveParams(EQ, oneBand({ type: BAND.bell, freq: 1000, gain: 12 })));
      if (f === 24960) core.setParams(resolveParams(EQ, { ...oneBand({ type: BAND.bell, freq: 1000, gain: 12 }), b3on: 0 }));
    });
    // il passo massimo tra due campioni resta quello di un seno (2π·f/fs·ampiezza) anche durante i cambi
    let jump = 0;
    for (let i = 1; i < y.length; i++) jump = Math.max(jump, Math.abs(y[i] - y[i - 1]));
    expect(jump).toBeLessThan((2 * Math.PI * 1000 / SR) * 0.5 * 4 * 1.05);
    const amp = (from: number) => Math.max(...y.subarray(from, from + 480).map(Math.abs));
    expect(amp(20000)).toBeCloseTo(0.5 * 4, 1); // +12 dB
    expect(amp(40000)).toBeCloseTo(0.5, 2); // spenta
  });

  it('guadagno solo per shelf e campane, pendenza solo per i tagli', () => {
    const values = (type: number) => resolveParams(EQ, { b1type: type });
    const gain = paramSpec(EQ, 'b1gain')!, slope = paramSpec(EQ, 'b1slope')!;
    expect([BAND.lowCut, BAND.bell, BAND.notch, BAND.highShelf].map(t => paramActive(gain, values(t)))).toEqual([false, true, false, true]);
    expect([BAND.lowCut, BAND.bell, BAND.highCut].map(t => paramActive(slope, values(t)))).toEqual([true, false, true]);
  });

  it('i preset usano solo parametri che esistono', () => {
    const ids = new Set(EQ.sections.flatMap(s => s.params.map(p => p.id)));
    for (const p of EQ.presets) for (const id of Object.keys(p.params)) expect(ids.has(id), `${p.name}: ${id}`).toBe(true);
  });
});
