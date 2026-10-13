import { describe, expect, it } from 'vitest';
import { sequentialIds, type TrackId } from '../../src/core/id';
import { DRUMS } from '../../src/devices/instruments/drums/drums';
import { ANALOG } from '../../src/devices/instruments/analog/analog';
import { paramSpec } from '../../src/devices/device-type';
import type { NumberParam } from '../../src/devices/params';
import { paramFromUnit, paramToUnit } from '../../src/devices/params';
import { ModTimeline, ParamModulation } from '../../src/devices/worklet/mod-timeline';
import { PlaybackEngine } from '../../src/engine/playback-engine';
import {
  envelopeValueAt, INSTRUMENT_DEVICE, parseTargetKey, targetKey, withEnvelope, type ModTarget,
} from '../../src/model/envelope';
import { MidiClip } from '../../src/model/midi-clip';
import { Project } from '../../src/model/project';
import { ProjectCodec } from '../../src/persistence/project-codec';
import { addEffect, addMidiClip, addTrack, resizePlacement, setSlot, updateClip } from '../../src/store/edits';
import { ProjectStore } from '../../src/store/project-store';
import { paintStep, simplify } from '../../src/ui/envelopes/envelope-lane';
import { FakeEffects, FakeGraph, FakeInstruments, type FakeParam } from '../helpers/fake-audio';

const VOLUME: ModTarget = { kind: 'mixer', param: 'volume' };
const PAN: ModTarget = { kind: 'mixer', param: 'pan' };
const CUTOFF: ModTarget = { kind: 'device', device: INSTRUMENT_DEVICE, param: 'cutoff' };
const pts = (...p: [number, number][]) => p.map(([beat, value]) => ({ beat, value }));

/** Il valore di un parametro all'istante `t`, rifacendo i suoi eventi con le regole degli AudioParam. */
function replay(events: readonly { type: string; value: number; time: number }[], neutral: number, t: number): number {
  const line = new ModTimeline(neutral);
  for (const e of events) {
    if (e.type === 'set' || e.type === 'ramp') line.add({ kind: e.type, value: e.value, time: e.time });
    else if (e.type === 'hold') line.hold(e.time);
  }
  return line.valueAt(t);
}

describe('modulazioni: il modello', () => {
  it('valore della curva: prima, in mezzo, dopo, scalini', () => {
    const p = pts([1, 0.2], [3, 0.6], [3, 1], [4, 0]);
    expect(envelopeValueAt(p, 0)).toBe(0.2);
    expect(envelopeValueAt(p, 2)).toBeCloseTo(0.4, 9);
    expect(envelopeValueAt(p, 3)).toBe(1); // sullo scalino vale già il punto dopo
    expect(envelopeValueAt(p, 3.5)).toBeCloseTo(0.5, 9);
    expect(envelopeValueAt(p, 9)).toBe(0);
  });

  it('una curva per bersaglio: si aggiunge, si sostituisce, sparisce senza punti; valori nella scala', () => {
    let envs = withEnvelope([], VOLUME, pts([2, 0.5], [0, 3]));
    expect(envs[0].points).toEqual(pts([0, 1], [2, 0.5])); // in ordine e dentro 0..1
    envs = withEnvelope(envs, PAN, pts([0, -2]));
    envs = withEnvelope(envs, VOLUME, pts([1, 0]));
    expect(envs.map(e => targetKey(e.target))).toEqual(['mixer:volume', 'mixer:pan']);
    expect(envs[1].points[0].value).toBe(-1);
    expect(withEnvelope(envs, VOLUME, []).map(e => targetKey(e.target))).toEqual(['mixer:pan']);
    expect(parseTargetKey('instrument:cutoff')).toEqual(CUTOFF);
    expect(parseTargetKey('mixer:tempo')).toBeNull();
  });

  it('si salvano con la clip; un file v5 si apre', () => {
    const ids = sequentialIds();
    const store = new ProjectStore(Project.empty('t', ids, 2), ids);
    store.apply(addTrack('midi'));
    const t = store.project.tracks[0].id;
    store.apply(setSlot(t, 0, MidiClip.empty(ids.next('clip'), 'A', '#fff').withEnvelope(CUTOFF, pts([0, 0.5], [2, -0.25]))));
    const codec = new ProjectCodec();
    const back = codec.parse(codec.stringify(store.project));
    expect(back.tracks[0].slots[0]!.envelope(CUTOFF)?.points).toEqual(pts([0, 0.5], [2, -0.25]));
    const json = JSON.parse(codec.stringify(store.project));
    json.version = 5;
    delete json.tracks[0].slots[0].envelopes;
    expect(codec.decode(json).tracks[0].slots[0]!.envelopes).toEqual([]);
  });
});

