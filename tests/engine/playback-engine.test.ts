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
import type { SampleRef } from '../../src/model/sample';
import {
  addMidiClip, addSample, addTrack, placeSample, setInstrument, setInstrumentParam, setLoopRegion, setMixer, setTempo, updateClip,
} from '../../src/store/edits';
import { ProjectStore } from '../../src/store/project-store';
import { FakeEffects, FakeGraph, FakeInstruments } from '../helpers/fake-audio';
import { drumLoop } from '../helpers/signals';

/** DSP nello stesso thread, con il renderer vero. */
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

/** Progetto a 120 BPM con una traccia audio (loop di 1 battuta = 2 s) e una MIDI. */
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
  /** Porta avanti il tempo del contesto a passi di 25 ms, come il timer vero. */
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
  it('una clip a battuta 2 parte dopo 2 s, all\'istante esatto', async () => {
    const r = await rig();
    r.store.apply(placeSample(r.t(0), r.sample.id, 4));
    await r.ready();
    r.engine.setProject(r.store.project);
    r.engine.play(0);
    r.runUntil(1.5);
    expect(starts(r.graph)).toEqual([]); // non ancora: troppo lontana
    r.runUntil(2.0);
    expect(starts(r.graph)).toEqual([{ when: 2.05, offset: 0, duration: 2 }]);
  });

  it('play a metà clip: parte subito, dal punto giusto del buffer', async () => {
    const r = await rig();
    r.store.apply(placeSample(r.t(0), r.sample.id, 0));
    await r.ready();
    r.engine.play(1); // un battito = 0.5 s dentro la clip
    expect(starts(r.graph)).toEqual([{ when: 0.05, offset: 0.5, duration: 1.5 }]);
  });

  it('loop della timeline: ogni giro riparte dall\'inizio del loop', async () => {
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
    expect(r.engine.position).toBeCloseTo(0.3, 6); // 2.2 s − 0.05 s di latenza = 4.3 battiti → 0.3 nel loop
  });

  it('a 60 BPM la clip è renderizzata al tempo nuovo e dura il doppio', async () => {
    const r = await rig();
    r.store.apply(placeSample(r.t(0), r.sample.id, 0));
    r.store.apply(setTempo(60));
    await r.ready();
    r.engine.play(0);
    expect(starts(r.graph)).toEqual([{ when: 0.05, offset: 0, duration: 4 }]);
    expect(r.graph.sources[0].buffer!.duration).toBeCloseTo(4, 3);
  });

  it('cambiare il tempo mentre suona ferma le sorgenti e riprogramma', async () => {
    const r = await rig();
    r.store.apply(placeSample(r.t(0), r.sample.id, 0));
    await r.ready();
    r.engine.play(0);
    r.runUntil(0.55); // battito 1
    r.store.apply(setTempo(60));
    expect(r.graph.sources[0].stoppedAt).toBe(-1);
    await r.clips.prepare(r.store.project); // arriva il render al tempo nuovo
    r.engine.refresh();
    const last = starts(r.graph).at(-1)!;
    expect(last.when).toBeCloseTo(0.6, 6);
    expect(last.offset).toBeCloseTo(1, 6); // battito 1 a 60 BPM = 1 s nel buffer nuovo
  });

  it('se il render non è pronto la clip parte appena arriva', async () => {
    const r = await rig({ prepare: false });
    r.store.apply(placeSample(r.t(0), r.sample.id, 0));
    r.engine.play(0);
    expect(starts(r.graph)).toEqual([]);
    await new Promise<void>(res => r.clips.on('ready', () => res()));
    expect(starts(r.graph)).toHaveLength(1); // refresh automatico
    expect(r.dsp.renders).toBe(1); // richiesto una volta sola
  });

  it('senza warp: il sample originale, il transpose cambia la velocità', async () => {
    const r = await rig();
    r.store.apply(placeSample(r.t(0), r.sample.id, 0));
    const id = r.store.project.tracks[0].arrangement[0].id;
    r.store.apply(updateClip<AudioClip>('no warp', r.t(0), id, c => c.withWarp({ enabled: false }).withTranspose(12)));
    r.engine.play(1);
    const s = r.graph.sources[0];
    expect(s.playbackRate.value).toBe(2);
    expect(s.started).toMatchObject({ when: 0.05, offset: 1 }); // 0.5 s di timeline a velocità doppia
    expect(s.buffer!.length).toBe(r.sample.frames); // il sample originale, non un render
  });

  it('stop ferma tutto e avvisa', async () => {
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

describe('PlaybackEngine: MIDI e metronomo', () => {
  it('le note suonano con lo strumento, anche nei giri del loop della clip', async () => {
    const r = await rig();
    r.store.apply(addMidiClip(r.t(1), 0, 4)); // clip vuota di 4 battiti, in loop, posata per 4
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
      // la seconda nota (1 battito) viene tagliata alla fine del giro: dura 0.5 battiti
      { pitch: 67, when: 0.8, duration: 0.25 },
      { pitch: 60, when: 1.05, duration: 0.25 }, // secondo giro (battito 2)
      { pitch: 67, when: 1.8, duration: 0.25 },
    ]);
    expect(synth.notes[1].velocity).toBe(50);
  });

  it('lo strumento segue la traccia: parametri al volo, tipo nuovo = strumento nuovo', async () => {
    const r = await rig();
    const synth = r.instruments.created[0];
    expect(synth.type).toBe('analog');
    r.store.apply(setInstrumentParam(r.t(1), 'cutoff', 500));
    expect(synth.updates.at(-1)?.params.cutoff).toBe(500);
    expect(r.instruments.created).toHaveLength(1);
    r.store.apply(setInstrument(r.t(1), { type: 'altro', preset: null, params: {} }));
    expect(synth.disposed).toBe(true);
    expect(r.instruments.created[1].type).toBe('altro');
    r.engine.audition(r.t(1), 64, 90, 0.5);
    expect(r.instruments.created[1].notes).toEqual([{ pitch: 64, velocity: 90, when: 0.005, duration: 0.5 }]);
  });

  it('metronomo: un clic per battito, accento sul primo della battuta', async () => {
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

  it('volume e pan nei nodi, canali tolti con le tracce', async () => {
    const r = await rig();
    const g = new FakeGraph();
    const mixer = new MixerGraph(g, new FakeEffects());
    r.store.apply(setMixer(r.t(0), { volumeDb: -6, pan: 0.5 }));
    mixer.sync(r.store.project);
    expect(g.gains[2].gain.value).toBeCloseTo(0.501, 3); // [0] master, [1] ingresso, [2] volume
    expect(g.panners[0].pan.value).toBe(0.5);
    mixer.sync(r.store.project.removingTrack(r.t(0)));
    expect(g.gains[2].connected).toBe(false);
  });
});
