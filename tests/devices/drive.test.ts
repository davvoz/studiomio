import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import { Oversampler } from '../../src/devices/dsp/oversampler';
import { DRIVE, SHAPE } from '../../src/devices/effects/drive/drive';
import { DriveCore } from '../../src/devices/effects/drive/drive-core';
import { autoGain, IntegralTable, SHAPES, transfer } from '../../src/devices/effects/drive/drive-math';

const SR = 48000, BLOCK = 128;

const sine = (freq: number, amp: number, n: number) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / SR));

/** Fa lavorare il Drive a blocchi; restituisce il canale sinistro. */
function run(params: Record<string, number>, input: Float32Array): Float32Array {
  const core = new DriveCore(SR);
  core.setParams(resolveParams(DRIVE, params));
  const out = new Float32Array(input.length);
  for (let f = 0; f < input.length; f += BLOCK) {
    const n = Math.min(BLOCK, input.length - f), x = input.slice(f, f + n);
    const l = new Float32Array(n), r = new Float32Array(n);
    core.process(x, x, l, r, n);
    out.set(l, f);
  }
  return out;
}

/** Ampiezza della componente a `freq` in x[from…] (finestra di Hann, n campioni). */
function amplitude(x: Float32Array, freq: number, from: number, n: number): number {
  let re = 0, im = 0, wsum = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)), a = (2 * Math.PI * freq * (from + i)) / SR;
    re += w * x[from + i] * Math.cos(a);
    im += w * x[from + i] * Math.sin(a);
    wsum += w;
  }
  return (2 * Math.hypot(re, im)) / wsum;
}

const db = (a: number) => 20 * Math.log10(Math.max(1e-12, a));
/** Dove finisce una frequenza sopra Nyquist una volta campionata a SR. */
const folded = (f: number) => {
  const m = f % SR;
  return m > SR / 2 ? SR - m : m;
};

/** Il Drive con solo la curva: niente bassi puliti, colore neutro, tono aperto, senza compensazione. */
const BARE = { low: 0, color: 0, tone: 20000, auto: 0, mix: 100, output: 0, bias: 0 };

describe('sovracampionamento', () => {
  it.each([2, 4, 8] as const)('%i×: su e giù lascia il suono com\'era, solo ritardato', factor => {
    const os = new Oversampler(factor);
    const x = sine(1000, 0.5, 4096), y = new Float32Array(x.length);
    for (let f = 0; f < x.length; f += BLOCK) {
      const out = new Float32Array(BLOCK);
      os.down(os.up(x.subarray(f, f + BLOCK), BLOCK), out, BLOCK);
      y.set(out, f);
    }
    const L = os.latency;
    let err = 0;
    for (let i = 200; i < x.length; i++) err = Math.max(err, Math.abs(y[i] - 0.5 * Math.sin((2 * Math.PI * 1000 * (i - L)) / SR)));
    expect(err).toBeLessThan(2e-4);
    expect(L).toBeLessThan(40); // meno di un millisecondo
  });

  it('banda passante piatta fino a 18 kHz', () => {
    for (const freq of [100, 5000, 12000, 18000]) {
      const os = new Oversampler(4), x = sine(freq, 0.5, 8192), y = new Float32Array(x.length);
      for (let f = 0; f < x.length; f += BLOCK) {
        const out = new Float32Array(BLOCK);
        os.down(os.up(x.subarray(f, f + BLOCK), BLOCK), out, BLOCK);
        y.set(out, f);
      }
      expect(Math.abs(db(amplitude(y, freq, 1024, 6000) / 0.5))).toBeLessThan(0.1);
    }
  });
});

describe('le curve', () => {
  it('passano per lo zero, per segnali piccoli sono quasi rette, restano limitate', () => {
    for (const [i, s] of SHAPES.entries()) {
      const t = transfer({ shape: i, drive: 1, bias: 0 });
      expect(t(0)).toBe(0);
      if (s.id !== 'fuzz') expect(t(0.01) / 0.01).toBeCloseTo(1, 1);
      for (let x = -1; x <= 1; x += 0.05) expect(Math.abs(transfer({ shape: i, drive: 60, bias: 0 })(x))).toBeLessThan(2.1);
    }
  });

  it('le primitive hanno per pendenza la curva, e la tabella le segue', () => {
    for (const s of SHAPES) {
      for (const x of [-30, -3, -0.95, -0.2, 0, 0.3, 0.89, 0.91, 2, 25]) {
        const h = 1e-4, slope = (s.integral(x + h) - s.integral(x - h)) / (2 * h);
        expect(slope).toBeCloseTo(s.fn(x), 4);
      }
      if (s.id === 'fold') continue;
      const t = new IntegralTable(s, s.id === 'tape' ? 96 : 24);
      for (let x = -40; x <= 40; x += 0.137) expect(Math.abs(t.at(x) - s.integral(x))).toBeLessThan(2e-3);
    }
  });

  it('auto gain: alzando il drive il volume resta lì', () => {
    for (const shape of [SHAPE.soft, SHAPE.tube, SHAPE.hard, SHAPE.fold]) {
      const loud = (driveDb: number) => {
        const y = run({ ...BARE, shape, drive: driveDb, auto: 1 }, sine(1000, 0.5, 8192));
        let s = 0;
        for (let i = 4096; i < 8192; i++) s += y[i] * y[i];
        return Math.sqrt(s / 4096);
      };
      expect(Math.abs(db(loud(30) / loud(3)))).toBeLessThan(3);
    }
    expect(autoGain({ shape: SHAPE.soft, drive: 1, bias: 0 })).toBeLessThan(1.1); // a 0 dB la curva morbida comprime appena
  });
});

