import { describe, expect, it } from 'vitest';
import { sequentialIds, type TrackId } from '../../src/core/id';
import { WarpRenderer } from '../../src/dsp/stretch/warp-renderer';
import type { AudioData } from '../../src/dsp/types';
import { ClipAudio } from '../../src/engine/clip-audio';
import { audibleTracks, MixerGraph } from '../../src/engine/mixer-graph';
import { PlaybackEngine } from '../../src/engine/playback-engine';
import { RenderCache } from '../../src/engine/render-cache';
import { SampleLibrary, type DspBackend } from '../../src/engine/sample-library';
import type { AudioClip } from '../../src/model/audio-clip';
import type { MidiClip } from '../../src/model/midi-clip';
import { Project } from '../../src/model/project';
import type { MidiTrack } from '../../src/model/track';
import type { SampleRef } from '../../src/model/sample';
import {
  addMidiClip, addSample, addTrack, followClipSound, placeSample, setInstrument, setInstrumentParam, setLoopRegion, setMixer, setTempo, updateClip,
} from '../../src/store/edits';
import { ProjectStore } from '../../src/store/project-store';
import { FakeEffects, FakeGraph, FakeInstruments } from '../helpers/fake-audio';
import { drumLoop } from '../helpers/signals';

/** DSP in the same thread, with the real renderer. */
class InlineDsp implements DspBackend {
  private readonly sources = new Map<string, AudioData>();
  renders = 0;
  async loadSource(id: string, audio: AudioData) { this.sources.set(id, audio); }
  async dropSource(id: string) { this.sources.delete(id); }
  async renderWarp(id: string, job: Parameters<WarpRenderer['render']>[1]) {
    this.renders++;
    return new WarpRenderer().render(this.sources.get(id)!, job);
  }
}

/** Project at 120 BPM with an audio track (1-bar loop = 2 s) and a MIDI one. */
async function rig(opts: { prepare?: boolean } = {}) {
  const ids = sequentialIds();
  const store = new ProjectStore(Project.empty('t', ids, 2), ids);
  const audio = { channels: drumLoop(1, 120), sampleRate: 44100 };
  const sample: SampleRef = {
    id: ids.next('sample'), name: 'loop', file: 'audio/loop.wav', sampleRate: 44100, channels: 2,
    frames: audio.channels[0].length, analysis: { tempo: 120, sensitivity: 0.5, transients: [] },
  };
  store.apply(addTrack('audio'));
  store.apply(addTrack('midi'));
  store.apply(addSample(sample));

  const dsp = new InlineDsp();
  const library = new SampleLibrary(dsp);
  await library.add(sample.id, audio);
  const renders = new RenderCache((id, job, key) => library.render(id, job, key));
  const graph = new FakeGraph();
  const clips = new ClipAudio(graph, library, renders);
  let tick: (() => void) | null = null;
  const instruments = new FakeInstruments();
  const effects = new FakeEffects();
  const engine = new PlaybackEngine(graph, { clips, instruments, effects }, {
    timer: { every: (_ms, fn) => { tick = fn; return () => { tick = null; }; } },
    startLatency: 0.05, lookahead: 0.2,
  });
  clips.on('ready', () => engine.refresh());
  const sync = (p: Project) => { clips.setProject(p); engine.setProject(p); };
  store.onChange(sync);
  sync(store.project);

  const t = (i: number): TrackId => store.project.tracks[i].id;
  /** Advances the context's time in steps of 25 ms, like the real timer. */
  const runUntil = (time: number) => {
    while (graph.currentTime < time - 1e-9) {
      graph.currentTime = Math.min(time, graph.currentTime + 0.025);
      tick?.();
    }
  };
  const ready = async () => { if (opts.prepare !== false) await clips.prepare(store.project); };
  return { store, engine, graph, clips, dsp, sample, t, runUntil, ready, instruments, effects };
}

