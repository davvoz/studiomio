import { describe, expect, it } from 'vitest';
import { paramSpec, resolveParams } from '../../src/devices/device-type';
import { followsTransport } from '../../src/devices/dsp/core';
import {
  ACID, ACID_FX, CASSETTE, DUB, FACTORY_RACKS, FADE_TO_GREY, FRENCH_TOUCH, HOOVER, JUMP, OFFBEAT, MACHINE, WALL, FOG, NEW_WAVE,
  OXYGEN, GROWL, TORNADO, THREE_OH_THREE, RAVE_DRUMS, DUB_DRUMS, BROKEN_DRUMS, INDUSTRIAL_DRUMS, KICK_RACK, SNARE_RACK,
  MOVING_HATS, WOBBLE, PUMP_RACK, GATED, LIVELY_ACID, SIREN_RACK, HIT,
} from '../../src/devices/factory-racks';
import { isModulatorType } from '../../src/devices/modulators/modulators';
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

/** An Audio Effect Rack (the Tornado) on a new audio track. */
function tornado(preset: RackPreset = TORNADO) {
  const s = setup();
  s.store.apply(loadRack(null, preset));
  const track = () => s.store.project.tracks[0] as AudioTrack;
  return { ...s, track, rack: track().racks[0].id, macro: (i: number, v: number) => s.store.apply(setMacro(track().id, track().racks[0].id, i, v)) };
}

/** A noise equal at every round, different on the two channels. */
function noise(seed: number) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) >>> 0) / 0xffffffff - 0.5) * 0.8;
}

/** Plays the chain with the transport running from 0: the left and right output, and the input. */
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

/** The smallest gap between the output and the input delayed by 0…64 samples (the latency of the
 *  devices with oversampling, which also delay the dry sound), and that delay. */
function delayedDiff(out: Float32Array, input: Float32Array): { diff: number; lag: number } {
  let best = { diff: Infinity, lag: 0 };
  for (let lag = 0; lag <= 64; lag++) {
    let m = 0;
    for (let i = lag; i < out.length; i++) m = Math.max(m, Math.abs(out[i] - input[i - lag]));
    if (m < best.diff) best = { diff: m, lag };
  }
  return best;
}

