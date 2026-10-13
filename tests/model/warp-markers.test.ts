import { describe, expect, it } from 'vitest';
import { WarpMarkers, type WarpMarker } from '../../src/model/warp-markers';

/** beatOf/timeOf come in WarpMio (js/app.js), per confronto. */
function legacyBeatOf(ms: WarpMarker[], origBpm: number, t: number): number {
  const n = ms.length, k = origBpm / 60;
  if (n === 0) return t * k;
  if (n === 1) return ms[0].b + (t - ms[0].t) * k;
  let i = 0;
  if (t >= ms[n - 1].t) i = n - 2;
  else if (t > ms[0].t) {
    let lo = 0, hi = n - 2;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ms[m].t <= t) lo = m; else hi = m - 1; }
    i = lo;
  }
  const a = ms[i], c = ms[i + 1];
  return a.b + (t - a.t) * (c.b - a.b) / (c.t - a.t);
}

const irregular = WarpMarkers.of([
  { t: 0, b: -0.5 }, { t: 0.25, b: 0 }, { t: 1.1, b: 2 }, { t: 2.0, b: 4 }, { t: 3.7, b: 7.5 },
], 118);

describe('WarpMarkers', () => {
  it('beatOf coincide con WarpMio, anche fuori dai marker', () => {
    for (const ms of [irregular, WarpMarkers.of([], 97), WarpMarkers.of([{ t: 1, b: 3 }], 97)]) {
      for (let t = -1; t <= 5; t += 0.137) expect(ms.beatOf(t)).toBeCloseTo(legacyBeatOf([...ms.markers], ms.baseBpm, t), 12);
    }
  });

  it('timeOf è l\'inverso di beatOf', () => {
    for (let t = -1; t <= 5; t += 0.21) expect(irregular.timeOf(irregular.beatOf(t))).toBeCloseTo(t, 9);
  });

  it('straight mette 1.1.1 sul primo colpo e copre tutto il sample', () => {
    const m = WarpMarkers.straight(120, 4, 0.25);
    expect(m.markers).toEqual([{ t: 0, b: -0.5 }, { t: 0.25, b: 0 }, { t: 4, b: 7.5 }]);
    expect(m.globalBpm).toBeCloseTo(120, 9);
  });

  it('of ordina e scarta i doppioni', () => {
    const m = WarpMarkers.of([{ t: 2, b: 4 }, { t: 0, b: 0 }, { t: 2.000001, b: 4.5 }, { t: 1, b: 2 }], 120);
    expect(m.markers.map(x => x.t)).toEqual([0, 1, 2]);
  });

  it('aggiungere un marker non cambia la mappa', () => {
    const { markers, index } = irregular.withMarkerAt(1.5);
    expect(markers.length).toBe(irregular.length + 1);
    expect(markers.markers[index].t).toBe(1.5);
    for (let t = 0; t <= 4; t += 0.1) expect(markers.beatOf(t)).toBeCloseTo(irregular.beatOf(t), 9);
    // vicino a un marker esistente: nessun doppione
    expect(irregular.withMarkerAt(1.1005).markers).toBe(irregular);
  });

  it('servono almeno due marker', () => {
    const two = WarpMarkers.straight(120, 4);
    expect(two.canRemove(0)).toBe(false);
    expect(() => two.without(0)).toThrow();
    expect(irregular.without(2).length).toBe(4);
  });

  it('trascinare un marker resta tra i vicini', () => {
    const m = irregular.withMarkerBeat(2, 100);
    expect(m.markers[2].b).toBeCloseTo(4 - 0.01, 9);
    expect(m.markers[2].t).toBe(1.1);
    const s = irregular.withMarkerTime(2, -5, 3.7);
    expect(s.markers[2].t).toBeCloseTo(0.25 + 0.001, 9);
    expect(s.markers[2].b).toBe(2);
  });

  it('tempo del segmento e tempo globale', () => {
    const m = irregular.withSegmentBpm(1, 150);
    expect(m.segmentBpm(1)).toBeCloseTo(150, 9);
    expect(m.markers[1]).toEqual(irregular.markers[1]);
    expect(m.segmentBpm(2)).toBeCloseTo(irregular.segmentBpm(2), 9); // i successivi scorrono soltanto
    const g = irregular.withGlobalBpm(90);
    expect(g.globalBpm).toBeCloseTo(90, 9);
    expect(g.markers[0]).toEqual(irregular.markers[0]);
  });

  it('origine, quantizzazione e azzeramento', () => {
    expect(irregular.withOrigin(1.1).beatOf(1.1)).toBeCloseTo(0, 12);
    const q = WarpMarkers.of([{ t: 0, b: 0.1 }, { t: 1, b: 1.9 }, { t: 1.05, b: 2.05 }, { t: 2, b: 4.2 }], 120).quantized(1);
    expect(q.markers.map(m => m.b)).toEqual([0, 2, 4]);
    const c = irregular.cleared(4);
    expect(c.length).toBe(2);
    expect(c.beatOf(0)).toBeCloseTo(irregular.beatOf(0), 12);
    expect(c.globalBpm).toBeCloseTo(irregular.globalBpm, 9);
  });
});
