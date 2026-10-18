import { describe, expect, it } from 'vitest';
import { asId, sequentialIds } from '../../src/core/id';
import { AudioClip, clipTimes } from '../../src/model/audio-clip';
import { fullRange } from '../../src/model/clip';
import { MidiClip } from '../../src/model/midi-clip';
import { WarpMarkers } from '../../src/model/warp-markers';
import { Tempo } from '../../src/core/music-time';
import type { ModTarget } from '../../src/model/envelope';
import { sampleRef } from '../helpers/fixtures';

const midi = (loop: boolean) => MidiClip.create({
  id: asId('clip-1'), name: 'm', color: '#fff', notes: [],
  region: { start: 1, end: 5 }, loop: { enabled: loop, start: 2, end: 4 },
});

describe('Clip: riproduzione', () => {
  it('senza loop suona la regione una volta', () => {
    const c = midi(false);
    expect(c.playLength).toBe(4);
    expect(c.contentBeatAt(0)).toBe(1);
    expect(c.contentBeatAt(3.5)).toBe(4.5);
    expect(c.contentBeatAt(4)).toBeNull();
    expect(c.contentBeatAt(-1)).toBeNull();
  });

  it('con il loop parte da region.start e ripete [loop.start, loop.end)', () => {
    const c = midi(true);
    expect(c.playLength).toBe(Infinity);
    expect(c.contentBeatAt(0)).toBe(1);   // 1
    expect(c.contentBeatAt(2.5)).toBe(3.5); // 3.5
    expect(c.contentBeatAt(3)).toBe(2);   // 4 → torna a 2
    expect(c.contentBeatAt(6.25)).toBe(3.25);
  });

  it('rifiuta regioni e loop vuoti', () => {
    expect(() => midi(false).withRegion({ start: 2, end: 2 })).toThrow(RangeError);
    expect(() => midi(true).withLoop({ enabled: true, start: 3, end: 1 })).toThrow(RangeError);
  });

  it('i metodi with… restituiscono copie dello stesso tipo', () => {
    const c = midi(false);
    const r = c.withName('nuovo');
    expect(r).toBeInstanceOf(MidiClip);
    expect(r.name).toBe('nuovo');
    expect(c.name).toBe('m');
  });
});

describe('AudioClip', () => {
  it('da un sample: warp sul tempo rilevato e tutto il sample', () => {
    const ids = sequentialIds();
    const s = sampleRef(ids);
    const c = AudioClip.fromSample(ids.next('clip'), s, '#f00');
    expect(c.region).toEqual({ start: 0, end: 8 }); // 4 s a 120 BPM
    expect(c.warp.markers.globalBpm).toBeCloseTo(120, 9);
    expect(c.sample).toBe(s.id);
  });

  it('transpose e detune sono limitati, le opzioni di warp si conservano', () => {
    const ids = sequentialIds();
    const c = AudioClip.fromSample(ids.next('clip'), sampleRef(ids), '#f00');
    expect(c.withTranspose(70).transpose).toBe(48);
    expect(c.withDetune(-80).detune).toBe(-50);
    expect(c.withTranspose(3).withDetune(25).pitch).toBe(3.25);
    const t = c.withWarpOptions('texture', { flux: 55 }).withWarp({ mode: 'beats' }).withWarp({ mode: 'texture' });
    expect(t.warp.options.texture).toEqual({ grainMs: 80, flux: 55 });
  });

  it('il volume della clip è limitato', () => {
    const ids = sequentialIds();
    const c = AudioClip.fromSample(ids.next('clip'), sampleRef(ids), '#f00');
    expect(c.withGain(-6).gainDb).toBe(-6);
    expect(c.withGain(40).gainDb).toBe(24);
    expect(c.withGain(-200).gainDb).toBe(-70);
  });

  it('reverse: lo stesso tratto di audio suona sugli stessi battiti, specchiato', () => {
    const ids = sequentialIds();
    // 4 s a 120 BPM, primo colpo a 0.25 s; la clip suona [1, 5)
    const c = AudioClip.fromSample(ids.next('clip'), sampleRef(ids), '#f00')
      .withMarkers(WarpMarkers.straight(120, 4, 0.25)).withRegion({ start: 1, end: 5 });
    const r = c.withReversed(true, 4);
    expect(r.reversed).toBe(true);
    expect(r.region).toEqual(c.region);
    // il battito b della clip dritta suona il secondo t; quella al contrario lo suona in 6 − b,
    // e nel sample rovesciato quel secondo è 4 − t
    for (const b of [1, 2.5, 4, 5]) expect(r.warp.markers.timeOf(6 - b)).toBeCloseTo(4 - c.warp.markers.timeOf(b), 9);
    expect(r.warp.markers.globalBpm).toBeCloseTo(120, 9);
    const back = r.withReversed(false, 4);
    expect(back.reversed).toBe(false);
    for (const b of [-1, 0, 3, 7.5]) expect(back.warp.markers.timeOf(b)).toBeCloseTo(c.warp.markers.timeOf(b), 9);
    expect(r.withReversed(true, 4)).toBe(r);
  });

  it('reverse con il loop: si specchia attorno al loop', () => {
    const ids = sequentialIds();
    const c = AudioClip.fromSample(ids.next('clip'), sampleRef(ids), '#f00').withLoop({ enabled: true, start: 2, end: 4 });
    const r = c.withReversed(true, 4);
    expect(r.loop).toEqual(c.loop);
    expect(r.warp.markers.timeOf(2)).toBeCloseTo(4 - c.warp.markers.timeOf(4), 9);
  });

  it('i transienti visti da una clip al contrario sono specchiati e in ordine', () => {
    const ids = sequentialIds();
    const c = AudioClip.fromSample(ids.next('clip'), sampleRef(ids), '#f00');
    expect(clipTimes(c, [0.5, 1, 3], 4)).toEqual([0.5, 1, 3]);
    expect(clipTimes(c.withReversed(true, 4), [0.5, 1, 3], 4)).toEqual([1, 3, 3.5]);
  });
});

