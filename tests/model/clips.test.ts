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

describe('Clip: playback', () => {
  it('without loop it plays the region once', () => {
    const c = midi(false);
    expect(c.playLength).toBe(4);
    expect(c.contentBeatAt(0)).toBe(1);
    expect(c.contentBeatAt(3.5)).toBe(4.5);
    expect(c.contentBeatAt(4)).toBeNull();
    expect(c.contentBeatAt(-1)).toBeNull();
  });

  it('with the loop it starts from region.start and repeats [loop.start, loop.end)', () => {
    const c = midi(true);
    expect(c.playLength).toBe(Infinity);
    expect(c.contentBeatAt(0)).toBe(1);   // 1
    expect(c.contentBeatAt(2.5)).toBe(3.5); // 3.5
    expect(c.contentBeatAt(3)).toBe(2);   // 4 → back to 2
    expect(c.contentBeatAt(6.25)).toBe(3.25);
  });

  it('rejects empty regions and loops', () => {
    expect(() => midi(false).withRegion({ start: 2, end: 2 })).toThrow(RangeError);
    expect(() => midi(true).withLoop({ enabled: true, start: 3, end: 1 })).toThrow(RangeError);
  });

  it('the with… methods return copies of the same kind', () => {
    const c = midi(false);
    const r = c.withName('new');
    expect(r).toBeInstanceOf(MidiClip);
    expect(r.name).toBe('new');
    expect(c.name).toBe('m');
  });
});

describe('AudioClip', () => {
  it('from a sample: warp on the detected tempo and the whole sample', () => {
    const ids = sequentialIds();
    const s = sampleRef(ids);
    const c = AudioClip.fromSample(ids.next('clip'), s, '#f00');
    expect(c.region).toEqual({ start: 0, end: 8 }); // 4 s a 120 BPM
    expect(c.warp.markers.globalBpm).toBeCloseTo(120, 9);
    expect(c.sample).toBe(s.id);
  });

  it('transpose and detune are limited, the warp options are kept', () => {
    const ids = sequentialIds();
    const c = AudioClip.fromSample(ids.next('clip'), sampleRef(ids), '#f00');
    expect(c.withTranspose(70).transpose).toBe(48);
    expect(c.withDetune(-80).detune).toBe(-50);
    expect(c.withTranspose(3).withDetune(25).pitch).toBe(3.25);
    const t = c.withWarpOptions('texture', { flux: 55 }).withWarp({ mode: 'beats' }).withWarp({ mode: 'texture' });
    expect(t.warp.options.texture).toEqual({ grainMs: 80, flux: 55 });
  });

  it('the clip\'s volume is limited', () => {
    const ids = sequentialIds();
    const c = AudioClip.fromSample(ids.next('clip'), sampleRef(ids), '#f00');
    expect(c.withGain(-6).gainDb).toBe(-6);
    expect(c.withGain(40).gainDb).toBe(24);
    expect(c.withGain(-200).gainDb).toBe(-70);
  });

  it('reverse: the same stretch of audio plays on the same beats, mirrored', () => {
    const ids = sequentialIds();
    // 4 s at 120 BPM, first hit at 0.25 s; the clip plays [1, 5)
    const c = AudioClip.fromSample(ids.next('clip'), sampleRef(ids), '#f00')
      .withMarkers(WarpMarkers.straight(120, 4, 0.25)).withRegion({ start: 1, end: 5 });
    const r = c.withReversed(true, 4);
    expect(r.reversed).toBe(true);
    expect(r.region).toEqual(c.region);
    // beat b of the straight clip plays second t; the reversed one plays it at 6 − b,
    // and in the reversed sample that second is 4 − t
    for (const b of [1, 2.5, 4, 5]) expect(r.warp.markers.timeOf(6 - b)).toBeCloseTo(4 - c.warp.markers.timeOf(b), 9);
    expect(r.warp.markers.globalBpm).toBeCloseTo(120, 9);
    const back = r.withReversed(false, 4);
    expect(back.reversed).toBe(false);
    for (const b of [-1, 0, 3, 7.5]) expect(back.warp.markers.timeOf(b)).toBeCloseTo(c.warp.markers.timeOf(b), 9);
    expect(r.withReversed(true, 4)).toBe(r);
  });

  it('reverse with the loop: it mirrors around the loop', () => {
    const ids = sequentialIds();
    const c = AudioClip.fromSample(ids.next('clip'), sampleRef(ids), '#f00').withLoop({ enabled: true, start: 2, end: 4 });
    const r = c.withReversed(true, 4);
    expect(r.loop).toEqual(c.loop);
    expect(r.warp.markers.timeOf(2)).toBeCloseTo(4 - c.warp.markers.timeOf(4), 9);
  });

  it('the transients seen by a reversed clip are mirrored and in order', () => {
    const ids = sequentialIds();
    const c = AudioClip.fromSample(ids.next('clip'), sampleRef(ids), '#f00');
    expect(clipTimes(c, [0.5, 1, 3], 4)).toEqual([0.5, 1, 3]);
    expect(clipTimes(c.withReversed(true, 4), [0.5, 1, 3], 4)).toEqual([1, 3, 3.5]);
  });
});

