import { describe, expect, it } from 'vitest';
import { sequentialIds, type TrackId } from '../../src/core/id';
import { NoteQueue } from '../../src/devices/worklet/note-queue';
import { PlaybackEngine } from '../../src/engine/playback-engine';
import { clipSegmentsBetween } from '../../src/engine/segments';
import { groupSlotState, sceneState } from '../../src/engine/session';
import { MidiClip, type Note } from '../../src/model/midi-clip';
import { Project } from '../../src/model/project';
import { captureScene } from '../../src/store/session-edits';
import { addMidiClip, addTrack, groupTracks, resizePlacement, setLaunchQuantization, setLoopRegion, setSlot, updateClip } from '../../src/store/edits';
import { ProjectStore } from '../../src/store/project-store';
import { FakeEffects, FakeGraph, FakeInstruments } from '../helpers/fake-audio';

const note = (pitch: number, start: number, duration = 0.5): Note => ({ pitch, start, duration, velocity: 100 });

/** 120 BPM (a beat = 0.5 s), two MIDI tracks, two scenes. On track 0's timeline
 *  a clip with a low E (40) at every beat for 16 bars, on track 1 an A (45) at the start; in the
 *  slots: A (60 at every beat) and B (72 on alternate beats) on track 0, C (50) on track 1. */
function rig() {
  const ids = sequentialIds();
  const store = new ProjectStore(Project.empty('t', ids, 2), ids);
  store.apply(addTrack('midi'));
  store.apply(addTrack('midi'));
  const t = (i: number): TrackId => store.project.tracks[i].id;
  store.apply(addMidiClip(t(0), 0, 4));
  const pl = store.project.tracks[0].arrangement[0];
  store.apply(updateClip<MidiClip>('n', t(0), pl.id, c => c.addingNotes(...[0, 1, 2, 3].map(b => note(40, b)))));
  store.apply(resizePlacement(t(0), pl.id, { end: 64 })); // the looping clip covers 16 bars
  store.apply(addMidiClip(t(1), 0, 4));
  const pl1 = store.project.tracks[1].arrangement[0];
  store.apply(updateClip<MidiClip>('n', t(1), pl1.id, c => c.addingNotes(note(45, 0))));
  const clip = (name: string, ...notes: Note[]) => MidiClip.empty(ids.next('clip'), name, '#fff', 4).addingNotes(...notes);
  store.apply(setSlot(t(0), 0, clip('A', ...[0, 1, 2, 3].map(b => note(60, b)))));
  store.apply(setSlot(t(0), 1, clip('B', note(72, 0), note(72, 2))));
  store.apply(setSlot(t(1), 0, clip('C', note(50, 0))));

  const graph = new FakeGraph(), instruments = new FakeInstruments();
  let tick: (() => void) | null = null;
  const engine = new PlaybackEngine(graph, { clips: { playable: () => null }, instruments, effects: new FakeEffects() }, {
    timer: { every: (_ms, fn) => { tick = fn; return () => { tick = null; }; } }, startLatency: 0.05, lookahead: 0.2,
  });
  store.onChange(p => engine.setProject(p));
  engine.setProject(store.project);
  const runUntil = (time: number) => {
    while (graph.currentTime < time - 1e-9) {
      graph.currentTime = Math.min(time, graph.currentTime + 0.025);
      tick?.();
    }
  };
  /** Notes played by track `i`: [pitch, instant]. */
  const played = (i: number, pitch?: number) => instruments.created[i].notes
    .filter(n => pitch === undefined || n.pitch === pitch).map(n => [n.pitch, +n.when.toFixed(4)]);
  const state = (i: number) => engine.sessionState(store.project.tracks[i]);
  return { store, engine, graph, instruments, t, runUntil, played, state };
}