describe('factory racks', () => {
  it('they\'re valid racks: every parameter exists, every mapping stays within its parameter\'s travel', () => {
    expect(FACTORY_RACKS.map(r => r.name)).toEqual([
      'Tornado', 'Fade to Grey', 'Dub', 'French Touch', 'Cassette', 'Wall', 'Acid FX', 'Machine', 'Salsiccia',
      'Acid', 'Fog', 'Growl', 'New wave', 'Oxygen', 'Hoover', 'Jump', 'Offbeat', '303',
      'Wobble', 'Pump', 'Gated', 'Lively acid', 'Siren', 'Hit',
      'Rave drums', 'Dub drums', 'Broken drums', 'Industrial drums', 'Kick', 'Snare', 'Moving hats',
    ]);
    for (const rack of FACTORY_RACKS) {
      expect(rack.macros).toHaveLength(MACRO_COUNT);
      // from a file it would be read back the same
      expect(rackPresetFrom(JSON.parse(JSON.stringify(rack)))).toEqual(rack);
      // the devices by position: the instrument, if there is one, is the first
      const types = [...(rack.instrument ? [instrumentType(rack.instrument.type)!] : []), ...rack.effects.map(e => effectType(e.type)!)];
      expect(types.every(t => t)).toBe(true);
      [...(rack.instrument ? [rack.instrument] : []), ...rack.effects].forEach((d, i) => {
        for (const id of Object.keys(d.params)) expect(paramSpec(types[i], id), `${rack.name}: ${d.type}.${id}`).toBeDefined();
      });
      // the modulators' targets: a knob parameter of a device of the rack, or the mixer
      for (const e of rack.effects) {
        expect(!!e.targets, `${rack.name}: ${e.type}`).toBe(isModulatorType(e.type));
        for (const t of e.targets ?? []) {
          const m = /^d(\d+):(.+)$/.exec(t ?? '');
          if (!m) expect(['mixer:volume', 'mixer:pan'], `${rack.name}: ${t}`).toContain(t);
          else expect(paramSpec(types[Number(m[1])], m[2])?.kind, `${rack.name}: ${t}`).toBe('number');
        }
      }
      for (const m of rack.macros) {
        expect(Number.isInteger(m.value) && m.value >= 0 && m.value <= MACRO_MAX).toBe(true);
        for (const x of m.mappings) {
          expect(x.device, `${rack.name}: ${x.param}`).toBeDefined();
          const spec = paramSpec(types[x.device!], x.param);
          expect(spec, `${rack.name}: ${x.param}`).toBeDefined();
          if (spec?.kind === 'number') for (const v of [x.min, x.max]) expect(v >= spec.min && v <= spec.max, `${rack.name}: ${x.param} ${v}`).toBe(true);
          if (spec?.kind === 'choice') for (const v of [x.min, x.max]) expect(Number.isInteger(v) && v >= 0 && v < spec.options.length).toBe(true);
        }
      }
    }
  });

  it('Salsiccia: the master chain of Cripta, with one knob per idea', () => {
    const salsiccia = FACTORY_RACKS.find(r => r.name === 'Salsiccia')!;
    expect(salsiccia.instrument).toBeNull();
    expect(salsiccia.effects.map(e => e.type)).toEqual(['compressor', 'drive', 'multiband', 'eq', 'clipper']);
    expect(salsiccia.macros.map(m => [m.name, m.value])).toEqual([
      ['Fat', 55], ['Colour', 64], ['Push', 45], ['Body', 0], ['Air', 0], ['Pump', 55], ['Clip', 0], ['Volume', 106],
    ]);
  });

  it('Tornado: eight effects, one macro each', () => {
    const t = tornado();
    const track = t.track();
    expect(track.effects.map(e => e.type)).toEqual(['beatRepeat', 'reverse', 'gate', 'redux', 'autoFilter', 'chorus', 'autoPan', 'tapeStop']);
    const rack = track.racks[0];
    expect(rack.name).toBe('Tornado');
    expect(rack.devices).toEqual(track.effects.map(e => e.id));
    expect(rack.macros.map(m => m.name)).toEqual(['Stutter', 'Reverse', 'Gate', 'Lo-fi', 'Filter', 'Flanger', 'Pan', 'Stop']);
    rack.macros.forEach((m, i) => expect(m.mappings.every(x => x.device === track.effects[i].id)).toBe(true));
    expect(rack.macros[7].mode).toBe('button');
  });

  it('Tornado with the macros at 0: the sound passes as it is', () => {
    const { inL, inR, outL, outR } = play(tornado().track().effects, SR * 4);
    expect(maxDiff(outL, inL)).toBeLessThan(1e-6);
    expect(maxDiff(outR, inR)).toBeLessThan(1e-6);
  });

  it('Tornado: each macro at full travel, alone, changes the sound', () => {
    for (let i = 0; i < MACRO_COUNT; i++) {
      const t = tornado();
      t.macro(i, MACRO_MAX);
      const { inL, outL } = play(t.track().effects, SR * 4);
      expect(maxDiff(outL, inL), TORNADO.macros[i].name ?? `${i}`).toBeGreaterThan(0.05);
    }
  });

  for (const preset of [FADE_TO_GREY, DUB, FRENCH_TOUCH, CASSETTE, WALL, ACID_FX, MACHINE]) {
    it(`${preset.name}: with the macros at 0 the sound passes as it is`, () => {
      const t = tornado(preset);
      for (let i = 0; i < MACRO_COUNT; i++) t.macro(i, 0);
      const effects = t.track().effects;
      const { outL, outR } = play(effects, SR * 4);
      // the Drive at Dry/Wet 0 leaves the sound dry, though passed through its oversampling
      // (which shifts it by a fraction of a sample): the comparison is with that
      const dry = play(effects.filter(e => e.type === 'drive'), SR * 4);
      const l = delayedDiff(outL, dry.outL), r = delayedDiff(outR, dry.outR);
      expect(l.diff).toBeLessThan(1e-4);
      expect(r).toEqual({ diff: expect.any(Number), lag: l.lag });
      expect(r.diff).toBeLessThan(1e-4);
    });

    it(`${preset.name}: with the macros where they start and all at 127 the sound changes and doesn't explode`, () => {
      // Fade to Grey starts with Fade at 0 and Macchina with everything at 0: the sound is as it is until they're turned
      for (const value of [FADE_TO_GREY, MACHINE].includes(preset) ? [MACRO_MAX] : [null, MACRO_MAX]) {
        const t = tornado(preset);
        if (value !== null) for (let i = 0; i < MACRO_COUNT; i++) t.macro(i, value);
        const { inL, outL, outR } = play(t.track().effects, SR * 4);
        const peak = Math.max(peakOf(outL), peakOf(outR));
        expect(Number.isFinite(peak) && peak < 2, `${preset.name}, macro ${value ?? 'at start'}: ${peak}`).toBe(true);
        expect(delayedDiff(outL, inL).diff, `${preset.name}, macro ${value ?? 'at start'}`).toBeGreaterThan(0.05);
      }
    });
  }

  it('Fade to Grey: at full travel the sound dies out in a lower and narrower trail', () => {
    const t = tornado(FADE_TO_GREY);
    t.macro(0, MACRO_MAX);
    const { inL, inR, outL, outR } = play(t.track().effects, SR * 4);
    const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
    const side = (l: Float32Array, r: Float32Array) => rms(l.map((v, i) => (v - r[i]) / 2));
    expect(rms(outL)).toBeLessThan(rms(inL) * 0.5);
    expect(side(outL, outR) / rms(outL)).toBeLessThan(side(inL, inR) / rms(inL));
  });

  it('the racks\' modulators, put on a track, move the just-created devices', () => {
    const s = setup();
    s.store.apply(loadRack(null, PUMP_RACK));
    const track = s.store.project.tracks[0] as MidiTrack;
    const [pump, drift] = track.effects;
    expect(pump.targets).toEqual([{ kind: 'mixer', param: 'volume' }]);
    expect(pump.params.a1).toBe(-95);
    expect(drift.targets).toEqual([{ kind: 'device', device: INSTRUMENT_DEVICE, param: 'cutoff' }, { kind: 'mixer', param: 'pan' }]);
    // and the macros move the modulators
    const pumpMacro = track.racks[0].macros[0];
    expect(pumpMacro.mappings).toEqual([expect.objectContaining({ device: pump.id, param: 'depth' })]);
  });

  for (const preset of [
    ACID, FOG, GROWL, NEW_WAVE, OXYGEN, HOOVER, JUMP, OFFBEAT, THREE_OH_THREE,
    WOBBLE, PUMP_RACK, GATED, LIVELY_ACID, SIREN_RACK, HIT,
    RAVE_DRUMS, DUB_DRUMS, BROKEN_DRUMS, INDUSTRIAL_DRUMS, KICK_RACK, SNARE_RACK, MOVING_HATS,
  ]) {
    it(`${preset.name}: the instrument and the effects in an Instrument Rack, the macros where they start`, () => {
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

    it(`${preset.name}: plays, below 0 dBFS, with the macros where they start, all at 0 and all at 127`, () => {
      for (const value of [null, 0, MACRO_MAX]) {
        const s = setup();
        s.store.apply(loadRack(null, preset));
        const owner = s.store.project.tracks[0].id;
        if (value !== null) for (let i = 0; i < MACRO_COUNT; i++) s.store.apply(setMacro(owner, s.store.project.tracks[0].racks[0].id, i, value));
        const track = s.store.project.tracks[0] as MidiTrack;
        const peak = playNotes(track.instrument, track.effects, SR * 3);
        expect(peak, `${preset.name}, macro ${value ?? 'at start'}`).toBeGreaterThan(0.01);
        expect(peak, `${preset.name}, macro ${value ?? 'at start'}`).toBeLessThan(1);
      }
    });
  }
});

/** The instrument plays a loop of notes (one every eighth, A-C-E-G low) and goes through the
 *  effects: the output's peak (NaN if something isn't a number). */
function playNotes(instrument: DeviceSettings, effects: readonly EffectSettings[], frames: number): number {
  const synth = INSTRUMENT_CORES[instrument.type](SR);
  synth.setTempo?.(BPM);
  synth.setParams(resolveParams(instrumentType(instrument.type)!, instrument.params));
  // the modulators don't touch the sound (here, without the engine, they stay still)
  const cores = effects.filter(e => !isModulatorType(e.type)).map(e => {
    const core = EFFECT_CORES[e.type](SR);
    core.setTempo(BPM);
    core.setParams(resolveParams(effectType(e.type)!, e.params));
    return core;
  });
  // the drums on the pads' notes (kick, closed hat, snare, open hat), the rest an arpeggiated chord
  const drums = ['drums', 'kick', 'snare', 'cymbals'].includes(instrument.type);
  const EIGHTH = SR / 4, PITCHES = drums ? [36, 42, 38, 46] : [45, 48, 52, 55];
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