const starts = (g: FakeGraph) => g.sources.filter(s => s.started).map(s => ({
  when: +s.started!.when.toFixed(6), offset: +(s.started!.offset ?? 0).toFixed(6), duration: +(s.started!.duration ?? 0).toFixed(6),
}));

describe('PlaybackEngine: clip audio', () => {
  it('a clip at bar 2 starts after 2 s, at the exact instant', async () => {
    const r = await rig();
    r.store.apply(placeSample(r.t(0), r.sample.id, 4));
    await r.ready();
    r.engine.setProject(r.store.project);
    r.engine.play(0);
    r.runUntil(1.5);
    expect(starts(r.graph)).toEqual([]); // not yet: too far
    r.runUntil(2.0);
    expect(starts(r.graph)).toEqual([{ when: 2.05, offset: 0, duration: 2 }]);
  });

  it('play halfway through a clip: it starts right away, from the right point of the buffer', async () => {
    const r = await rig();
    r.store.apply(placeSample(r.t(0), r.sample.id, 0));
    await r.ready();
    r.engine.play(1); // a beat = 0.5 s into the clip
    expect(starts(r.graph)).toEqual([{ when: 0.05, offset: 0.5, duration: 1.5 }]);
  });

  it('timeline loop: each round restarts from the start of the loop', async () => {
    const r = await rig();
    r.store.apply(placeSample(r.t(0), r.sample.id, 0));
    r.store.apply(setLoopRegion({ enabled: true, start: 0, end: 2 }));
    await r.ready();
    r.engine.play(0);
    r.runUntil(2.2);
    expect(starts(r.graph)).toEqual([
      { when: 0.05, offset: 0, duration: 1 },
      { when: 1.05, offset: 0, duration: 1 },
      { when: 2.05, offset: 0, duration: 1 },
    ]);
    expect(r.engine.position).toBeCloseTo(0.3, 6); // 2.2 s − 0.05 s of latency = 4.3 beats → 0.3 in the loop
  });

  it('at 60 BPM the clip is rendered at the new tempo and lasts twice as long', async () => {
    const r = await rig();
    r.store.apply(placeSample(r.t(0), r.sample.id, 0));
    r.store.apply(setTempo(60));
    await r.ready();
    r.engine.play(0);
    expect(starts(r.graph)).toEqual([{ when: 0.05, offset: 0, duration: 4 }]);
    expect(r.graph.sources[0].buffer!.duration).toBeCloseTo(4, 3);
  });

  it('changing the tempo while playing doesn\'t interrupt: the previous render, then the new one', async () => {
    const r = await rig();
    r.store.apply(placeSample(r.t(0), r.sample.id, 0));
    await r.ready();
    r.engine.play(0);
    r.runUntil(0.55); // beat 1
    r.store.apply(setTempo(60));
    // the previous sound fades out while the new one comes in, where the transport will be
    // (0.6 s = beat 1.1): no gap
    const [old, standIn] = r.graph.sources;
    expect(old.stoppedAt).toBeCloseTo(0.602, 9);
    // the new render isn't there yet: the old one (at 120 BPM) read at half speed stays in time
    expect(standIn.started!.when).toBeCloseTo(0.6, 6);
    expect(standIn.started!.offset).toBeCloseTo(0.55, 6); // beat 1.1 at 120 BPM
    expect(standIn.playbackRate.value).toBe(0.5);
    expect(standIn.buffer).toBe(old.buffer);
    await r.clips.prepare(r.store.project); // the render at the new tempo arrives
    r.engine.refresh();
    const last = starts(r.graph).at(-1)!;
    expect(last.when).toBeCloseTo(0.6, 6);
    // without replaying the piece already heard: beat 1.1 at 60 BPM = 1.1 s into the new buffer
    expect(last.offset).toBeCloseTo(1.1, 6);
    expect(r.graph.sources.at(-1)!.playbackRate.value).toBe(1);
  });

  it('editing a clip while playing reschedules only its track, without stopping anything', async () => {
    const r = await rig();
    r.store.apply(placeSample(r.t(0), r.sample.id, 0));
    r.store.apply(addMidiClip(r.t(1), 0, 4));
    const pl = r.store.project.tracks[1].arrangement[0];
    const note = (pitch: number, start: number) => ({ pitch, start, duration: 0.5, velocity: 100 });
    r.store.apply(updateClip<MidiClip>('notes', r.t(1), pl.id, c => c.addingNotes(note(60, 0), note(62, 1.2))));
    await r.ready();
    r.engine.play(0);
    r.runUntil(0.55); // beat 1: the first note plays, the second (0.65 s) is already scheduled
    const synth = r.instruments.created[0];
    const audioSources = r.graph.sources.length, stops = synth.stops;
    r.store.apply(updateClip<MidiClip>('new note', r.t(1), pl.id, c => c.addingNotes(note(64, 1.3))));
    expect(synth.stops).toBe(stops);
    expect(synth.retakes.map(t => +t.toFixed(9))).toEqual([0.6]);
    // from 0.6 s the notes arrive again (only once); the one already started continues
    expect(synth.notes.map(n => [n.pitch, +n.when.toFixed(6)])).toEqual([[60, 0.05], [62, 0.65], [64, 0.7]]);
    // the audio track wasn't touched
    expect(r.graph.sources).toHaveLength(audioSources);
    expect(r.graph.sources.every(s => s.stoppedAt === null || s.stoppedAt > 1)).toBe(true);
  });

  it('if the render isn\'t ready the clip starts as soon as it arrives', async () => {
    const r = await rig({ prepare: false });
    r.store.apply(placeSample(r.t(0), r.sample.id, 0));
    r.engine.play(0);
    expect(starts(r.graph)).toEqual([]);
    await new Promise<void>(res => r.clips.on('ready', () => res()));
    expect(starts(r.graph)).toHaveLength(1); // automatic refresh
    expect(r.dsp.renders).toBe(1); // requested only once
  });

  it('without warp: the original sample, the transpose changes the speed', async () => {
    const r = await rig();
    r.store.apply(placeSample(r.t(0), r.sample.id, 0));
    const id = r.store.project.tracks[0].arrangement[0].id;
    r.store.apply(updateClip<AudioClip>('no warp', r.t(0), id, c => c.withWarp({ enabled: false }).withTranspose(12)));
    r.engine.play(1);
    const s = r.graph.sources[0];
    expect(s.playbackRate.value).toBe(2);
    expect(s.started).toMatchObject({ when: 0.05, offset: 1 }); // 0.5 s of timeline at double speed
    expect(s.buffer!.length).toBe(r.sample.frames); // the original sample, not a render
  });

  it('stop stops everything and notifies', async () => {
    const r = await rig();
    const states: boolean[] = [];
    r.engine.onStateChange(p => states.push(p));
    r.store.apply(placeSample(r.t(0), r.sample.id, 0));
    await r.ready();
    r.engine.play(0);
    r.engine.stop();
    expect(r.graph.sources.every(s => s.stoppedAt === -1)).toBe(true);
    expect(states).toEqual([true, false]);
    expect(r.engine.playing).toBe(false);
  });
});

