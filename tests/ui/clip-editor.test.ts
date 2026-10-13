import { describe, expect, it } from 'vitest';
import { asId, sequentialIds } from '../../src/core/id';
import { Tempo } from '../../src/core/music-time';
import type { Placement } from '../../src/model/arrangement';
import { AudioClip } from '../../src/model/audio-clip';
import { WarpMarkers } from '../../src/model/warp-markers';
import { autoWarp, firstHit, followTempo, scaleTempo } from '../../src/model/warp-tools';
import {
  BeatAxis, contentBeatAt, contentToSeconds, secondsToContent, shiftAudioUnderMarker, timelineBeatOf, withLoopSafe, withRegionSafe,
} from '../../src/ui/clip-editor/clip-geometry';
import { sampleRef } from '../helpers/fixtures';

const ids = sequentialIds();
const sample = sampleRef(ids); // 4 s a 120 BPM
const clip = AudioClip.fromSample(ids.next('clip'), sample, '#fff');

describe('strumenti di warp', () => {
  it('Auto-Warp: 1.1.1 dove si allineano più transienti', () => {
    // a 120 BPM: colpi in battere a 0.3 + k·0.5 s e un levare isolato a 0.05 s
    const onBeat = [0.3, 0.8, 1.3, 1.8, 2.3];
    expect(firstHit([0.05, ...onBeat], 4, 120)).toBe(0.3);
    // il loop demo: il colpo a 0 non è rilevato e i levare (0.25 … 1.75) sono uno in più dei battere
    expect(firstHit([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75], 4, 120)).toBe(0);
    // silenzio iniziale e poi colpi regolari dal secondo 0.7 (in levare rispetto allo 0)
    expect(firstHit([0.7, 1.2, 1.7, 2.2, 2.7, 3.2], 4, 120)).toBe(0.7);
    expect(firstHit([], 4, 120)).toBe(0);
    const m = autoWarp(120, onBeat, 4);
    expect(m.beatOf(0.3)).toBeCloseTo(0, 12);
    expect(m.globalBpm).toBeCloseTo(120, 9);
  });

  it('Segui tempo: un marker per battuta, agganciato ai transienti', () => {
    // battiti leggermente irregolari intorno a 120 BPM, transienti 10 ms dopo
    const beats = Array.from({ length: 9 }, (_, k) => 0.2 + k * 0.5 + (k % 2 ? 0.02 : 0));
    const transients = beats.map(b => b + 0.01);
    const m = followTempo(beats, transients, 120, 5, 4)!;
    // il primo colpo (0.21 s) è 1.1.1; prima e dopo si estrapola a 120 BPM
    const expected = [-0.42, 0, 4, 8, 9.58];
    m.markers.forEach((x, i) => expect(x.b).toBeCloseTo(expected[i], 9));
    expect(m.length).toBe(5);
    expect(m.markers[1].t).toBeCloseTo(0.21, 12);
    expect(m.markers[3].t).toBeCloseTo(4.21, 12);
    expect(followTempo([0, 0.5], [], 120, 2, 4)).toBeNull();
  });

  it(':2 e ×2', () => {
    expect(scaleTempo(clip.warp.markers, 0.5).globalBpm).toBeCloseTo(60, 9);
    expect(scaleTempo(clip.warp.markers, 2).globalBpm).toBeCloseTo(240, 9);
  });
});

describe('editor: calcoli', () => {
  it('asse: inquadratura e zoom attorno al puntatore, anche prima di 1.1.1', () => {
    const a = BeatAxis.fit(-2, 8, 1000);
    expect(a.beatToX(-2)).toBeGreaterThan(0);
    expect(a.beatToX(8)).toBeLessThan(1000);
    const z = a.zoomed(a.pxPerBeat * 3, 500);
    expect(z.xToBeat(500)).toBeCloseTo(a.xToBeat(500), 9);
    expect(a.scrolled(-5).startBeat).toBe(-5);
  });

  it('battiti ↔ secondi con e senza warp', () => {
    const tempo = new Tempo(60);
    expect(contentToSeconds(clip, tempo)(4)).toBeCloseTo(2, 12); // il warp segue i 120 BPM del sample
    const raw = clip.withWarp({ enabled: false }).withTranspose(12);
    expect(contentToSeconds(raw, tempo)(1)).toBeCloseTo(2, 12); // 1 s di timeline a velocità doppia
    expect(secondsToContent(raw, tempo)(2)).toBeCloseTo(1, 12);
  });

  it('regione e loop restano validi', () => {
    expect(withRegionSafe(clip, 5, 3).region.end).toBeGreaterThan(withRegionSafe(clip, 5, 3).region.start);
    const looped = withLoopSafe(clip, 2, 4);
    expect(looped.loop).toEqual({ enabled: true, start: 2, end: 4 });
    const late = clip.withRegion({ start: 6, end: 8 });
    expect(withLoopSafe(late, 0, 2).region.start).toBe(0); // la clip non può partire dopo il loop
    expect(withRegionSafe(looped, 7, 8).region.start).toBeLessThan(4);
  });

  it('Maiusc+trascina: l\'audio scorre sotto il marker, il battito resta', () => {
    const m = WarpMarkers.of([{ t: 0, b: 0 }, { t: 1, b: 2 }, { t: 4, b: 8 }], 120);
    const s = shiftAudioUnderMarker(m, 1, 2, 2.5, 4); // mezzo battito a destra = l'audio arriva prima
    expect(s.markers[1].b).toBe(2);
    expect(s.markers[1].t).toBeCloseTo(0.75, 12);
  });

  it('dalla timeline al contenuto della clip e ritorno', () => {
    const looped = clip.withLoop({ enabled: true, start: 0, end: 4 });
    const pl: Placement = { id: asId('placement-1'), clip: looped, start: 8, length: 12, offset: 0 };
    expect(contentBeatAt(pl, 9)).toBe(1);
    expect(contentBeatAt(pl, 13)).toBe(1); // secondo giro
    expect(contentBeatAt(pl, 7)).toBeNull();
    expect(timelineBeatOf(pl, 3)).toBe(11);
  });
});
