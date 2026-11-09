import { describe, expect, it } from 'vitest';
import { Ballistics, FLOOR_DB, meterPosition } from '../../src/ui/meters/ballistics';
import { EqScale, spectrumColumns } from '../../src/ui/device/eq/eq-scale';

const reading = (peak: number, rms = peak / 2) => ({ peak: [peak, peak] as const, rms: [rms, rms] as const });

describe('meters: scale and ballistics', () => {
  it('the scale always rises, with more space near 0', () => {
    const dbs = [-80, -70, -60, -40, -20, -12, -6, -3, 0, 3, 6, 10];
    const pos = dbs.map(meterPosition);
    for (let i = 1; i < pos.length; i++) expect(pos[i]).toBeGreaterThanOrEqual(pos[i - 1]);
    expect([meterPosition(-80), meterPosition(0), meterPosition(10)]).toEqual([0, 0.86, 1]);
    // near 0 a dB is more than three times as much as below −30
    const perDb = (lo: number, hi: number) => (meterPosition(hi) - meterPosition(lo)) / (hi - lo);
    expect(perDb(-12, 0)).toBeGreaterThan(3 * perDb(-70, -30));
  });

  it('peak right up and then slowly down; the maximum mark waits; the clip stays', () => {
    const b = new Ballistics();
    b.update(reading(0.5), 1 / 60); // −6 dB
    expect(b.peak[0]).toBeCloseTo(-6.02, 1);
    b.update(reading(0), 0.5);
    expect(b.peak[0]).toBeCloseTo(-18.02, 1); // 24 dB/s
    expect(b.hold[0]).toBeCloseTo(-6.02, 1); // waits 1.5 s
    b.update(reading(0), 1.1);
    expect(b.hold[0]).toBe(b.peak[0]); // then it follows the peak
    expect(b.max).toBeCloseTo(-6.02, 1);
    expect(b.clip).toBe(false);
    b.update(reading(1.2), 1 / 60);
    b.update(reading(0), 5);
    expect(b.clip).toBe(true);
    expect(b.peak[0]).toBe(FLOOR_DB);
    expect(b.idle).toBe(true);
    b.resetClip();
    expect([b.clip, b.max]).toEqual([false, FLOOR_DB]);
  });
});

describe('EQ spectrum', () => {
  it('at the bottom it interpolates between the FFT bands, at the top it takes the strongest', () => {
    const sampleRate = 48000, bins = new Float32Array(4096).fill(-100);
    const binHz = sampleRate / 8192;
    bins[Math.round(1000 / binHz)] = -20; // a 1 kHz tone
    bins[Math.round(12000 / binHz)] = -30; // and one at 12 kHz
    const scale = new EqScale(600, 200);
    const out = new Float32Array(300);
    spectrumColumns(bins, sampleRate, scale, out);
    const column = (f: number) => Math.floor((scale.freqToX(f) / 600) * 300);
    expect(out[column(12000)]).toBe(-30); // the 12 kHz column covers many bands: it doesn't lose it
    expect(Math.max(...out.subarray(column(1000) - 1, column(1000) + 2))).toBeGreaterThan(-60);
    expect(out[column(100)]).toBe(-100);
  });

  it('frequency ⇄ x and dB ⇄ y invert', () => {
    const s = new EqScale(600, 200);
    for (const f of [20, 100, 1000, 20000]) expect(s.xToFreq(s.freqToX(f))).toBeCloseTo(f, 6);
    for (const db of [-18, 0, 7.5]) expect(s.yToDb(s.dbToY(db))).toBeCloseTo(db, 9);
    expect(s.dbToY(0)).toBe(100);
  });
});
