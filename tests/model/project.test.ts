import { describe, expect, it } from 'vitest';
import { asId, sequentialIds } from '../../src/core/id';
import { AudioClip } from '../../src/model/audio-clip';
import { MidiClip } from '../../src/model/midi-clip';
import { Project } from '../../src/model/project';
import { AudioTrack, MidiTrack } from '../../src/model/track';
import { sampleRef } from '../helpers/fixtures';

describe('Project', () => {
  it('una traccia aggiunta prende uno slot per scena', () => {
    const ids = sequentialIds();
    const p = Project.empty('p', ids, 5).addingTrack(AudioTrack.empty(ids.next('track'), 'a', '#fff', 2));
    expect(p.tracks[0].slots).toHaveLength(5);
  });

  it('scene aggiunte e tolte in tutte le tracce', () => {
    const ids = sequentialIds();
    const clip = MidiClip.empty(ids.next('clip'), 'm', '#fff');
    let p = Project.empty('p', ids, 3)
      .addingTrack(MidiTrack.empty(ids.next('track'), 'm', '#fff', 3))
      .addingTrack(AudioTrack.empty(ids.next('track'), 'a', '#fff', 3));
    p = p.updatingTrack(p.tracks[0].id, t => t.withSlot(2, clip));
    p = p.addingScene({ id: ids.next('scene'), name: 'nuova' }, 0);
    expect(p.tracks.map(t => t.slots.length)).toEqual([4, 4]);
    expect(p.tracks[0].slots[3]).toBe(clip); // la clip scorre con la sua scena
    p = p.removingScene(p.scenes[3].id);
    expect(p.tracks[0].slots).toEqual([null, null, null]);
  });

  it('una traccia accetta solo il suo tipo di clip', () => {
    const ids = sequentialIds();
    const audio = AudioTrack.empty(ids.next('track'), 'a', '#fff', 2);
    const midi = MidiClip.empty(ids.next('clip'), 'm', '#fff');
    expect(() => audio.withSlot(0, midi)).toThrow(/audio non può contenere una clip midi/);
    expect(() => audio.placing({ id: ids.next('placement'), clip: midi, start: 0, length: 4, offset: 0 }, ids)).toThrow(TypeError);
  });

  it('i sample usati non si possono togliere', () => {
    const ids = sequentialIds();
    const s = sampleRef(ids);
    const clip = AudioClip.fromSample(ids.next('clip'), s, '#fff');
    let p = Project.empty('p', ids, 1).addingSample(s).addingSample(sampleRef(ids, { file: 'audio/b.wav' }));
    p = p.addingTrack(AudioTrack.empty(ids.next('track'), 'a', '#fff', 1).withSlot(0, clip));
    expect(() => p.removingSample(s.id)).toThrow(/usato/);
    expect(p.withoutUnusedSamples().samples.map(x => x.id)).toEqual([s.id]);
  });

  it('una clip che usa un sample assente rende il progetto non valido', () => {
    const ids = sequentialIds();
    const clip = AudioClip.fromSample(ids.next('clip'), sampleRef(ids), '#fff');
    const track = AudioTrack.empty(ids.next('track'), 'a', '#fff', 1).withSlot(0, clip);
    expect(() => Project.empty('p', ids, 1).addingTrack(track)).toThrow(/non è nel progetto/);
  });

  it('le parti non toccate sono condivise tra le versioni', () => {
    const ids = sequentialIds();
    const p = Project.empty('p', ids, 1)
      .addingTrack(AudioTrack.empty(asId('track-a'), 'a', '#fff', 1))
      .addingTrack(AudioTrack.empty(asId('track-b'), 'b', '#fff', 1));
    const q = p.updatingTrack(asId('track-a'), t => t.withName('A'));
    expect(q.tracks[1]).toBe(p.tracks[1]);
    expect(q.tracks[0]).not.toBe(p.tracks[0]);
    expect(p.updatingTrack(asId('track-a'), t => t)).toBe(p);
  });
});
