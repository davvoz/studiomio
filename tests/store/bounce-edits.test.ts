import { describe, expect, it } from 'vitest';
import { AudioClip } from '../../src/model/audio-clip';
import { AudioTrack } from '../../src/model/track';
import { bouncedTracks } from '../../src/store/bounce-edits';
import { addBus, addMidiClip, groupTracks, removeTrack, setMixer, setSend } from '../../src/store/edits';
import { sampleRef, setup } from '../helpers/fixtures';

describe('render to audio tracks', () => {
  it('a new audio track right below, with the same mixer and the file where the clips were; the original muted', () => {
    const r = setup({ midi: 3 });
    const [a, b] = [0, 1].map(r.track);
    r.store.apply(groupTracks([a, b]));
    r.store.apply(addBus());
    const bus = r.store.project.buses[0].id;
    r.store.apply(setSend(a, bus, -6));
    r.store.apply(setMixer(a, { volumeDb: -3, pan: -0.25 }));
    r.store.apply(addMidiClip(a, 4, 8));
    const sample = sampleRef(r.ids, { name: 'Bounce' });
    r.store.apply(bouncedTracks([{ source: a, sample, start: 4, length: 9 }]));

    const p = r.store.project, source = p.track(a)!;
    const i = p.tracks.findIndex(t => t.id === a), made = p.tracks[i + 1];
    expect(made).toBeInstanceOf(AudioTrack);
    expect(made.name).toBe(`${source.name} (audio)`);
    expect(made.mixer).toEqual({ volumeDb: -3, pan: -0.25, mute: false, solo: false });
    expect(made.sends).toEqual({ [bus]: -6 });
    expect(made.group).toBe(source.group);
    expect(source.mixer.mute).toBe(true);
    expect(p.sample(sample.id)).toBeDefined();
    const [pl] = made.arrangement;
    expect(pl).toMatchObject({ start: 4, length: 9, offset: 0 });
    expect(pl.clip).toBeInstanceOf(AudioClip);
    expect(pl.clip.loop.enabled).toBe(false);
    // the second track of the group comes after
    expect(p.tracks[i + 2].id).toBe(b);
  });

  it('several tracks are a single undo step; a track deleted meanwhile is skipped', () => {
    const r = setup({ midi: 2 });
    const [a, b] = [0, 1].map(r.track);
    const before = r.store.project;
    const items = [a, b].map(source => ({ source, sample: sampleRef(r.ids), start: 0, length: 4 }));
    r.store.apply(removeTrack(b));
    r.store.apply(bouncedTracks(items));
    expect(r.store.project.tracks).toHaveLength(2);
    r.store.undo();
    r.store.undo();
    expect(r.store.project).toBe(before);
  });
});