describe('disegno a scalini', () => {
  it('uno scalino in una cella: fuori la curva resta com\'era; i punti inutili spariscono', () => {
    const ramp = pts([0, 0], [4, 1]);
    expect(paintStep(ramp, 1, 2, 0.9, 0)).toEqual(pts([0, 0], [1, 0.25], [1, 0.9], [2, 0.9], [2, 0.5], [4, 1]));
    // celle vicine con lo stesso valore: uno scalino solo
    let p = paintStep([], 0, 1, -1, 0);
    p = paintStep(p, 1, 2, -1, 0);
    expect(p).toEqual(pts([0, -1], [2, -1], [2, 0]));
    expect(simplify(pts([0, 1], [0, 0.5], [1, 0.5], [2, 0.5], [3, 0.5], [3, 0.5]))).toEqual(pts([0, 0.5], [3, 0.5]));
  });
});

describe('modulazioni nell\'AudioWorklet', () => {
  it('scalini e rampe come gli AudioParam; "tieni" a metà rampa', () => {
    const line = new ModTimeline(0);
    line.add({ kind: 'set', value: 0.2, time: 1 });
    line.add({ kind: 'ramp', value: 1, time: 2 });
    line.add({ kind: 'set', value: 0, time: 3 });
    line.add({ kind: 'set', value: 0.7, time: 3 }); // stesso istante: vale l'ultimo
    expect(line.valueAt(0.5)).toBe(0);
    expect(line.valueAt(1.5)).toBeCloseTo(0.6, 9);
    expect(line.valueAt(3)).toBe(0.7);
    const held = new ModTimeline(0);
    held.add({ kind: 'set', value: 0, time: 0 });
    held.add({ kind: 'ramp', value: 1, time: 1 });
    held.hold(0.25);
    expect(held.valueAt(0.9)).toBeCloseTo(0.25, 9);
    expect(held.pending).toBe(false);
  });

  it('lo spostamento si somma alla manopola nella sua scala (il cutoff in ottave)', () => {
    const cutoff = paramSpec(ANALOG, 'cutoff') as NumberParam;
    const mod = new ParamModulation(new Map([['cutoff', cutoff]]), { cutoff: 1000, resonance: 20 });
    expect(mod.paramsAt(0)).toEqual({ cutoff: 1000, resonance: 20 }); // la prima volta, i valori delle manopole
    expect(mod.paramsAt(0.1)).toBeNull(); // niente di cambiato
    mod.event('cutoff', 'set', 0.1, 1);
    mod.event('resonance', 'set', 0.5, 1); // non è nelle specifiche: ignorato
    const p = mod.paramsAt(1)!;
    expect(p.cutoff).toBeCloseTo(paramFromUnit(cutoff, paramToUnit(cutoff, 1000) + 0.1), 6);
    expect(p.resonance).toBe(20);
    mod.event('cutoff', 'set', 0, 2);
    expect(mod.paramsAt(2)!.cutoff).toBe(1000);
    expect(mod.paramsAt(3)).toBeNull();
  });
});

/** 120 BPM (un battito = 0.5 s, il battito b suona a 0.05 + b/2): una traccia MIDI con una clip
 *  di 4 battiti in loop posata per 8, e una seconda traccia MIDI. */