describe('Drive: suono', () => {
  it('l\'oversampling toglie l\'aliasing: le armoniche ripiegate scendono di oltre 25 dB', () => {
    const f0 = 4900, n = 16384, x = sine(f0, 0.5, n);
    const y = run({ ...BARE, shape: SHAPE.hard, drive: 24 }, x);
    // lo stesso clip senza sovracampionamento, come riferimento
    const naive = x.map(v => SHAPES[SHAPE.hard].fn(v * 15.85));
    const aliases = [5, 7, 9, 11, 13, 15].map(h => folded(h * f0))
      // quelli che si sentono: sotto 20 kHz (a 23.5 kHz il filtro è nella sua banda di transizione)
      .filter(f => f < 20000 && Math.abs(f - f0 * Math.round(f / f0)) > 300);
    const ratio = (sig: Float32Array) => {
      const fund = amplitude(sig, f0, 4096, 8192);
      return Math.max(...aliases.map(f => amplitude(sig, f, 4096, 8192))) / fund;
    };
    console.log(`aliasing udibile: senza sovracampionamento ${db(ratio(naive)).toFixed(1)} dB, con Drive 4× + ADAA ${db(ratio(y)).toFixed(1)} dB`);
    expect(db(ratio(naive))).toBeGreaterThan(-35);
    expect(db(ratio(y))).toBeLessThan(db(ratio(naive)) - 25);
  });

  it('con il mix a zero è trasparente: esce il suono diretto, solo ritardato', () => {
    const x = Float32Array.from({ length: 4096 }, (_, i) => Math.sin(i * 0.05) * 0.4 + Math.sin(i * 0.31) * 0.3);
    const y = run({ drive: 30, shape: SHAPE.fuzz, mix: 0 }, x);
    const os = new Oversampler(4), ref = new Float32Array(x.length);
    for (let f = 0; f < x.length; f += BLOCK) {
      const out = new Float32Array(BLOCK);
      os.down(os.up(x.subarray(f, f + BLOCK), BLOCK), out, BLOCK);
      ref.set(out, f);
    }
    let err = 0;
    for (let i = 0; i < x.length; i++) err = Math.max(err, Math.abs(y[i] - ref[i]));
    expect(err).toBeLessThan(1e-5);
  });

  it('bassi puliti: un 40 Hz resta pulito anche con tanto drive', () => {
    const thd = (low: number) => {
      const y = run({ ...BARE, shape: SHAPE.hard, drive: 30, low, split: 120 }, sine(40, 0.5, 48000));
      const fund = amplitude(y, 40, 12000, 36000);
      return db(Math.hypot(...[3, 5, 7, 9].map(h => amplitude(y, 40 * h, 12000, 36000))) / fund);
    };
    expect(thd(0)).toBeGreaterThan(-15);
    expect(thd(100)).toBeLessThan(-30);
  });

  it('armoniche pari dal bias e dalla valvola; niente continua in uscita', () => {
    const second = (params: Record<string, number>) => {
      const y = run({ ...BARE, drive: 12, ...params }, sine(1000, 0.5, 16384));
      return db(amplitude(y, 2000, 8192, 8192) / amplitude(y, 1000, 8192, 8192));
    };
    expect(second({ shape: SHAPE.soft })).toBeLessThan(-70);
    expect(second({ shape: SHAPE.soft, bias: 50 })).toBeGreaterThan(-30);
    expect(second({ shape: SHAPE.tube })).toBeGreaterThan(-40);
    const y = run({ ...BARE, shape: SHAPE.fuzz, drive: 24, bias: 60 }, sine(1000, 0.5, 48000));
    let mean = 0;
    for (let i = 24000; i < 48000; i++) mean += y[i] / 24000;
    expect(Math.abs(mean)).toBeLessThan(0.01);
    expect(y.every(Number.isFinite)).toBe(true);
  });

  it('i preset suonano senza esplodere', () => {
    const x = Float32Array.from({ length: 24000 }, (_, i) => Math.sin(i * 0.02) * 0.6 + (i % 400 < 4 ? 0.9 : 0));
    for (const p of DRIVE.presets) {
      const y = run(p.params, x);
      expect(y.every(Number.isFinite)).toBe(true);
      expect(Math.max(...y.map(Math.abs))).toBeLessThan(2.5);
    }
  });

  it('costo: una traccia stereo a 4× è una frazione piccola del tempo reale', () => {
    const core = new DriveCore(SR);
    core.setParams(resolveParams(DRIVE, {}));
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK), x = sine(220, 0.5, BLOCK);
    for (let i = 0; i < 200; i++) core.process(x, x, l, r, BLOCK);
    const blocks = 2000, t0 = performance.now();
    for (let i = 0; i < blocks; i++) core.process(x, x, l, r, BLOCK);
    const ms = performance.now() - t0, audioMs = (blocks * BLOCK * 1000) / SR;
    console.log(`Drive 4× stereo: ${(ms / audioMs * 100).toFixed(2)} % di un core (${(ms * 1e6 / (blocks * BLOCK)).toFixed(0)} ns per campione)`);
    expect(ms / audioMs).toBeLessThan(0.2);
  });
});
