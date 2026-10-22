import { describe, expect, it } from 'vitest';
import { paramSpec, resolveParams } from '../../src/devices/device-type';
import { followsTransport } from '../../src/devices/dsp/core';
import {
  ACIDO, ACIDO_FX, CASSETTA, DUB, FACTORY_RACKS, FADE_TO_GREY, FRENCH_TOUCH, HOOVER, JUMP, LEVARE, MACCHINA, MURO, NEBBIA, NUOVA_ONDA,
  OSSIGENO, RINGHIO, TORNADO, TRECENTOTRE,
} from '../../src/devices/factory-racks';
import type { RackPreset } from '../../src/model/rack-preset';
import { effectType, instrumentType } from '../../src/devices/registry';
import { EFFECT_CORES, INSTRUMENT_CORES } from '../../src/devices/worklet/cores';
import type { DeviceSettings, EffectSettings } from '../../src/model/device';
import { MACRO_COUNT, MACRO_MAX } from '../../src/model/rack';
import { INSTRUMENT_DEVICE } from '../../src/model/envelope';
import { rackPresetFrom } from '../../src/model/rack-preset';
import { AudioTrack, MidiTrack } from '../../src/model/track';
import { loadRack } from '../../src/store/browser-edits';
import { setMacro } from '../../src/store/rack-edits';
import { setup } from '../helpers/fixtures';

const SR = 48000, BLOCK = 128, BPM = 120;
const BPS = BPM / 60 / SR;

/** Un Audio Effect Rack (il Tornado) su una traccia audio nuova. */
function tornado(preset: RackPreset = TORNADO) {
  const s = setup();
  s.store.apply(loadRack(null, preset));
  const track = () => s.store.project.tracks[0] as AudioTrack;
  return { ...s, track, rack: track().racks[0].id, macro: (i: number, v: number) => s.store.apply(setMacro(track().id, track().racks[0].id, i, v)) };
}

/** Un rumore uguale a ogni giro, sui due canali diversi. */
function noise(seed: number) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) >>> 0) / 0xffffffff - 0.5) * 0.8;
}

/** Fa suonare la catena con il trasporto che va da 0: l'uscita sinistra e destra, e l'ingresso. */
function play(effects: readonly EffectSettings[], frames: number) {
  const cores = effects.map(e => {
    const core = EFFECT_CORES[e.type](SR);
    core.setTempo(BPM);
    core.setParams(resolveParams(effectType(e.type)!, e.params));
    return core;
  });
  const l = noise(1), r = noise(2);
  const inL = new Float32Array(frames), inR = new Float32Array(frames);
  for (let n = 0; n < frames; n++) { inL[n] = l(); inR[n] = r(); }
  const outL = new Float32Array(frames), outR = new Float32Array(frames);
  let aL = new Float32Array(BLOCK), aR = new Float32Array(BLOCK), bL = new Float32Array(BLOCK), bR = new Float32Array(BLOCK);
  for (let f = 0; f < frames; f += BLOCK) {
    aL.set(inL.subarray(f, f + BLOCK));
    aR.set(inR.subarray(f, f + BLOCK));
    for (const core of cores) {
      if (followsTransport(core)) core.setTransport({ beat: f * BPS, bpm: BPM, beatsPerBar: 4 });
      core.process(aL, aR, bL, bR, BLOCK);
      [aL, bL] = [bL, aL];
      [aR, bR] = [bR, aR];
    }
    outL.set(aL, f);
    outR.set(aR, f);
  }
  return { inL, inR, outL, outR };
}

