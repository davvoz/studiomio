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

/** 120 BPM (un battito = 0.5 s), due tracce MIDI, due scene. Sulla timeline della traccia 0
 *  una clip con un Mi basso (40) a ogni battito per 16 battute, sulla traccia 1 un La (45) all'inizio; negli
 *  slot: A (60 a ogni battito) e B (72 a battiti alterni) sulla traccia 0, C (50) sulla 1. */
function rig() {
  const ids = sequentialIds();
  const store = new ProjectStore(Project.empty('t', ids, 2), ids);
  store.apply(addTrack('midi'));
  store.apply(addTrack('midi'));
  const t = (i: number): TrackId => store.project.tracks[i].id;
  store.apply(addMidiClip(t(0), 0, 4));
  const pl = store.project.tracks[0].arrangement[0];
  store.apply(updateClip<MidiClip>('n', t(0), pl.id, c => c.addingNotes(...[0, 1, 2, 3].map(b => note(40, b)))));
  store.apply(resizePlacement(t(0), pl.id, { end: 64 })); // la clip in loop copre 16 battute
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
  /** Note suonate dalla traccia `i`: [altezza, istante]. */
  const played = (i: number, pitch?: number) => instruments.created[i].notes
    .filter(n => pitch === undefined || n.pitch === pitch).map(n => [n.pitch, +n.when.toFixed(4)]);
  const state = (i: number) => engine.sessionState(store.project.tracks[i]);
  return { store, engine, graph, instruments, t, runUntil, played, state };
}