describe('AudioClip: crop', () => {
  const ids = sequentialIds();
  // 4 s a 120 BPM: il battito b è il secondo b / 2
  const base = AudioClip.fromSample(ids.next('clip'), sampleRef(ids), '#f00');
  const other = asId<'sample'>('sample-99');

  it('con il loop tiene il tratto sotto il loop e la clip lo suona sugli stessi battiti', () => {
    const c = base.withRegion({ start: 1, end: 8 }).withLoop({ enabled: true, start: 2, end: 6 });
    const crop = c.cropped(4, new Tempo(120))!;
    expect([crop.fileStart, crop.fileEnd]).toEqual([1, 3]);
    const r = crop.clip(other);
    expect(r.sample).toBe(other);
    expect(r.region).toEqual({ start: 2, end: 6 });
    expect(r.loop).toEqual({ enabled: true, start: 2, end: 6 });
    for (const b of [2, 3.5, 6]) expect(r.warp.markers.timeOf(b)).toBeCloseTo(c.warp.markers.timeOf(b) - 1, 9);
  });

  it('senza loop tiene la regione', () => {
    const crop = base.withRegion({ start: 1, end: 3 }).cropped(4, new Tempo(120))!;
    expect([crop.fileStart, crop.fileEnd]).toEqual([0.5, 1.5]);
    expect(crop.clip(other).loop).toEqual({ enabled: false, start: 1, end: 3 });
  });

  it('al contrario: il tratto del file è quello specchiato', () => {
    const c = base.withLoop({ enabled: true, start: 2, end: 4 }).withReversed(true, 4);
    const crop = c.cropped(4, new Tempo(120))!;
    const t0 = c.warp.markers.timeOf(2), t1 = c.warp.markers.timeOf(4);
    expect(crop.fileStart).toBeCloseTo(4 - t1, 9);
    expect(crop.fileEnd).toBeCloseTo(4 - t0, 9);
    expect(crop.clip(other).reversed).toBe(true);
    expect(crop.clip(other).warp.markers.timeOf(2)).toBeCloseTo(0, 9);
  });

  it('senza warp il file nuovo riparte dal battito 0, modulazioni comprese', () => {
    const c = base.withWarp({ enabled: false }).withRegion({ start: 2, end: 6 })
      .withEnvelope({ kind: 'mixer', param: 'volume' } as ModTarget, [{ beat: 3, value: 0.5 }]);
    const crop = c.cropped(4, new Tempo(60))!; // a 60 BPM il battito b è il secondo b
    expect([crop.fileStart, crop.fileEnd]).toEqual([2, 4]); // il sample finisce a 4 s
    const r = crop.clip(other);
    expect(r.region).toEqual({ start: 0, end: 4 });
    expect(r.envelopes[0].points[0].beat).toBe(1);
  });

  it('niente da tenere fuori dal sample', () => {
    expect(base.withRegion({ start: 10, end: 12 }).cropped(4, new Tempo(120))).toBeNull();
  });
});

describe('MidiClip', () => {
  const clip = MidiClip.create({
    id: asId('clip-1'), name: 'm', color: '#fff', ...fullRange(0, 4),
    notes: [
      { pitch: 64, start: 1, duration: 0.5, velocity: 100 },
      { pitch: 60, start: 1, duration: 0.5, velocity: 300 },
      { pitch: 126, start: 0, duration: 1, velocity: 80 },
    ],
  });

  it('ordina le note e limita la velocity', () => {
    expect(clip.notes.map(n => n.pitch)).toEqual([126, 60, 64]);
    expect(clip.notes[1].velocity).toBe(127);
  });

  it('trasposizione e ricerca', () => {
    expect(clip.transposed(3).notes.map(n => n.pitch)).toEqual([63, 67]); // 129 esce
    expect(clip.notesIn(0.5, 2).map(n => n.pitch)).toEqual([60, 64]);
    expect(clip.removingNotes(n => n.pitch === 60).notes).toHaveLength(2);
  });

  it('rifiuta note non valide', () => {
    expect(() => clip.addingNotes({ pitch: 128, start: 0, duration: 1, velocity: 1 })).toThrow(RangeError);
    expect(() => clip.addingNotes({ pitch: 60, start: 0, duration: 0, velocity: 1 })).toThrow(RangeError);
  });
});
