import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import type { SampleData } from '../../src/devices/dsp/core';
import { DRUMS, MODEL, modelDefaults, padNames, padOfSlot, padParam, padSlot } from '../../src/devices/instruments/drums/drums';
import { DrumCore } from '../../src/devices/instruments/drums/drums-core';
import { NoteQueue } from '../../src/devices/worklet/note-queue';
import { sampleAt } from '../../src/model/device';
import type { MidiTrack } from '../../src/model/track';
import { PROJECT_VERSION, ProjectCodec } from '../../src/persistence/project-codec';
import { setInstrument, setInstrumentSamples } from '../../src/store/edits';
import { sampleRef, setup } from '../helpers/fixtures';

const SR = 48000, BLOCK = 128;

function run(core: DrumCore, queue: NoteQueue, frames: number): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (let f = 0; f < frames; f += BLOCK) {
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    queue.renderBlock(core, l, r, f);
    const n = Math.min(BLOCK, frames - f);
    left.set(l.subarray(0, n), f);
    right.set(r.subarray(0, n), f);
  }
  return { left, right };
}

/** Il pad 1 come pad Sample (livello e pan neutri), più `extra`. */
const samplePad = (extra: Record<string, number> = {}) =>
  ({ ...modelDefaults(0, MODEL.sample), [padParam(0, 'level')]: 0, [padParam(0, 'pan')]: 0, ...extra });

const kit = (params: Record<string, number>, sample: SampleData | null) => {
  const core = new DrumCore(SR);
  core.setParams(resolveParams(DRUMS, { volume: 0, velocity: 0, ...params }));
  core.setSample('p1', sample);
  return { core, queue: new NoteQueue() };
};

const sine = (hz: number, seconds: number, sr = SR, amp = 0.5): SampleData =>
  ({ sampleRate: sr, channels: [Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / sr))] });

const zeroCrossHz = (x: Float32Array, from: number, to: number) => {
  let n = 0;
  for (let i = from + 1; i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return (n * SR) / (to - from);
};

const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
};

const lastSound = (x: Float32Array) => {
  for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]) > 1e-6) return i;
  return -1;
};

