import { describe, expect, it } from 'vitest';
import { WARP } from '../../../src/devices/instruments/prisma/prisma';
import { FRAMES } from '../../../src/devices/instruments/wavetable/tables';
import { builtInFrames, importedFrames, warped } from '../../../src/ui/device/prisma/table-view';

const ramp = (p: number) => 2 * p - 1;
const PS = [0, 0.1, 0.25, 0.5, 0.7, 0.9];

describe('Prisma\'s table drawing', () => {
  it('with no amount every warp leaves the shape as it is (quantize to 1/1024)', () => {
    for (const w of Object.values(WARP)) {
      for (const p of PS) {
        const v = warped(ramp, w, 0, p);
        if (w === WARP.softSync) expect(v).toBeCloseTo(ramp(p) * 4 * p * (1 - p), 9);
        else expect(v).toBeCloseTo(ramp(p), 3);
      }
    }
  });

  it('at full amount: sync repeats, PWM silences the end, flip inverts, mirror folds, bends and asymmetry move the middle', () => {
    expect(warped(ramp, WARP.sync, 1, 0.5)).toBeCloseTo(ramp(0), 9);
    expect(warped(ramp, WARP.pwm, 1, 0.9)).toBe(0);
    expect(warped(ramp, WARP.flip, 1, 0.5)).toBeCloseTo(-ramp(0.5), 9);
    expect(warped(ramp, WARP.mirror, 1, 0.75)).toBeCloseTo(ramp(0.5), 9);
    expect(warped(ramp, WARP.bendUp, 1, 0.5)).toBeGreaterThan(ramp(0.5));
    expect(warped(ramp, WARP.bendDown, 1, 0.5)).toBeLessThan(ramp(0.5));
    expect(warped(ramp, WARP.bendBoth, 1, 0.25)).toBeGreaterThan(ramp(0.25));
    expect(warped(ramp, WARP.bendBoth, 1, 0.75)).toBeLessThan(ramp(0.75));
    expect(warped(ramp, WARP.asymUp, 1, 0.5)).toBeLessThan(ramp(0.5));
    expect(warped(ramp, WARP.asymDown, 1, 0.5)).toBeGreaterThan(ramp(0.5));
    expect(warped(ramp, WARP.quantize, 1, 0.3)).toBe(Math.round(ramp(0.3) * 2) / 2);
    expect(warped(ramp, WARP.fm, 1, 0.3)).toBe(ramp(0.3));
  });

  it('the built-in tables and an imported file give their shapes, normalised', () => {
    const t = builtInFrames(0);
    expect(t.count).toBe(FRAMES);
    expect(Number.isFinite(t.sample(0, 0.25))).toBe(true);
    const sample = { channels: [Float32Array.from({ length: 4096 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * i) / 2048))], sampleRate: 44100 };
    const f = importedFrames(sample);
    expect(importedFrames(sample)).toBe(f);
    expect(f.count).toBeGreaterThan(0);
    expect(Math.max(...Array.from({ length: 64 }, (_, i) => Math.abs(f.sample(0, i / 64))))).toBeCloseTo(1, 1);
    expect(f.sample(99, 0.5)).toBe(0);
    const silent = importedFrames({ channels: [new Float32Array(2048)], sampleRate: 44100 });
    expect(silent.sample(0, 0.5)).toBe(0);
  });
});