describe('session: launching clips', () => {
  it('when stopped a clip starts the transport and takes the place of its track\'s timeline', () => {
    const r = rig();
    r.engine.launchSlot(r.t(0), 0);
    expect(r.engine.playing).toBe(true);
    r.runUntil(2.2);
    expect(r.played(0)).toEqual([[60, 0.05], [60, 0.55], [60, 1.05], [60, 1.55], [60, 2.05]]);
    expect(r.played(1)).toEqual([[45, 0.05]]); // the other track follows the timeline
    expect(r.state(0)).toMatchObject({ playing: { slot: 0 }, queued: null, followsArrangement: false });
    expect(r.state(1)).toMatchObject({ playing: null, followsArrangement: true });
    expect(r.engine.arrangementOverridden).toBe(true);
  });

  it('during play it starts at the next bar: the timeline plays up to there, then the clip', () => {
    const r = rig();
    r.engine.play(0);
    r.runUntil(0.6);
    r.engine.launchSlot(r.t(0), 1);
    expect(r.state(0).queued).toEqual({ slot: 1 });
    r.runUntil(3.2);
    // bar 2 = beat 4 = 2.05 s
    expect(r.played(0, 40)).toEqual([[40, 0.05], [40, 0.55], [40, 1.05], [40, 1.55]]);
    expect(r.played(0, 72)).toEqual([[72, 2.05], [72, 3.05]]);
    expect(r.instruments.created[0].cuts).toEqual([2.05]); // what was already scheduled is cut there
    expect(r.state(0)).toMatchObject({ playing: { slot: 1 }, queued: null });
  });

  it('with the timeline loop the session clips don\'t jump: they continue in phase', () => {
    const r = rig();
    r.store.apply(setLoopRegion({ enabled: true, start: 0, end: 3 }));
    r.engine.launchSlot(r.t(0), 0);
    r.runUntil(4.1);
    // the timeline goes back every 1.5 s; the clip plays a beat every 0.5 s without gaps or duplicates
    expect(r.played(0)).toEqual([0.05, 0.55, 1.05, 1.55, 2.05, 2.55, 3.05, 3.55, 4.05].map(t => [60, t]));
    expect(r.played(1)).toEqual([[45, 0.05], [45, 1.55], [45, 3.05]]); // the timeline does
  });

  it('a scene launches the row\'s clips and stops the tracks with an empty slot', () => {
    const r = rig();
    r.engine.play(0);
    r.runUntil(0.3);
    r.engine.launchScene(1);
    r.runUntil(4.2);
    expect(r.played(0, 72)).toEqual([[72, 2.05], [72, 3.05], [72, 4.05]]);
    expect(r.played(1)).toEqual([[45, 0.05]]); // from bar 2 track 1 is silent
    expect(r.state(1)).toMatchObject({ playing: null, followsArrangement: false });
  });

  it('stop of a track, "stop all", back to the arrangement', () => {
    const r = rig();
    r.engine.launchScene(0);
    r.runUntil(0.6);
    r.engine.stopTrack(r.t(1));
    expect(r.state(1).queued).toBe('stop');
    r.runUntil(2.2);
    expect(r.state(1)).toMatchObject({ playing: null, queued: null });
    r.engine.stopAllClips();
    r.runUntil(4.3);
    expect(r.played(0).at(-1)).toEqual([60, 3.55]); // clip A stops at bar 3 (4.05 s)
    r.engine.backToArrangement();
    expect(r.engine.arrangementOverridden).toBe(false);
    r.runUntil(5.2);
    expect(r.played(0, 40).length).toBeGreaterThan(0); // the timeline resumes at once
    expect(r.state(0).followsArrangement).toBe(true);
  });

  it('with the transport stopped, at play the clips that were playing restart from the start (the timeline stays off)', () => {
    const r = rig();
    r.engine.launchScene(0);
    r.runUntil(0.7);
    r.engine.stop();
    expect(r.state(0)).toMatchObject({ playing: null, followsArrangement: false });
    r.engine.play(0);
    r.runUntil(1.5);
    expect(r.played(0)).toEqual([[60, 0.05], [60, 0.55], [60, 0.75], [60, 1.25]]); // A restarts with the transport
    expect(r.played(1)).toEqual([[50, 0.05], [50, 0.75]]); // and C with it
    expect(r.state(0)).toMatchObject({ playing: { slot: 0 }, followsArrangement: false });
    r.engine.stop();
    r.engine.backToArrangement();
    r.engine.play(0);
    r.runUntil(2.3);
    expect(r.played(0, 40).length).toBeGreaterThan(0);
    expect(r.state(0).playing).toBeNull();
  });

  it('a stopped track, or "stop all" with the transport stopped: at play those clips don\'t restart', () => {
    const r = rig();
    r.engine.launchScene(0);
    r.runUntil(0.6);
    r.engine.stopTrack(r.t(1));
    r.runUntil(2.2);
    r.engine.stop();
    r.engine.play(0);
    r.runUntil(2.6);
    expect(r.state(0).playing).toMatchObject({ slot: 0 });
    expect(r.state(1).playing).toBeNull(); // it was already stopped
    r.engine.stop();
    r.engine.stopAllClips();
    r.engine.play(0);
    r.runUntil(3);
    expect(r.state(0).playing).toBeNull();
    expect(r.engine.playing).toBe(true);
  });

  it('a clip without loop already finished doesn\'t restart', () => {
    const r = rig();
    const a = r.store.project.tracks[0].slots[0]!;
    const once = MidiClip.empty(a.id, 'A', '#fff', 4).addingNotes(note(60, 0));
    r.store.apply(setSlot(r.t(0), 0, once.withLoop({ ...once.loop, enabled: false })));
    r.engine.launchSlot(r.t(0), 0);
    r.runUntil(2.5);
    r.engine.stop();
    r.engine.play(0);
    r.runUntil(3.5);
    expect(r.played(0)).toEqual([[60, 0.05]]);
  });

  it('when stopped, launching a clip makes it start in place of the remembered one on the same track', () => {
    const r = rig();
    r.engine.launchScene(0);
    r.runUntil(0.6);
    r.engine.stop();
    r.engine.launchSlot(r.t(0), 1);
    r.runUntil(1.2);
    expect(r.state(0).playing).toMatchObject({ slot: 1 });
    expect(r.state(1).playing).toMatchObject({ slot: 0 }); // the other track resumes its own
  });

  it('a clip without loop plays once and ends', () => {
    const r = rig();
    const a = r.store.project.tracks[0].slots[0]!;
    const once = MidiClip.empty(a.id, 'A', '#fff', 4).addingNotes(note(60, 0), note(60, 3));
    r.store.apply(setSlot(r.t(0), 0, once.withLoop({ ...once.loop, enabled: false })));
    r.engine.launchSlot(r.t(0), 0);
    r.runUntil(5);
    expect(r.played(0)).toEqual([[60, 0.05], [60, 1.55]]);
    expect(r.state(0).playing).toBeNull();
  });

  it('editing the playing clip: it\'s heard right away and stays in phase', () => {
    const r = rig();
    r.engine.launchSlot(r.t(0), 1);
    r.runUntil(1.2);
    const b = r.store.project.tracks[0].slots[1] as MidiClip;
    r.store.apply(setSlot(r.t(0), 1, b.addingNotes(note(74, 3))));
    r.runUntil(3.2);
    expect(r.played(0, 74).length).toBe(1);
    expect(r.played(0, 74)[0][1]).toBeCloseTo(1.55, 1); // beat 3 of the clip, 1.5 s after the launch
    expect(r.played(0, 72).length).toBeGreaterThanOrEqual(3);
  });

  it('without quantization it starts as soon as possible', () => {
    const r = rig();
    r.store.apply(setLaunchQuantization('none'));
    r.engine.play(0);
    r.runUntil(0.6);
    r.engine.launchSlot(r.t(0), 1);
    r.runUntil(1.5);
    const [first] = r.played(0, 72);
    expect(first[1]).toBeGreaterThan(0.6);
    expect(first[1]).toBeLessThan(0.85); // within the scheduling lookahead
  });

  it('capture and insert scene: the clips continue without interruption, now from the new scene', () => {
    const r = rig();
    r.engine.launchSlot(r.t(0), 1); // B, and track 1 follows the timeline
    r.runUntil(1.2);
    const playing = r.engine.playingClips();
    expect([...playing.keys()]).toEqual([r.t(0)]);
    r.store.apply(captureScene(1, playing));
    r.runUntil(4.2);
    expect(r.played(0, 72)).toEqual([[72, 0.05], [72, 1.05], [72, 2.05], [72, 3.05], [72, 4.05]]);
    expect(r.instruments.created[0].cuts).toEqual([]);
    expect(r.state(0)).toMatchObject({ playing: { slot: 2 }, queued: null });
    expect(r.store.project.tracks[0].slots[1]?.name).toBe('B'); // in its place, a copy
  });
});