describe('AudioClip: crop', () => {
  const ids = sequentialIds();
  // 4 s at 120 BPM: beat b is second b / 2
  const base = AudioClip.fromSample(ids.next('clip'), sampleRef(ids), '#f00');
  const other = asId<'sample'>('sample-99');

  it('with the loop it keeps the stretch under the loop and the clip plays it on the same beats', () => {
    const c = base.withRegion({ start: 1, end: 8 }).withLoop({ enabled: true, start: 2, end: 6 });
    const crop = c.cropped(4, new Tempo(120))!;
    expect([crop.fileStart, crop.fileEnd]).toEqual([1, 3]);
    const r = crop.clip(other);
    expect(r.sample).toBe(other);
    expect(r.region).toEqual({ start: 2, end: 6 });
    expect(r.loop).toEqual({ enabled: true, start: 2, end: 6 });
    for (const b of [2, 3.5, 6]) expect(r.warp.markers.timeOf(b)).toBeCloseTo(c.warp.markers.timeOf(b) - 1, 9);
  });

  it('without loop it keeps the region', () => {
    const crop = base.withRegion({ start: 1, end: 3 }).cropped(4, new Tempo(120))!;
    expect([crop.fileStart, crop.fileEnd]).toEqual([0.5, 1.5]);
    expect(crop.clip(other).loop).toEqual({ enabled: false, start: 1, end: 3 });
  });

  it('reversed: the stretch of the file is the mirrored one', () => {
    const c = base.withLoop({ enabled: true, start: 2, end: 4 }).withReversed(true, 4);
    const crop = c.cropped(4, new Tempo(120))!;
    const t0 = c.warp.markers.timeOf(2), t1 = c.warp.markers.timeOf(4);
    expect(crop.fileStart).toBeCloseTo(4 - t1, 9);
    expect(crop.fileEnd).toBeCloseTo(4 - t0, 9);
    expect(crop.clip(other).reversed).toBe(true);
    expect(crop.clip(other).warp.markers.timeOf(2)).toBeCloseTo(0, 9);
  });

  it('without warp the new file restarts from beat 0, modulations included', () => {
    const c = base.withWarp({ enabled: false }).withRegion({ start: 2, end: 6 })
      .withEnvelope({ kind: 'mixer', param: 'volume' } as ModTarget, [{ beat: 3, value: 0.5 }]);
    const crop = c.cropped(4, new Tempo(60))!; // at 60 BPM beat b is second b
    expect([crop.fileStart, crop.fileEnd]).toEqual([2, 4]); // the sample ends at 4 s
    const r = crop.clip(other);
    expect(r.region).toEqual({ start: 0, end: 4 });
    expect(r.envelopes[0].points[0].beat).toBe(1);
  });

  it('nothing to keep outside the sample', () => {
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

  it('sorts the notes and limits the velocity', () => {
    expect(clip.notes.map(n => n.pitch)).toEqual([126, 60, 64]);
    expect(clip.notes[1].velocity).toBe(127);
  });

  it('transposition and search', () => {
    expect(clip.transposed(3).notes.map(n => n.pitch)).toEqual([63, 67]); // 129 goes out
    expect(clip.notesIn(0.5, 2).map(n => n.pitch)).toEqual([60, 64]);
    expect(clip.removingNotes(n => n.pitch === 60).notes).toHaveLength(2);
  });

  it('rejects invalid notes', () => {
    expect(() => clip.addingNotes({ pitch: 128, start: 0, duration: 1, velocity: 1 })).toThrow(RangeError);
    expect(() => clip.addingNotes({ pitch: 60, start: 0, duration: 0, velocity: 1 })).toThrow(RangeError);
  });
});

describe('MidiClip: duplicate loop', () => {
  const note = (pitch: number, start: number) => ({ pitch, start, duration: 0.5, velocity: 100 });
  const looped = MidiClip.create({
    id: asId('clip-1'), name: 'm', color: '#fff',
    region: { start: 0, end: 8 }, loop: { enabled: true, start: 2, end: 4 },
    notes: [note(60, 0), note(62, 2), note(64, 3.5), note(65, 4), note(67, 6)],
  });

  it('the loop doubles, its notes repeat and take the place of those in the copied stretch', () => {
    const d = looped.duplicatingLoop();
    expect(d.loop).toEqual({ enabled: true, start: 2, end: 6 });
    expect(d.region).toEqual({ start: 0, end: 8 });
    // 0 before the loop stays, 4 (in the copied stretch) disappears, 6 (after) stays
    expect(d.notes.map(n => [n.start, n.pitch])).toEqual([[0, 60], [2, 62], [3.5, 64], [4, 62], [5.5, 64], [6, 67]]);
  });

  it('without loop it doubles the clip, and the linked loop follows it', () => {
    const plain = MidiClip.create({ id: asId('clip-2'), name: 'm', color: '#fff', ...fullRange(0, 4), notes: [note(60, 1)] });
    const d = plain.duplicatingLoop();
    expect(d.region).toEqual({ start: 0, end: 8 });
    expect(d.loop).toEqual({ enabled: false, start: 0, end: 8 });
    expect(d.notes.map(n => n.start)).toEqual([1, 5]);
  });

  it('it also copies the modulations', () => {
    const target: ModTarget = { kind: 'mixer', param: 'volume' };
    const d = looped.withEnvelope(target, [{ beat: 2, value: 0 }, { beat: 4, value: 1 }, { beat: 5, value: 0.5 }]).duplicatingLoop();
    expect(d.envelope(target)!.points).toEqual([
      { beat: 2, value: 0 }, { beat: 4, value: 1 }, { beat: 4, value: 0 }, { beat: 6, value: 1 },
    ]);
  });
});