describe('Drum Machine: pad Sample', () => {
  it('suona il sample com\'è, dal campione della nota, sui due canali', () => {
    const left = Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i * 0.05) * 0.6);
    const right = left.map(v => -v);
    const { core, queue } = kit(samplePad(), { sampleRate: SR, channels: [left, right] });
    queue.add(36, 127, 300, 310);
    const out = run(core, queue, 6000);
    expect(out.left.subarray(0, 300).every(v => v === 0)).toBe(true);
    // all'inizio l'inviluppo è pieno: esce il sample, identico
    let err = 0;
    for (let i = 0; i < 2000; i++) err = Math.max(err, Math.abs(out.left[300 + i] - left[i]), Math.abs(out.right[300 + i] - right[i]));
    expect(err).toBeLessThan(1e-3);
    // finito il file, la voce tace e si libera
    expect(lastSound(out.left)).toBeLessThan(300 + 4800);
    expect(core.activePads).toBe(0);
  });

  it('un file a un\'altra frequenza di campionamento suona alla sua intonazione', () => {
    const { core, queue } = kit(samplePad(), sine(1000, 0.5, 22050));
    queue.add(36, 127, 0, 10);
    const out = run(core, queue, SR / 4);
    expect(zeroCrossHz(out.left, 0, SR / 4)).toBeCloseTo(1000, -1);
  });

  it('intonazione: +12 semitoni suona un\'ottava sopra e dura la metà', () => {
    const { core, queue } = kit(samplePad({ [padParam(0, 'tune')]: 12 }), sine(500, 0.4));
    queue.add(36, 127, 0, 10);
    const out = run(core, queue, SR / 2);
    expect(Math.abs(zeroCrossHz(out.left, 0, SR / 8) - 1000)).toBeLessThan(16);
    expect(lastSound(out.left) / SR).toBeCloseTo(0.2, 1);
  });

  it('il decay accorcia il sample; lo snap lo satura', () => {
    const short = kit(samplePad({ [padParam(0, 'decay')]: 0.05 }), sine(200, 1));
    short.queue.add(36, 127, 0, 10);
    expect(lastSound(run(short.core, short.queue, SR).left) / SR).toBeLessThan(0.051);
    const clean = kit(samplePad(), sine(200, 0.3, SR, 0.3)), hot = kit(samplePad({ [padParam(0, 'snap')]: 100 }), sine(200, 0.3, SR, 0.3));
    for (const k of [clean, hot]) k.queue.add(36, 127, 0, 10);
    // la saturazione alza i passaggi piani (il picco resta sotto 1)
    const a = run(clean.core, clean.queue, 4800).left, b = run(hot.core, hot.queue, 4800).left;
    expect(rms(b)).toBeGreaterThan(rms(a) * 1.8);
    expect(Math.max(...b.map(Math.abs))).toBeLessThanOrEqual(1);
  });

  it('il tono fa da filtro: sotto metà toglie gli acuti, sopra toglie i bassi', () => {
    const mix: SampleData = { sampleRate: SR, channels: [Float32Array.from({ length: SR / 2 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 60 * i) / SR) + 0.3 * Math.sin((2 * Math.PI * 8000 * i) / SR))] };
    const play = (tone: number) => {
      const k = kit(samplePad({ [padParam(0, 'tone')]: tone }), mix);
      k.queue.add(36, 127, 0, 10);
      const out = run(k.core, k.queue, SR / 4).left;
      const diff = out.map((v, i) => (i ? v - out[i - 1] : 0));
      return rms(diff, 2400) / rms(out, 2400);
    };
    expect(play(15)).toBeLessThan(play(50) / 3);
    expect(play(85)).toBeGreaterThan(play(50) * 1.3);
  });

  it('senza sample il pad tace; il choke vale anche per i sample', () => {
    const empty = kit(samplePad(), null);
    empty.queue.add(36, 127, 0, 10);
    expect(rms(run(empty.core, empty.queue, 4800).left)).toBe(0);
    // pad 1 (sample lungo) e pad 2 nello stesso gruppo: il secondo ferma il primo
    const { core, queue } = kit({ ...samplePad({ [padParam(0, 'choke')]: 1 }), [padParam(1, 'choke')]: 1, [padParam(1, 'level')]: -60 }, sine(300, 2));
    queue.add(36, 127, 0, 10);
    queue.add(37, 127, 4800, 4810);
    const out = run(core, queue, SR / 2).left;
    expect(rms(out, 2400, 4800)).toBeGreaterThan(0.2);
    expect(rms(out, 4800 + 0.03 * SR, SR / 2)).toBeLessThan(0.002);
  });

  it('Inizio: suona da metà del file; al contrario: lo stesso pezzo dalla fine all\'inizio', () => {
    // una rampa: ogni campione dice da dove viene
    const ramp: SampleData = { sampleRate: SR, channels: [Float32Array.from({ length: SR }, (_, i) => i / SR)] };
    const fwd = kit(samplePad({ [padParam(0, 'start')]: 50 }), ramp);
    fwd.queue.add(36, 127, 0, 10);
    const a = run(fwd.core, fwd.queue, 4800).left;
    expect(a[0]).toBeCloseTo(0.5, 3);
    expect(a[2400]).toBeGreaterThan(a[100]);
    // al contrario con decay 0,1 s: da 0,5 + 0,1 giù fino a 0,5, e finisce lì
    const rev = kit(samplePad({ [padParam(0, 'start')]: 50, [padParam(0, 'reverse')]: 1, [padParam(0, 'decay')]: 0.1 }), ramp);
    rev.queue.add(36, 127, 0, 10);
    const b = run(rev.core, rev.queue, 9600).left;
    // a metà del pezzo la rampa vale 0,55 (diviso l'inviluppo noto: 1 − 0,5⁴), alla fine 0,5
    const mid = Math.round(0.05 * SR);
    expect(b[mid] / (1 - 0.5 ** 4)).toBeCloseTo(0.55, 2);
    expect(b[Math.round(0.098 * SR)]).toBeCloseTo(0.502, 2);
    // l'inviluppo al contrario sale: all'inizio è piano
    expect(b[50] / (0.6 - 50 / SR)).toBeLessThan(0.1);
    expect(lastSound(b) / SR).toBeLessThan(0.101);
  });

  it('posti dei sample e nomi dei pad', () => {
    expect([padSlot(0), padSlot(15), padOfSlot('p16'), padOfSlot('p17'), padOfSlot('x1')]).toEqual(['p1', 'p16', 15, -1, -1]);
    const values = resolveParams(DRUMS, samplePad());
    expect(padNames(values)[0]).toBe('Sample');
    expect(padNames(values, new Map([['p1', 'KICK TECHNO']]))[0]).toBe('KICK TECHNO');
    expect(DRUMS.noteNames!(values, new Map([['p1', 'KICK TECHNO']])).get(36)).toBe('KICK TECHNO');
    // si numerano i nomi uguali, non i modelli: un pad Sample vuoto accanto a uno pieno è "Sample"
    const two = resolveParams(DRUMS, { ...samplePad(), ...modelDefaults(1, MODEL.sample) });
    expect(padNames(two).slice(0, 2)).toEqual(['Sample 1', 'Sample 2']);
    expect(padNames(two, new Map([['p1', 'kick']])).slice(0, 2)).toEqual(['kick', 'Sample']);
  });
});