const maxDiff = (a: Float32Array, b: Float32Array) => a.reduce((m, x, i) => Math.max(m, Math.abs(x - b[i])), 0);
const peakOf = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** Lo scarto più piccolo tra l'uscita e l'ingresso ritardato di 0…64 campioni (la latenza dei
 *  dispositivi con l'oversampling, che ritardano anche il suono asciutto), e quel ritardo. */
function delayedDiff(out: Float32Array, input: Float32Array): { diff: number; lag: number } {
  let best = { diff: Infinity, lag: 0 };
  for (let lag = 0; lag <= 64; lag++) {
    let m = 0;
    for (let i = lag; i < out.length; i++) m = Math.max(m, Math.abs(out[i] - input[i - lag]));
    if (m < best.diff) best = { diff: m, lag };
  }
  return best;
}

describe('rack di fabbrica', () => {
  it('sono rack validi: ogni parametro esiste, ogni mappatura resta dentro la corsa del suo parametro', () => {
    expect(FACTORY_RACKS.map(r => r.name)).toEqual([
      'Tornado', 'Fade to Grey', 'Dub', 'French Touch', 'Cassetta', 'Muro', 'Acido FX', 'Macchina',
      'Acido', 'Nebbia', 'Ringhio', 'Nuova onda', 'Ossigeno', 'Hoover', 'Jump', 'Levare', '303',
    ]);
    for (const rack of FACTORY_RACKS) {
      expect(rack.macros).toHaveLength(MACRO_COUNT);
      // da un file si rileggerebbe uguale
      expect(rackPresetFrom(JSON.parse(JSON.stringify(rack)))).toEqual(rack);
      // i dispositivi per posto: lo strumento, se c'è, è il primo
      const types = [...(rack.instrument ? [instrumentType(rack.instrument.type)!] : []), ...rack.effects.map(e => effectType(e.type)!)];
      expect(types.every(t => t)).toBe(true);
      [...(rack.instrument ? [rack.instrument] : []), ...rack.effects].forEach((d, i) => {
        for (const id of Object.keys(d.params)) expect(paramSpec(types[i], id), `${rack.name}: ${d.type}.${id}`).toBeDefined();
      });
      for (const m of rack.macros) {
        expect(Number.isInteger(m.value) && m.value >= 0 && m.value <= MACRO_MAX).toBe(true);
        for (const x of m.mappings) {
          const spec = paramSpec(types[x.device], x.param);
          expect(spec, `${rack.name}: ${x.param}`).toBeDefined();
          if (spec?.kind === 'number') for (const v of [x.min, x.max]) expect(v >= spec.min && v <= spec.max, `${rack.name}: ${x.param} ${v}`).toBe(true);
          if (spec?.kind === 'choice') for (const v of [x.min, x.max]) expect(Number.isInteger(v) && v >= 0 && v < spec.options.length).toBe(true);
        }
      }
    }
  });

  it('Tornado: otto effetti, una macro ciascuno', () => {
    const t = tornado();
    const track = t.track();
    expect(track.effects.map(e => e.type)).toEqual(['beatRepeat', 'reverse', 'gate', 'redux', 'autoFilter', 'chorus', 'autoPan', 'tapeStop']);
    const rack = track.racks[0];
    expect(rack.name).toBe('Tornado');
    expect(rack.devices).toEqual(track.effects.map(e => e.id));
    expect(rack.macros.map(m => m.name)).toEqual(['Stutter', 'Reverse', 'Gate', 'Lo-fi', 'Filtro', 'Flanger', 'Pan', 'Stop']);
    rack.macros.forEach((m, i) => expect(m.mappings.every(x => x.device === track.effects[i].id)).toBe(true));
    expect(rack.macros[7].mode).toBe('button');
  });

  it('Tornado con le macro a 0: il suono passa com\'è', () => {
    const { inL, inR, outL, outR } = play(tornado().track().effects, SR * 4);
    expect(maxDiff(outL, inL)).toBeLessThan(1e-6);
    expect(maxDiff(outR, inR)).toBeLessThan(1e-6);
  });

  it('Tornado: ogni macro a fondo corsa, da sola, cambia il suono', () => {
    for (let i = 0; i < MACRO_COUNT; i++) {
      const t = tornado();
      t.macro(i, MACRO_MAX);
      const { inL, outL } = play(t.track().effects, SR * 4);
      expect(maxDiff(outL, inL), TORNADO.macros[i].name ?? `${i}`).toBeGreaterThan(0.05);
    }
  });

  for (const preset of [FADE_TO_GREY, DUB, FRENCH_TOUCH, CASSETTA, MURO, ACIDO_FX, MACCHINA]) {
    it(`${preset.name}: con le macro a 0 il suono passa com'è`, () => {
      const t = tornado(preset);
      for (let i = 0; i < MACRO_COUNT; i++) t.macro(i, 0);
      const effects = t.track().effects;
      const { outL, outR } = play(effects, SR * 4);
      // il Drive a Dry/Wet 0 lascia il suono asciutto, passato però per il suo sovracampionamento
      // (che lo sposta di una frazione di campione): il confronto è con quello
      const dry = play(effects.filter(e => e.type === 'drive'), SR * 4);
      const l = delayedDiff(outL, dry.outL), r = delayedDiff(outR, dry.outR);
      expect(l.diff).toBeLessThan(1e-4);
      expect(r).toEqual({ diff: expect.any(Number), lag: l.lag });
      expect(r.diff).toBeLessThan(1e-4);
    });

    it(`${preset.name}: con le macro dove partono e tutte a 127 cambia il suono e non esplode`, () => {
      // Fade to Grey parte con Fade a 0 e Macchina con tutto a 0: il suono è com'è finché non li si gira
      for (const value of [FADE_TO_GREY, MACCHINA].includes(preset) ? [MACRO_MAX] : [null, MACRO_MAX]) {
        const t = tornado(preset);
        if (value !== null) for (let i = 0; i < MACRO_COUNT; i++) t.macro(i, value);
        const { inL, outL, outR } = play(t.track().effects, SR * 4);
        const peak = Math.max(peakOf(outL), peakOf(outR));
        expect(Number.isFinite(peak) && peak < 2, `${preset.name}, macro ${value ?? 'di partenza'}: ${peak}`).toBe(true);
        expect(delayedDiff(outL, inL).diff, `${preset.name}, macro ${value ?? 'di partenza'}`).toBeGreaterThan(0.05);
      }
    });
  }

  it('Fade to Grey: a fondo corsa il suono si spegne in una scia più bassa e più stretta', () => {
    const t = tornado(FADE_TO_GREY);
    t.macro(0, MACRO_MAX);
    const { inL, inR, outL, outR } = play(t.track().effects, SR * 4);
    const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
    const side = (l: Float32Array, r: Float32Array) => rms(l.map((v, i) => (v - r[i]) / 2));
    expect(rms(outL)).toBeLessThan(rms(inL) * 0.5);
    expect(side(outL, outR) / rms(outL)).toBeLessThan(side(inL, inR) / rms(inL));
  });

  for (const preset of [ACIDO, NEBBIA, RINGHIO, NUOVA_ONDA, OSSIGENO, HOOVER, JUMP, LEVARE, TRECENTOTRE]) {
    it(`${preset.name}: lo strumento e gli effetti in un Instrument Rack, le macro dove partono`, () => {
      const s = setup();
      s.store.apply(loadRack(null, preset));
      const track = s.store.project.tracks[0] as MidiTrack;
      expect(track).toBeInstanceOf(MidiTrack);
      expect(track.instrument.type).toBe(preset.instrument!.type);
      expect(track.effects.map(e => e.type)).toEqual(preset.effects.map(e => e.type));
      const rack = track.racks[0];
      expect(rack.devices).toEqual([INSTRUMENT_DEVICE, ...track.effects.map(e => e.id)]);
      expect(rack.macros.map(m => m.value)).toEqual(preset.macros.map(m => m.value));
      expect(rack.macros.every(m => m.name && m.mappings.length)).toBe(true);
    });

    it(`${preset.name}: suona, sotto 0 dBFS, con le macro dove partono, tutte a 0 e tutte a 127`, () => {
      for (const value of [null, 0, MACRO_MAX]) {
        const s = setup();
        s.store.apply(loadRack(null, preset));
        const owner = s.store.project.tracks[0].id;
        if (value !== null) for (let i = 0; i < MACRO_COUNT; i++) s.store.apply(setMacro(owner, s.store.project.tracks[0].racks[0].id, i, value));
        const track = s.store.project.tracks[0] as MidiTrack;
        const peak = playNotes(track.instrument, track.effects, SR * 3);
        expect(peak, `${preset.name}, macro ${value ?? 'di partenza'}`).toBeGreaterThan(0.01);
        expect(peak, `${preset.name}, macro ${value ?? 'di partenza'}`).toBeLessThan(1);
      }
    });
  }
});

/** Lo strumento suona un giro di note (una ogni ottavo, la-do-mi-sol in basso) e passa per gli
 *  effetti: il picco dell'uscita (NaN se qualcosa non è un numero). */
function playNotes(instrument: DeviceSettings, effects: readonly EffectSettings[], frames: number): number {
  const synth = INSTRUMENT_CORES[instrument.type](SR);
  synth.setTempo?.(BPM);
  synth.setParams(resolveParams(instrumentType(instrument.type)!, instrument.params));
  const cores = effects.map(e => {
    const core = EFFECT_CORES[e.type](SR);
    core.setTempo(BPM);
    core.setParams(resolveParams(effectType(e.type)!, e.params));
    return core;
  });
  const EIGHTH = SR / 4, PITCHES = [45, 48, 52, 55];
  let aL = new Float32Array(BLOCK), aR = new Float32Array(BLOCK), bL = new Float32Array(BLOCK), bR = new Float32Array(BLOCK);
  let peak = 0, note = 0;
  for (let f = 0; f < frames; f += BLOCK) {
    if (f % EIGHTH < BLOCK) {
      if (note) synth.noteOff(note);
      note++;
      if (f < frames - SR) synth.noteOn(note, PITCHES[note % PITCHES.length], 100);
    }
    aL.fill(0);
    aR.fill(0);
    synth.render(aL, aR, 0, BLOCK);
    for (const core of cores) {
      if (followsTransport(core)) core.setTransport({ beat: f * BPS, bpm: BPM, beatsPerBar: 4 });
      core.process(aL, aR, bL, bR, BLOCK);
      [aL, bL] = [bL, aL];
      [aR, bR] = [bR, aR];
    }
    for (let i = 0; i < BLOCK; i++) {
      const y = Math.max(Math.abs(aL[i]), Math.abs(aR[i]));
      if (!Number.isFinite(y)) return NaN;
      peak = Math.max(peak, y);
    }
  }
  return peak;
}
