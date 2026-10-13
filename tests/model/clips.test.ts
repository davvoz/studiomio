import { describe, expect, it } from 'vitest';
import { asId, sequentialIds } from '../../src/core/id';
import { AudioClip } from '../../src/model/audio-clip';
import { fullRange } from '../../src/model/clip';
import { MidiClip } from '../../src/model/midi-clip';
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