describe('session: state of the scenes', () => {
  it('a scene is queued until the boundary, then it plays while one of its clips plays', () => {
    const r = rig();
    const scene = (s: number) => sceneState(r.store.project.tracks.map(t => [t, r.engine.sessionState(t)] as const), s);
    r.engine.play(0);
    r.runUntil(0.3);
    r.engine.launchScene(0);
    expect(scene(0)).toEqual({ clips: true, playing: false, queued: true });
    r.runUntil(2.2);
    expect(scene(0)).toEqual({ clips: true, playing: true, queued: false });
    expect(scene(1)).toEqual({ clips: true, playing: false, queued: false });
    // track a switches to scene 1's clip: both scenes play
    r.engine.launchSlot(r.t(0), 1);
    r.runUntil(4.2);
    expect(scene(0).playing && scene(1).playing).toBe(true);
    // b stops too: nothing of scene 0 plays any more
    r.engine.stopTrack(r.t(1));
    r.runUntil(6.2);
    expect(scene(0).playing).toBe(false);
    expect(scene(1).playing).toBe(true);
  });
});

describe('session: groups', () => {
  it('a group\'s slot launches the row of its tracks (like a scene), the stop stops them', () => {
    const r = rig();
    const [a, b] = [r.t(0), r.t(1)];
    r.store.apply(groupTracks([a, b]));
    const group = r.store.project.tracks[0];
    r.engine.play(0);
    r.runUntil(0.3);
    r.engine.launchSlot(group.id, 1);
    r.runUntil(2.2);
    expect(r.played(0, 72)).toEqual([[72, 2.05]]);
    expect(r.played(1)).toEqual([[45, 0.05]]); // track b has no clip in the row: it stops
    expect(r.engine.sessionState(group)).toMatchObject({ playing: { slot: 1 }, followsArrangement: false });
    expect(r.engine.takenTracks.has(a) && !r.engine.takenTracks.has(group.id)).toBe(true);
    const members = r.store.project.soundingTracks(group.id).map(t => [t, r.engine.sessionState(t)] as const);
    expect(groupSlotState(members, 0)).toEqual({ clips: true, playing: false, queued: false });
    expect(groupSlotState(members, 1)).toEqual({ clips: true, playing: true, queued: false });
    r.engine.stopTrack(group.id);
    expect(r.engine.sessionState(group).queued).toBe('stop');
    r.runUntil(4.2);
    expect(r.engine.sessionState(group).playing).toBeNull();
  });

  it('a scene doesn\'t touch the groups: only the tracks', () => {
    const r = rig();
    r.store.apply(groupTracks([r.t(0)]));
    r.engine.launchScene(0);
    expect(r.engine.takenTracks.has(r.store.project.tracks[0].id)).toBe(false);
  });
});

