import { describe, expect, it } from 'vitest';
import { PeakStore, Peaks } from '../../src/ui/waveform';

// 1 s at 1000 Hz: silence in the first half, a hit at 0.9 s
const channels = [Float32Array.from({ length: 1000 }, (_, i) => (i >= 900 && i < 910 ? 0.8 : 0))];

describe('Peaks', () => {
  it('reversed, second t is second duration − t', () => {
    const p = Peaks.from({ channels, sampleRate: 1000 });
    expect(p.range(0.85, 0.95)[1]).toBeCloseTo(0.8, 6);
    expect(p.range(0.05, 0.15)[1]).toBe(0);
    const r = p.reversed();
    expect(r.range(0.05, 0.15)[1]).toBeCloseTo(0.8, 6);
    expect(r.range(0.85, 0.95)[1]).toBe(0);
    expect(r.reversed().range(0.85, 0.95)[1]).toBeCloseTo(0.8, 6);
  });

  it('the store computes the peaks once per sample, straight and reversed', () => {
    let reads = 0;
    const store = new PeakStore(() => (reads++, { channels, sampleRate: 1000 }));
    const id = 'sample-1' as Parameters<PeakStore['get']>[0];
    expect(store.get(id)!.range(0.85, 0.95)[1]).toBeCloseTo(0.8, 6);
    expect(store.get(id, true)!.range(0.05, 0.15)[1]).toBeCloseTo(0.8, 6);
    expect(reads).toBe(1);
  });
});
