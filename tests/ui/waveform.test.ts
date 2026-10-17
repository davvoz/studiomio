import { describe, expect, it } from 'vitest';
import { PeakStore, Peaks } from '../../src/ui/waveform';

// 1 s a 1000 Hz: silenzio nella prima metà, un colpo a 0.9 s
const channels = [Float32Array.from({ length: 1000 }, (_, i) => (i >= 900 && i < 910 ? 0.8 : 0))];

describe('Peaks', () => {
  it('al contrario il secondo t è il secondo durata − t', () => {
    const p = Peaks.from({ channels, sampleRate: 1000 });
    expect(p.range(0.85, 0.95)[1]).toBeCloseTo(0.8, 6);
    expect(p.range(0.05, 0.15)[1]).toBe(0);
    const r = p.reversed();
    expect(r.range(0.05, 0.15)[1]).toBeCloseTo(0.8, 6);
    expect(r.range(0.85, 0.95)[1]).toBe(0);
    expect(r.reversed().range(0.85, 0.95)[1]).toBeCloseTo(0.8, 6);
  });

  it('il negozio calcola i picchi una volta per sample, dritti e al contrario', () => {
    let reads = 0;
    const store = new PeakStore(() => (reads++, { channels, sampleRate: 1000 }));
    const id = 'sample-1' as Parameters<PeakStore['get']>[0];
    expect(store.get(id)!.range(0.85, 0.95)[1]).toBeCloseTo(0.8, 6);
    expect(store.get(id, true)!.range(0.05, 0.15)[1]).toBeCloseTo(0.8, 6);
    expect(reads).toBe(1);
  });
});
