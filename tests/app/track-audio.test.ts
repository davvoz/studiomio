import { describe, expect, it } from 'vitest';
import { stemNames, TrackAudio } from '../../src/app/track-audio';
import { trimSilence } from '../../src/engine/offline-mix';
import type { Project } from '../../src/model/project';
import { AudioTrack, type Track } from '../../src/model/track';
import { MemoryDirectory } from '../../src/persistence/directory';
import { addMidiClip, renameTrack, setLoopRegion } from '../../src/store/edits';
import { sampleRef, setup } from '../helpers/fixtures';

const SR = 1000;

function rig() {
  const r = setup({ midi: 3 });
  const [a, b] = [0, 1].map(r.track);
  r.store.apply(renameTrack(a, 'Kick'));
  r.store.apply(renameTrack(b, 'Bass'));
  r.store.apply(addMidiClip(a, 0, 4));
  r.store.apply(addMidiClip(b, 2, 4));
  const renders: { from: number; to: number; project: Project; tail?: number }[] = [];
  const dir = new MemoryDirectory('Export');
  const said: string[] = [];
  let pending: Promise<void> = Promise.resolve();
  const audio = new TrackAudio({
    store: r.store,
    sampleRate: () => SR,
    render: async (from, to, project, tail) => {
      renders.push({ from, to, project, tail });
      // the tempo is 120: half a second per beat, plus the tail
      const frames = Math.round(((to - from) / 2 + (tail ?? 1)) * SR);
      const c = new Float32Array(frames);
      c[10] = 0.5;
      return [c, c.slice()];
    },
    addAudio: async name => sampleRef(r.ids, { name }),
    pickFolder: async () => dir,
    projectName: () => 'Song',
    run: action => { pending = action(); },
    say: t => said.push(t),
  });
  return { ...r, a, b, audio, renders, dir, said, done: () => pending };
}

describe('the tracks as audio', () => {
  it('export: one 32-bit float WAV per track with clips, all as long as the mix, in a new folder', async () => {
    const r = rig();
    r.audio.exportStems();
    await r.done();
    expect(await r.dir.list('Song - tracks')).toEqual(['1 Kick.wav', '2 Bass.wav']);
    expect(r.renders.map(x => [x.from, x.to])).toEqual([[0, 6], [0, 6]]);
    // the stem of each track: only it is soloed
    expect(r.renders.map(x => x.project.tracks.filter(t => t.mixer.solo).map(t => t.name))).toEqual([['Kick'], ['Bass']]);
    const wav = await r.dir.readBytes('Song - tracks/1 Kick.wav');
    expect(new DataView(wav.buffer).getUint16(20, true)).toBe(3); // IEEE float
    expect(r.said.at(-1)).toMatch(/2 tracks exported into "Export\/Song - tracks" \(WAV 32-bit float, without the master's effects\)/);
    // a second export doesn't overwrite the first
    r.store.apply(setLoopRegion({ enabled: true, start: 1, end: 3 }));
    r.audio.exportStems();
    await r.done();
    expect(await r.dir.list('Song - tracks 2')).toHaveLength(2);
    expect(r.renders.at(-1)).toMatchObject({ from: 1, to: 3 });
  });

  it('render to audio: each track from its first clip, the silence at the end cut, the originals muted', async () => {
    const r = rig();
    r.audio.bounce();
    await r.done();
    expect(r.renders.map(x => [x.from, x.to, x.tail])).toEqual([[0, 4, 8], [2, 6, 8]]);
    const made = r.store.project.tracks.filter(t => t instanceof AudioTrack);
    expect(made.map(t => t.name)).toEqual(['Kick (audio)', 'Bass (audio)']);
    // 4 beats = 2 s: the tail after it is silent, it goes
    expect(made.map(t => [t.arrangement[0].start, t.arrangement[0].length])).toEqual([[0, 4], [2, 4]]);
    expect(r.store.project.track(r.a)!.mixer.mute).toBe(true);
    expect(r.said.at(-1)).toMatch(/2 tracks are now audio tracks/);
    // exporting now: the originals are muted, only the audio tracks go out
    r.audio.exportStems();
    await r.done();
    expect(await r.dir.list('Song - tracks')).toEqual(['1 Kick (audio).wav', '2 Bass (audio).wav']);
    expect(r.said.at(-1)).toMatch(/2 muted tracks left out/);
  });

  it('render a chosen track; nothing to do without clips', async () => {
    const r = rig();
    r.audio.bounce([r.track(2)]);
    expect(r.said.at(-1)).toMatch(/no clips/);
    r.audio.bounce([r.b]);
    await r.done();
    expect(r.renders).toHaveLength(1);
    expect(r.store.project.tracks.map(t => t.name)).toContain('Bass (audio)');
  });
});

describe('trimSilence', () => {
  it('cuts the silence at the end, keeping at least the given length and what still sounds', () => {
    const c = new Float32Array(10);
    c[6] = 0.001;
    expect(trimSilence([c], 3)[0]).toHaveLength(7);
    expect(trimSilence([new Float32Array(10)], 4)[0]).toHaveLength(4);
    expect(trimSilence([new Float32Array(10), c], 2).map(x => x.length)).toEqual([7, 7]);
  });
});

describe('stem names', () => {
  it('numbered in order, as the disk accepts them', () => {
    const named = (...names: string[]) => names.map(name => ({ name }) as unknown as Track);
    expect(stemNames(named('Kick', 'Bass: sub/low?', 'Pad.', ' '))).toEqual(['1 Kick.wav', '2 Bass_ sub_low_.wav', '3 Pad.wav', '4 audio.wav']);
    expect(stemNames(named(...Array.from({ length: 10 }, () => 'x')))[0]).toBe('01 x.wav');
  });
});