function rig() {
  const ids = sequentialIds();
  const store = new ProjectStore(Project.empty('t', ids, 2), ids);
  store.apply(addTrack('midi'));
  store.apply(addTrack('midi'));
  const t = (i: number): TrackId => store.project.tracks[i].id;
  store.apply(addMidiClip(t(0), 0, 4));
  const pl = store.project.tracks[0].arrangement[0];
  store.apply(resizePlacement(t(0), pl.id, { end: 8 }));
  const graph = new FakeGraph(), instruments = new FakeInstruments(), effects = new FakeEffects();
  let tick: (() => void) | null = null;
  const engine = new PlaybackEngine(graph, { clips: { playable: () => null }, instruments, effects }, {
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
  const editClip = (fn: (c: MidiClip) => MidiClip) => store.apply(updateClip<MidiClip>('m', t(0), pl.id, fn));
  /** Il guadagno della modulazione del volume e lo spostamento del pan della traccia `i`. */
  const volume = (i: number) => graph.gains.find(g => g.outputs.includes(graph.panners[i]))!.gain;
  const pan = (i: number) => graph.constants[i].offset as FakeParam;
  const at = (beat: number) => 0.05 + beat / 2;
  return { store, engine, graph, instruments, effects, t, runUntil, editClip, volume, pan, at, ids };
}

describe('modulazioni nel motore', () => {
  it('il volume segue la curva nel tempo della clip, a ogni giro del loop, e torna neutro dopo la clip', () => {
    const r = rig();
    r.editClip(c => c.withEnvelope(VOLUME, pts([0, 1], [2, 0])));
    r.engine.play(0);
    r.runUntil(4.3);
    const ev = r.volume(0).events;
    const v = (beat: number) => replay(ev, 1, r.at(beat));
    expect(v(0)).toBeCloseTo(1, 3);
    expect(v(1)).toBeCloseTo(0.25, 2); // metà curva: guadagno 0.5² (≈ −12 dB)
    expect(v(2.5)).toBeCloseTo(0, 6);
    expect(v(4.5)).toBeCloseTo(0.5625, 2); // secondo giro: 0.75²
    expect(v(8.2)).toBe(1); // finita la clip
    // la seconda traccia non ha curve: il suo volume non si muove
    expect(r.volume(1).events).toEqual([]);
  });

  it('togliere la curva mentre suona: dopo la riprogrammazione il volume torna neutro', () => {
    const r = rig();
    r.editClip(c => c.withEnvelope(VOLUME, pts([0, 0])));
    r.engine.play(0);
    r.runUntil(1);
    expect(replay(r.volume(0).events, 1, 1)).toBe(0);
    r.editClip(c => c.withEnvelope(VOLUME, [])); // come un Ctrl+Z
    r.runUntil(2);
    const ev = r.volume(0).events;
    expect(replay(ev, 1, 1.02)).toBe(0); // fino alla ripartenza tiene il valore: nessun salto
    expect(replay(ev, 1, 1.2)).toBe(1);
  });

  it('parametri dello strumento e di un effetto: spostamenti in frazioni della manopola', () => {
    const r = rig();
    r.store.apply(addEffect(r.t(0), 'delay', 'Delay'));
    const fx = r.store.project.tracks[0].effects[0].id;
    r.editClip(c => c.withEnvelope(CUTOFF, pts([0, 0], [4, 0.4])).withEnvelope({ kind: 'device', device: fx, param: 'feedback' }, pts([0, -0.5])));
    r.engine.play(0);
    r.runUntil(2);
    const synth = r.instruments.created[0].modulation.events.filter(e => e.param === 'cutoff');
    expect(replay(synth, 0, r.at(2))).toBeCloseTo(0.2, 4);
    const delay = r.effects.created[0].modulation.events.filter(e => e.param === 'feedback');
    expect(replay(delay, 0, r.at(1))).toBe(-0.5);
  });

  it('una clip lanciata al posto di un\'altra: il pan torna neutro al confine; lo stop riporta tutto neutro', () => {
    const r = rig();
    const clip = (name: string) => MidiClip.empty(r.ids.next('clip'), name, '#fff', 4);
    r.store.apply(setSlot(r.t(1), 0, clip('Sinistra').withEnvelope(PAN, pts([0, -1]))));
    r.store.apply(setSlot(r.t(1), 1, clip('Niente')));
    r.engine.launchSlot(r.t(1), 0);
    r.runUntil(1);
    r.engine.launchSlot(r.t(1), 1); // al prossimo confine di battuta: battito 4
    r.runUntil(3);
    const ev = r.pan(1).events;
    expect(replay(ev, 0, r.at(1))).toBe(-1);
    expect(replay(ev, 0, r.at(3.9))).toBe(-1);
    expect(replay(ev, 0, r.at(4.1))).toBe(0);
    r.engine.launchSlot(r.t(1), 0);
    r.runUntil(5);
    expect(replay(r.pan(1).events, 0, 5)).toBe(-1);
    r.engine.stop();
    expect(replay(r.pan(1).events, 0, 5.01)).toBe(0);
  });

  it('la clip della Drum Machine modula un pad', () => {
    // un parametro qualunque di un altro strumento: il motore non conosce i parametri
    const r = rig();
    const target: ModTarget = { kind: 'device', device: INSTRUMENT_DEVICE, param: 'p1decay' };
    expect(paramSpec(DRUMS, 'p1decay')?.kind).toBe('number');
    r.editClip(c => c.withEnvelope(target, pts([0, 0.3])));
    r.engine.play(0);
    r.runUntil(0.5);
    expect(r.instruments.created[0].modulation.events.some(e => e.param === 'p1decay' && e.value === 0.3)).toBe(true);
  });
});