describe('sample nei dispositivi: modifiche e salvataggio', () => {
  const rig = () => {
    const s = setup({ midi: 1 });
    s.store.apply(setInstrument(s.track(0), { type: 'drums', preset: 'Init', params: {} }));
    const instrument = () => (s.store.project.tracks[0] as MidiTrack).instrument;
    return { ...s, instrument };
  };

  it('caricare un sample su un pad: entra nel progetto, il pad diventa Sample, un passo solo', () => {
    const { store, track, ids, instrument } = rig();
    const kick = sampleRef(ids, { name: 'kick', file: 'audio/kick.wav' });
    store.apply(setInstrumentSamples(track(0), { p1: kick }, modelDefaults(0, MODEL.sample)));
    expect(store.project.samples.map(s => s.name)).toEqual(['kick']);
    expect(sampleAt(instrument(), 'p1')).toBe(kick.id);
    expect(instrument().params[padParam(0, 'model')]).toBe(MODEL.sample);
    expect(store.project.usedSampleIds().has(kick.id)).toBe(true);
    expect(store.project.sampleNames(instrument()).get('p1')).toBe('kick');
    expect(() => store.project.removingSample(kick.id)).toThrow(/usato/);
    store.undo();
    expect(store.project.samples).toEqual([]);
    expect(instrument().samples).toBeUndefined();
  });

  it('scambiare e togliere; lo stesso sample su due pad entra una volta', () => {
    const { store, track, ids, instrument } = rig();
    const a = sampleRef(ids, { name: 'a' }), b = sampleRef(ids, { name: 'b' });
    store.apply(setInstrumentSamples(track(0), { p1: a, p2: b }));
    store.apply(setInstrumentSamples(track(0), { p1: b.id, p2: a.id }));
    expect(instrument().samples).toEqual({ p1: b.id, p2: a.id });
    store.apply(setInstrumentSamples(track(0), { p3: a }));
    expect(store.project.samples).toHaveLength(2);
    store.apply(setInstrumentSamples(track(0), { p1: null, p2: null, p3: null }));
    expect(instrument().samples).toBeUndefined();
    expect(store.project.withoutUnusedSamples().samples).toEqual([]);
  });

  it('si salvano con il progetto; un file della versione 6 si apre com\'era', () => {
    const { store, track, ids, instrument } = rig();
    const kick = sampleRef(ids, { name: 'kick' });
    store.apply(setInstrumentSamples(track(0), { p1: kick }, modelDefaults(0, MODEL.sample)));
    const codec = new ProjectCodec();
    const json = JSON.parse(codec.stringify(store.project));
    expect(json.version).toBe(PROJECT_VERSION);
    const back = codec.parse(codec.stringify(store.project));
    expect((back.tracks[0] as MidiTrack).instrument).toEqual(instrument());
    const old = { ...json, version: 6, tracks: json.tracks.map((t: { instrument: object }) => ({ ...t, instrument: { type: 'drums', preset: 'Init', params: {} } })) };
    const opened = codec.decode(old);
    expect((opened.tracks[0] as MidiTrack).instrument.samples).toBeUndefined();
  });
});