describe('session: lancio delle clip', () => {
  it('da fermo una clip fa partire il trasporto e prende il posto della timeline della sua traccia', () => {
    const r = rig();
    r.engine.launchSlot(r.t(0), 0);
    expect(r.engine.playing).toBe(true);
    r.runUntil(2.2);
    expect(r.played(0)).toEqual([[60, 0.05], [60, 0.55], [60, 1.05], [60, 1.55], [60, 2.05]]);
    expect(r.played(1)).toEqual([[45, 0.05]]); // l'altra traccia segue la timeline
    expect(r.state(0)).toMatchObject({ playing: { slot: 0 }, queued: null, followsArrangement: false });
    expect(r.state(1)).toMatchObject({ playing: null, followsArrangement: true });
    expect(r.engine.arrangementOverridden).toBe(true);
  });

  it('durante il play parte alla battuta successiva: la timeline suona fino a lì, poi la clip', () => {
    const r = rig();
    r.engine.play(0);
    r.runUntil(0.6);
    r.engine.launchSlot(r.t(0), 1);
    expect(r.state(0).queued).toEqual({ slot: 1 });
    r.runUntil(3.2);
    // battuta 2 = battito 4 = 2.05 s
    expect(r.played(0, 40)).toEqual([[40, 0.05], [40, 0.55], [40, 1.05], [40, 1.55]]);
    expect(r.played(0, 72)).toEqual([[72, 2.05], [72, 3.05]]);
    expect(r.instruments.created[0].cuts).toEqual([2.05]); // ciò che era già programmato si taglia lì
    expect(r.state(0)).toMatchObject({ playing: { slot: 1 }, queued: null });
  });

  it('con il loop della timeline le clip della session non saltano: continuano in fase', () => {
    const r = rig();
    r.store.apply(setLoopRegion({ enabled: true, start: 0, end: 3 }));
    r.engine.launchSlot(r.t(0), 0);
    r.runUntil(4.1);
    // la timeline torna indietro ogni 1.5 s; la clip suona un battito ogni 0.5 s senza buchi né doppioni
    expect(r.played(0)).toEqual([0.05, 0.55, 1.05, 1.55, 2.05, 2.55, 3.05, 3.55, 4.05].map(t => [60, t]));
    expect(r.played(1)).toEqual([[45, 0.05], [45, 1.55], [45, 3.05]]); // la timeline sì
  });

  it('una scena lancia le clip della riga e ferma le tracce con lo slot vuoto', () => {
    const r = rig();
    r.engine.play(0);
    r.runUntil(0.3);
    r.engine.launchScene(1);
    r.runUntil(4.2);
    expect(r.played(0, 72)).toEqual([[72, 2.05], [72, 3.05], [72, 4.05]]);
    expect(r.played(1)).toEqual([[45, 0.05]]); // dalla battuta 2 la traccia 1 tace
    expect(r.state(1)).toMatchObject({ playing: null, followsArrangement: false });
  });

  it('stop di una traccia, "ferma tutte", ritorno all\'arrangement', () => {
    const r = rig();
    r.engine.launchScene(0);
    r.runUntil(0.6);
    r.engine.stopTrack(r.t(1));
    expect(r.state(1).queued).toBe('stop');
    r.runUntil(2.2);
    expect(r.state(1)).toMatchObject({ playing: null, queued: null });
    r.engine.stopAllClips();
    r.runUntil(4.3);
    expect(r.played(0).at(-1)).toEqual([60, 3.55]); // la clip A si ferma alla battuta 3 (4.05 s)
    r.engine.backToArrangement();
    expect(r.engine.arrangementOverridden).toBe(false);
    r.runUntil(5.2);
    expect(r.played(0, 40).length).toBeGreaterThan(0); // la timeline riprende subito
    expect(r.state(0).followsArrangement).toBe(true);
  });

  it('fermato il trasporto, al play le clip che suonavano ripartono dall\'inizio (la timeline resta spenta)', () => {
    const r = rig();
    r.engine.launchScene(0);
    r.runUntil(0.7);
    r.engine.stop();
    expect(r.state(0)).toMatchObject({ playing: null, followsArrangement: false });
    r.engine.play(0);
    r.runUntil(1.5);
    expect(r.played(0)).toEqual([[60, 0.05], [60, 0.55], [60, 0.75], [60, 1.25]]); // A riparte con il trasporto
    expect(r.played(1)).toEqual([[50, 0.05], [50, 0.75]]); // e C con lei
    expect(r.state(0)).toMatchObject({ playing: { slot: 0 }, followsArrangement: false });
    r.engine.stop();
    r.engine.backToArrangement();
    r.engine.play(0);
    r.runUntil(2.3);
    expect(r.played(0, 40).length).toBeGreaterThan(0);
    expect(r.state(0).playing).toBeNull();
  });

  it('una traccia fermata, o "ferma tutte" a trasporto fermo: al play quelle clip non ripartono', () => {
    const r = rig();
    r.engine.launchScene(0);
    r.runUntil(0.6);
    r.engine.stopTrack(r.t(1));
    r.runUntil(2.2);
    r.engine.stop();
    r.engine.play(0);
    r.runUntil(2.6);
    expect(r.state(0).playing).toMatchObject({ slot: 0 });
    expect(r.state(1).playing).toBeNull(); // era già ferma
    r.engine.stop();
    r.engine.stopAllClips();
    r.engine.play(0);
    r.runUntil(3);
    expect(r.state(0).playing).toBeNull();
    expect(r.engine.playing).toBe(true);
  });

  it('una clip senza loop già finita non riparte', () => {
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

  it('da fermo, lanciare una clip la fa partire al posto di quella ricordata sulla stessa traccia', () => {
    const r = rig();
    r.engine.launchScene(0);
    r.runUntil(0.6);
    r.engine.stop();
    r.engine.launchSlot(r.t(0), 1);
    r.runUntil(1.2);
    expect(r.state(0).playing).toMatchObject({ slot: 1 });
    expect(r.state(1).playing).toMatchObject({ slot: 0 }); // l'altra traccia riprende la sua
  });

  it('una clip senza loop suona una volta e finisce', () => {
    const r = rig();
    const a = r.store.project.tracks[0].slots[0]!;
    const once = MidiClip.empty(a.id, 'A', '#fff', 4).addingNotes(note(60, 0), note(60, 3));
    r.store.apply(setSlot(r.t(0), 0, once.withLoop({ ...once.loop, enabled: false })));
    r.engine.launchSlot(r.t(0), 0);
    r.runUntil(5);
    expect(r.played(0)).toEqual([[60, 0.05], [60, 1.55]]);
    expect(r.state(0).playing).toBeNull();
  });

  it('modificare la clip che suona: si sente subito e resta in fase', () => {
    const r = rig();
    r.engine.launchSlot(r.t(0), 1);
    r.runUntil(1.2);
    const b = r.store.project.tracks[0].slots[1] as MidiClip;
    r.store.apply(setSlot(r.t(0), 1, b.addingNotes(note(74, 3))));
    r.runUntil(3.2);
    expect(r.played(0, 74).length).toBe(1);
    expect(r.played(0, 74)[0][1]).toBeCloseTo(1.55, 1); // battito 3 della clip, 1.5 s dopo il lancio
    expect(r.played(0, 72).length).toBeGreaterThanOrEqual(3);
  });

  it('senza quantizzazione parte appena possibile', () => {
    const r = rig();
    r.store.apply(setLaunchQuantization('none'));
    r.engine.play(0);
    r.runUntil(0.6);
    r.engine.launchSlot(r.t(0), 1);
    r.runUntil(1.5);
    const [first] = r.played(0, 72);
    expect(first[1]).toBeGreaterThan(0.6);
    expect(first[1]).toBeLessThan(0.85); // entro l'anticipo della programmazione
  });

  it('cattura e inserisci scena: le clip continuano senza interruzioni, ora dalla scena nuova', () => {
    const r = rig();
    r.engine.launchSlot(r.t(0), 1); // B, e la traccia 1 segue la timeline
    r.runUntil(1.2);
    const playing = r.engine.playingClips();
    expect([...playing.keys()]).toEqual([r.t(0)]);
    r.store.apply(captureScene(1, playing));
    r.runUntil(4.2);
    expect(r.played(0, 72)).toEqual([[72, 0.05], [72, 1.05], [72, 2.05], [72, 3.05], [72, 4.05]]);
    expect(r.instruments.created[0].cuts).toEqual([]);
    expect(r.state(0)).toMatchObject({ playing: { slot: 2 }, queued: null });
    expect(r.store.project.tracks[0].slots[1]?.name).toBe('B'); // al suo posto, una copia
  });
});

describe('session: stato delle scene', () => {
  it('una scena è in coda fino al confine, poi suona finché suonano tutte le sue clip', () => {
    const r = rig();
    const scene = (s: number) => sceneState(r.store.project.tracks.map(t => [t, r.engine.sessionState(t)] as const), s);
    r.engine.play(0);
    r.runUntil(0.3);
    r.engine.launchScene(0);
    expect(scene(0)).toEqual({ clips: true, playing: false, queued: true });
    r.runUntil(2.2);
    expect(scene(0)).toEqual({ clips: true, playing: true, queued: false });
    expect(scene(1)).toEqual({ clips: true, playing: false, queued: false });
    // la traccia b si ferma (slot vuoto nella riga 1): la scena 0 non suona più tutta
    r.engine.launchSlot(r.t(1), 1);
    r.runUntil(4.2);
    expect(scene(0).playing).toBe(false);
    // la scena 1 ha la sola clip di a: suona quando suona quella
    r.engine.launchSlot(r.t(0), 1);
    r.runUntil(6.2);
    expect(scene(1)).toEqual({ clips: true, playing: true, queued: false });
  });
});

describe('session: gruppi', () => {
  it('lo slot di un gruppo lancia la riga delle sue tracce (come una scena), lo stop le ferma', () => {
    const r = rig();
    const [a, b] = [r.t(0), r.t(1)];
    r.store.apply(groupTracks([a, b]));
    const group = r.store.project.tracks[0];
    r.engine.play(0);
    r.runUntil(0.3);
    r.engine.launchSlot(group.id, 1);
    r.runUntil(2.2);
    expect(r.played(0, 72)).toEqual([[72, 2.05]]);
    expect(r.played(1)).toEqual([[45, 0.05]]); // la traccia b non ha clip nella riga: si ferma
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

  it('una scena non tocca i gruppi: solo le tracce', () => {
    const r = rig();
    r.store.apply(groupTracks([r.t(0)]));
    r.engine.launchScene(0);
    expect(r.engine.takenTracks.has(r.store.project.tracks[0].id)).toBe(false);
  });
});

describe('session: mattoni', () => {
  it('i tratti di una clip in loop si calcolano solo nella finestra', () => {
    const clip = MidiClip.empty(sequentialIds().next('clip'), 'x', '#fff', 4);
    const segs = clipSegmentsBetween(clip, 100, 1000, 1009);
    expect(segs.map(s => [s.start, s.end, s.contentStart])).toEqual([[1000, 1004, 0], [1004, 1008, 0], [1008, 1012, 0]]);
    const once = clip.withLoop({ ...clip.loop, enabled: false });
    expect(clipSegmentsBetween(once, 100, 101, 200).map(s => [s.start, s.end])).toEqual([[100, 104]]);
    expect(clipSegmentsBetween(once, 100, 104, 200)).toEqual([]);
  });

  it('il taglio nel worklet: note dopo tolte, note a cavallo chiuse lì', () => {
    const q = new NoteQueue();
    q.add(60, 100, 0, 1000);
    q.add(62, 100, 400, 600);
    q.add(64, 100, 800, 900);
    q.cutAt(500);
    const ons: number[] = [], offs: number[] = [];
    const core = { setParams() {}, noteOn: (id: number) => ons.push(id), noteOff: (id: number) => offs.push(id), silence() {}, render() {} };
    q.renderBlock(core, new Float32Array(2000), new Float32Array(2000), 0);
    expect(ons).toEqual([1, 2]); // la 64 non parte più
    expect(offs.sort()).toEqual([1, 2]); // 60 e 62 finiscono a 500
  });
});
