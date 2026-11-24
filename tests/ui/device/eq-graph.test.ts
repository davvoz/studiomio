import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EqBand } from '../../../src/devices/effects/eq/eq';
import { EqGraph, type GraphState } from '../../../src/ui/device/eq/eq-graph';
import { FakePath2D, fakeCanvas } from '../../helpers/canvas';

const band = (type: number, freq: number, gain = 0, on = true): EqBand => ({ on, type, freq, gain, q: 0.7, slope: 12 });

describe('the EQ graph', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { devicePixelRatio: 2 });
    vi.stubGlobal('Path2D', FakePath2D);
  });
  afterEach(() => vi.unstubAllGlobals());

  const bands = [band(0, 40), band(2, 1000, 6), band(4, 8000, -3, false)];
  const state = (over: Partial<GraphState> = {}): GraphState => ({ bands, output: 0, enabled: true, selected: 1, hover: null, label: 'Bell 1 kHz', readout: '1.00 kHz', ...over });

  it('a band\'s point sits on its frequency and gain (cuts on zero), and is grabbed near it', () => {
    const { canvas } = fakeCanvas(600, 200);
    const g = new EqGraph(canvas, 48000);
    g.draw(state(), null);
    const bell = g.nodeAt(bands[1]), cut = g.nodeAt(bands[0]);
    expect(bell.y).toBeLessThan(cut.y);
    expect(cut.y).toBeCloseTo(g.geometry.dbToY(0));
    expect(g.hit(bands, bell.x + 5, bell.y)).toBe(1);
    expect(g.hit(bands, bell.x + 50, bell.y + 50)).toBeNull();
  });

  it('draws grid, spectrum, the chosen band, the total curve, the points and the texts; at the canvas size', () => {
    const { canvas, ctx } = fakeCanvas(600, 200);
    const g = new EqGraph(canvas, 48000);
    const spectrum = { pre: new Float32Array(4096).fill(-50), post: new Float32Array(4096).fill(-60), sampleRate: 48000 };
    g.draw(state(), spectrum);
    expect([canvas.width, canvas.height]).toEqual([1200, 400]);
    g.draw(state({ hover: 2, enabled: false, label: '', readout: '' }), spectrum);
    g.draw(state({ bands: [...bands], output: 3 }), null);
    expect(ctx.calls.filter(c => c === 'fillText').length).toBeGreaterThan(10);
    expect(ctx.calls).toContain('arc');
  });

  it('a canvas not laid out yet draws nothing', () => {
    const { canvas, ctx } = fakeCanvas(0, 0);
    new EqGraph(canvas, 48000).draw(state(), null);
    expect(ctx.calls).toEqual([]);
  });
});