describe('session: building blocks', () => {
  it('the stretches of a looping clip are computed only in the window', () => {
    const clip = MidiClip.empty(sequentialIds().next('clip'), 'x', '#fff', 4);
    const segs = clipSegmentsBetween(clip, 100, 1000, 1009);
    expect(segs.map(s => [s.start, s.end, s.contentStart])).toEqual([[1000, 1004, 0], [1004, 1008, 0], [1008, 1012, 0]]);
    const once = clip.withLoop({ ...clip.loop, enabled: false });
    expect(clipSegmentsBetween(once, 100, 101, 200).map(s => [s.start, s.end])).toEqual([[100, 104]]);
    expect(clipSegmentsBetween(once, 100, 104, 200)).toEqual([]);
  });

  it('the cut in the worklet: notes after removed, straddling notes closed there', () => {
    const q = new NoteQueue();
    q.add(60, 100, 0, 1000);
    q.add(62, 100, 400, 600);
    q.add(64, 100, 800, 900);
    q.cutAt(500);
    const ons: number[] = [], offs: number[] = [];
    const core = { setParams() {}, noteOn: (id: number) => ons.push(id), noteOff: (id: number) => offs.push(id), silence() {}, render() {} };
    q.renderBlock(core, new Float32Array(2000), new Float32Array(2000), 0);
    expect(ons).toEqual([1, 2]); // the 64 doesn't start any more
    expect(offs.sort()).toEqual([1, 2]); // 60 and 62 end at 500
  });
});