describe('PlaybackEngine: MIDI and metronome', () => {
  it('the notes play with the instrument, also in the rounds of the clip\'s loop', async () => {
    const r = await rig();
    r.store.apply(addMidiClip(r.t(1), 0, 4)); // empty 4-beat clip, looping, placed for 4
    const pl = r.store.project.tracks[1].arrangement[0];
    r.store.apply(updateClip<MidiClip>('note', r.t(1), pl.id, c => c
      .withLoop({ enabled: true, start: 0, end: 2 })
      .addingNotes({ pitch: 60, start: 0, duration: 0.5, velocity: 100 }, { pitch: 67, start: 1.5, duration: 1, velocity: 50 })));
    r.engine.play(0);
    r.runUntil(2);
    const synth = r.instruments.created[0];
    const notes = synth.notes.map(n => ({ pitch: n.pitch, when: +n.when.toFixed(6), duration: +n.duration.toFixed(6) }));
    expect(notes).toEqual([
      { pitch: 60, when: 0.05, duration: 0.25 },
      // the second note (1 beat) is cut at the end of the round: it lasts 0.5 beats
      { pitch: 67, when: 0.8, duration: 0.25 },
      { pitch: 60, when: 1.05, duration: 0.25 }, // second round (beat 2)
      { pitch: 67, when: 1.8, duration: 0.25 },
    ]);
    expect(synth.notes[1].velocity).toBe(50);
    // the same notes, for the interface: asking by time intervals
    expect(r.engine.notesStarted(r.t(1), 0, 1)).toEqual([60, 67]);
    expect(r.engine.notesStarted(r.t(1), 1, 1.5)).toEqual([60]);
    r.engine.stop();
    expect(r.engine.notesStarted(r.t(1), 1.5, 3)).toEqual([]);
  });

  it('the instrument follows the track: parameters on the fly, new type = new instrument', async () => {
    const r = await rig();
    const synth = r.instruments.created[0];
    expect(synth.type).toBe('analog');
    r.store.apply(setInstrumentParam(r.t(1), 'cutoff', 500));
    expect(synth.updates.at(-1)?.params.cutoff).toBe(500);
    expect(r.instruments.created).toHaveLength(1);
    r.store.apply(setInstrument(r.t(1), { type: 'other', preset: null, params: {} }));
    expect(synth.disposed).toBe(true);
    expect(r.instruments.created[1].type).toBe('other');
    r.engine.audition(r.t(1), 64, 90, 0.5);
    expect(r.instruments.created[1].notes).toEqual([{ pitch: 64, velocity: 90, when: 0.005, duration: 0.5 }]);
  });

  it('a note played by hand stays on until it\'s released, even with the transport stopped', async () => {
    const r = await rig();
    const synth = r.instruments.created[0];
    r.engine.pressNote(r.t(1), 64, 90);
    expect(synth.held.get(64)).toBe(90);
    r.engine.releaseNote(r.t(1), 64);
    expect(synth.held.size).toBe(0);
  });

  it('a clip with a sound gives it to the instrument when it starts, only once; the project follows it', async () => {
    const r = await rig();
    const bright = { type: 'analog', preset: 'Bright', params: { cutoff: 9000 } };
    r.store.apply(addMidiClip(r.t(1), 0, 2)); // looping, placed for 2 beats
    r.store.apply(addMidiClip(r.t(1), 2, 2));
    const [a, b] = r.store.project.tracks[1].arrangement;
    r.store.apply(updateClip<MidiClip>('short loop', r.t(1), a.id, c => c.withLoop({ enabled: true, start: 0, end: 1 })));
    r.store.apply(updateClip<MidiClip>('sound', r.t(1), b.id, c => c.withSound(bright)));
    const heard: unknown[] = [];
    r.engine.onClipSound((track, sound) => {
      heard.push([track, sound]);
      r.store.apply(followClipSound(track, sound), { transient: true });
    });
    const synth = r.instruments.created[0];
    r.engine.play(0);
    r.runUntil(1.6); // the second clip starts at beat 2 (1.05 s), and does a round
    expect(synth.updates).toEqual([bright]);
    expect(synth.updateTimes.map(t => +t!.toFixed(6))).toEqual([1.05]);
    await Promise.resolve();
    expect(heard).toEqual([[r.t(1), bright]]);
    expect((r.store.project.tracks[1] as MidiTrack).instrument).toBe(bright);
    expect(r.store.canUndo).toBe(true); // the previous steps are still there…
    expect(r.store.undoLabel).toBe('sound'); // …and the sound change isn't one of them
    // retouching the instrument while the clip plays: the clip's sound doesn't come back
    r.store.apply(setInstrumentParam(r.t(1), 'cutoff', 300));
    r.runUntil(2);
    expect(synth.updates.map(u => u.params.cutoff)).toEqual([9000, 300]);
    // after the stop, restarting inside the clip gives back its sound
    r.engine.stop();
    r.engine.play(2.5);
    expect(synth.updates.at(-1)).toBe(bright);
  });

  it('a clip\'s sound for another instrument type is ignored', async () => {
    const r = await rig();
    r.store.apply(addMidiClip(r.t(1), 0, 2));
    const pl = r.store.project.tracks[1].arrangement[0];
    r.store.apply(updateClip<MidiClip>('sound', r.t(1), pl.id, c => c.withSound({ type: 'other', preset: null, params: {} })));
    r.engine.play(0);
    r.runUntil(0.5);
    expect(r.instruments.created).toHaveLength(1);
    expect(r.instruments.created[0].updates).toEqual([]);
  });

  it('the instrument is born with the project\'s tempo and follows it when it changes', async () => {
    const r = await rig();
    const synth = r.instruments.created[0];
    expect(synth.bpm).toBe(120);
    r.store.apply(setInstrumentParam(r.t(1), 'cutoff', 500));
    expect(synth.tempos).toEqual([]);
    r.store.apply(setTempo(140));
    expect(synth.tempos).toEqual([140]);
    r.store.apply(setInstrument(r.t(1), { type: 'other', preset: null, params: {} }));
    expect(r.instruments.created[1].bpm).toBe(140);
  });

  it('the effects know where the transport is: at every start, loop round and jump; stopped at the stop', async () => {
    const r = await rig();
    r.store.apply(setLoopRegion({ enabled: true, start: 1, end: 3 }));
    r.engine.play(0);
    r.runUntil(1.6);
    const bar = { bpm: 120, beatsPerBar: 4 };
    // from 0 to 3 (1.5 s), then again from 1
    expect(r.effects.anchors).toEqual([{ time: 0.05, beat: 0, ...bar }, { time: 1.55, beat: 1, ...bar }]);
    r.engine.seek(2);
    expect(r.effects.anchors.at(-1)).toEqual({ time: expect.closeTo(1.65, 9), beat: 2, ...bar });
    r.engine.stop();
    expect(r.effects.anchors.at(-1)).toBeNull();
  });

  it('metronome: a click per beat, accent on the first of the bar', async () => {
    const r = await rig();
    r.engine.metronomeOn = true;
    r.engine.play(0);
    r.runUntil(2.0);
    const clicks = r.graph.oscillators.map(o => [+o.started!.when.toFixed(6), o.frequency.value]);
    expect(clicks.slice(0, 5)).toEqual([[0.05, 1600], [0.55, 1000], [1.05, 1000], [1.55, 1000], [2.05, 1600]]);
  });
});

describe('mixer', () => {
  it('solo e mute', async () => {
    const r = await rig();
    const [a, m] = [r.t(0), r.t(1)];
    expect(audibleTracks(r.store.project.tracks)).toEqual(new Set([a, m]));
    r.store.apply(setMixer(a, { solo: true }));
    expect(audibleTracks(r.store.project.tracks)).toEqual(new Set([a]));
    r.store.apply(setMixer(a, { mute: true }));
    expect(audibleTracks(r.store.project.tracks)).toEqual(new Set());
  });

  it('volume and pan in the nodes, channels removed with the tracks', async () => {
    const r = await rig();
    const g = new FakeGraph();
    const mixer = new MixerGraph(g, new FakeEffects());
    r.store.apply(setMixer(r.t(0), { volumeDb: -6, pan: 0.5 }));
    mixer.sync(r.store.project);
    expect(g.gains[4].gain.value).toBeCloseTo(0.501, 3); // [0] bus, [1] master, [2] input, [3] tap, [4] volume
    expect(g.panners[0].pan.value).toBe(0.5);
    mixer.sync(r.store.project.removingTrack(r.t(0)));
    expect(g.gains[4].connected).toBe(false);
  });
});
