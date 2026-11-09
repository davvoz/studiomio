import { describe, expect, it } from 'vitest';
import { activeSections, paramSpec, resolveActiveParams, resolveParams, visibleParamsOf, type DeviceType } from '../../src/devices/device-type';
import type { InstrumentCore } from '../../src/devices/dsp/core';
import { CYMBALS, PIECES } from '../../src/devices/instruments/cymbals/cymbals';
import { CymbalsCore } from '../../src/devices/instruments/cymbals/cymbals-core';
import {
  DRUMS, innerPrefix, innerPresetParams, MODEL, padNames, padNote, padParam, splitInner,
} from '../../src/devices/instruments/drums/drums';
import { DrumCore } from '../../src/devices/instruments/drums/drums-core';
import { KICK } from '../../src/devices/instruments/kick/kick';
import { KickCore } from '../../src/devices/instruments/kick/kick-core';
import { BODY_SLOT, SNARE, SOURCE } from '../../src/devices/instruments/snare/snare';
import { SnareCore } from '../../src/devices/instruments/snare/snare-core';

const SR = 48000, BLOCK = 128;
const at = (s: number) => Math.round(s * SR);

/** Plays `pitch` on an engine for `seconds`, in blocks like the AudioWorklet. */
function play(core: InstrumentCore, pitch: number, seconds = 0.4, velocity = 110) {
  const n = at(seconds), left = new Float32Array(n), right = new Float32Array(n);
  core.noteOn(1, pitch, velocity);
  for (let f = 0; f < n; f += BLOCK) core.render(left, right, f, Math.min(n, f + BLOCK));
  return { left, right };
}

/** The Drum Machine with these parameters, as the engine sends them (volume at 0 dB). */
function drums(params: Record<string, number>) {
  const core = new DrumCore(SR);
  core.setParams(resolveActiveParams(DRUMS, { volume: 0, velocity: 0, ...params }));
  return core;
}

/** Pad `i` playing instrument `model`, with the parameters of instrument `inner` (without prefix). */
const instrumentPad = (i: number, model: number, type: DeviceType, inner: Record<string, number> = {}, extra: Record<string, number> = {}) => ({
  [padParam(i, 'model')]: model, [padParam(i, 'level')]: 0, [padParam(i, 'pan')]: 0, [padParam(i, 'choke')]: 0,
  ...Object.fromEntries(Object.entries(inner).map(([k, v]) => [innerPrefix(i, type.type) + k, v])), ...extra,
});

const standalone = (core: InstrumentCore & { setParams(p: Record<string, number>): void }, type: DeviceType, inner: Record<string, number> = {}) => {
  core.setParams(resolveParams(type, inner));
  return core;
};

const maxDiff = (a: Float32Array, b: Float32Array) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
const peak = (x: Float32Array) => x.reduce((p, v) => Math.max(p, Math.abs(v)), 0);

describe('Drum Machine: the pads with an instrument', () => {
  it('a Kick pad sounds like the Kick instrument alone', () => {
    const inner = { note: 7, decay: 0.6 };
    const pad = play(drums(instrumentPad(0, MODEL.kickInst, KICK, inner)), padNote(0));
    const alone = play(standalone(new KickCore(SR), KICK, inner), 36);
    expect(peak(pad.left)).toBeGreaterThan(0.1);
    expect(maxDiff(pad.left, alone.left)).toBeLessThan(1e-5);
  });

  it('the pad\'s parameters reach the instrument: another note, another sound', () => {
    const low = play(drums(instrumentPad(0, MODEL.kickInst, KICK, { note: 0 })), padNote(0)).left;
    const high = play(drums(instrumentPad(0, MODEL.kickInst, KICK, { note: 20 })), padNote(0)).left;
    expect(maxDiff(low, high)).toBeGreaterThan(0.05);
  });

  it('a Hat and Cymbals pad plays the chosen piece, level and pan are the pad\'s', () => {
    const open = play(drums(instrumentPad(5, MODEL.cymbalsInst, CYMBALS, {}, { [padParam(5, 'piece')]: 2 })), padNote(5));
    const alone = play(standalone(new CymbalsCore(SR), CYMBALS), PIECES[2].note);
    expect(maxDiff(open.left, alone.left)).toBeLessThan(1e-5);
    const right = play(drums(instrumentPad(5, MODEL.cymbalsInst, CYMBALS, {}, { [padParam(5, 'piece')]: 2, [padParam(5, 'pan')]: 100, [padParam(5, 'level')]: -6 })), padNote(5));
    expect(peak(right.left)).toBeLessThan(1e-6);
    expect(peak(right.right)).toBeCloseTo(peak(alone.right) * 10 ** (-6 / 20), 3);
  });

  it('the samples of the pad\'s instrument reach their slot', () => {
    const sine = Float32Array.from({ length: SR }, (_, i) => Math.sin((2 * Math.PI * 300 * i) / SR) * 0.9);
    const inner = { bodySource: SOURCE.sample, snapLevel: 0, wiresLevel: 0, decay: 1 };
    const core = drums(instrumentPad(2, MODEL.snareInst, SNARE, inner));
    expect(peak(play(core, padNote(2), 0.2).left)).toBeLessThan(1e-6);
    core.setSample(innerPrefix(2, 'snare') + BODY_SLOT, { sampleRate: SR, channels: [sine] });
    const pad = play(core, padNote(2), 0.3).left;
    const alone = new SnareCore(SR);
    alone.setParams(resolveParams(SNARE, inner));
    alone.setSample(BODY_SLOT, { sampleRate: SR, channels: [sine] });
    expect(peak(pad)).toBeGreaterThan(0.1);
    expect(maxDiff(pad, play(alone, 38, 0.3).left)).toBeLessThan(1e-5);
  });

  it('the pad\'s choke also stops the instrument', () => {
    const params = {
      ...instrumentPad(5, MODEL.cymbalsInst, CYMBALS, { openDecay: 2 }, { [padParam(5, 'piece')]: 2, [padParam(5, 'choke')]: 1 }),
      ...instrumentPad(6, MODEL.cymbalsInst, CYMBALS, {}, { [padParam(6, 'piece')]: 0, [padParam(6, 'choke')]: 1 }),
    };
    // the open alone still plays after 0.35 s; with the closed on top only the closed remains, short
    expect(peak(play(drums(params), padNote(5), 0.5).left.subarray(at(0.35)))).toBeGreaterThan(0.005);
    const core = drums(params);
    const n = at(0.5), left = new Float32Array(n), right = new Float32Array(n);
    core.noteOn(1, padNote(5), 110);
    let f = 0;
    for (; f < at(0.1); f += BLOCK) core.render(left, right, f, f + BLOCK);
    core.noteOn(2, padNote(6), 110);
    for (; f < n; f += BLOCK) core.render(left, right, f, Math.min(n, f + BLOCK));
    expect(peak(left.subarray(at(0.35)))).toBeLessThan(1e-4);
  });

  it('going back to a sound the pad no longer plays the instrument', () => {
    const core = drums(instrumentPad(0, MODEL.kickInst, KICK));
    core.setParams(resolveActiveParams(DRUMS, { volume: 0, [padParam(0, 'model')]: MODEL.rim, [padParam(0, 'decay')]: 0.03 }));
    const out = play(core, padNote(0), 0.3).left;
    expect(peak(out.subarray(at(0.15)))).toBeLessThan(1e-4);
  });

  it('the kits with the instruments play all the pads, without exploding, with the kick over the hi-hats', () => {
    const kits = DRUMS.presets.filter(p => Object.keys(p.params).some(k => k.includes('.')));
    expect(kits.map(k => k.name)).toEqual([
      'Instruments', 'Rave', 'Industrial', '808 instruments', 'Acoustic', 'Lo-fi', 'House', 'Dub techno', 'Breakbeat', 'Trap', 'Minimal', 'Electro',
    ]);
    for (const kit of kits) {
      const values = resolveParams(DRUMS, kit.params), names = padNames(values);
      const peaks = Array.from({ length: 16 }, (_, pad) => {
        const { left, right } = play(drums({ ...kit.params, volume: -4 }), padNote(pad), 1);
        expect(left.every(Number.isFinite) && right.every(Number.isFinite), `${kit.name}: ${names[pad]}`).toBe(true);
        return Math.max(peak(left), peak(right));
      });
      peaks.forEach((p, pad) => {
        expect(p, `${kit.name}: ${names[pad]}`).toBeGreaterThan(0.02);
        expect(p, `${kit.name}: ${names[pad]}`).toBeLessThan(0.95);
      });
      // the kick (C1) over the closed hi-hat (F#1) by at least 3 dB
      expect(peaks[0], kit.name).toBeGreaterThan(peaks[6] * 1.4);
    }
    expect(padNames(resolveParams(DRUMS, DRUMS.presets.find(p => p.name === 'Rave')!.params)).filter((_, i) => [0, 6, 8, 10, 13, 15].includes(i)))
      .toEqual(['Kick 1', 'Closed hat', 'Pedal hat', 'Open hat', 'Crash', 'Ride']);
  });
});

describe('Drum Machine: the parameters of the pads\' instruments', () => {
  it('they have the pad and the instrument in front, and the conditions follow', () => {
    const spec = paramSpec(DRUMS, 'p3.kick.decay');
    expect(spec?.label).toBe(paramSpec(KICK, 'decay')!.label);
    const sampleTune = paramSpec(DRUMS, 'p3.kick.sampleTune');
    expect(sampleTune?.when?.param).toBe('p3.kick.bodySource');
    expect(splitInner('p12.cymbals.closed')).toEqual({ pad: 11, type: 'cymbals', inner: 'closed' });
    expect(splitInner('p3model')).toBeNull();
  });

  it('in the engine and in the menus there are only those of the instruments the pads play', () => {
    const plain = resolveActiveParams(DRUMS, {});
    expect(Object.keys(plain).some(k => k.includes('.'))).toBe(false);
    const withKick = resolveActiveParams(DRUMS, { [padParam(2, 'model')]: MODEL.kickInst });
    const inner = Object.keys(withKick).filter(k => k.includes('.'));
    expect(inner.length).toBe(Object.keys(resolveParams(KICK, {})).length);
    expect(inner.every(k => k.startsWith('p3.kick.'))).toBe(true);
    expect(activeSections(DRUMS, { [padParam(2, 'model')]: MODEL.kickInst }).filter(s => s.when).every(s => s.label.startsWith('Pad 3 · Kick'))).toBe(true);
    expect(visibleParamsOf(DRUMS, {}).some(p => p.id.includes('.'))).toBe(false);
  });

  it('a preset of the instrument on the pad also resets the parameters the preset doesn\'t name', () => {
    const rumble = KICK.presets.find(p => p.name === 'Rumble')!;
    const values = innerPresetParams(4, KICK, rumble);
    expect(Object.keys(values).length).toBe(Object.keys(resolveParams(KICK, {})).length);
    for (const [k, v] of Object.entries(resolveParams(KICK, rumble.params))) expect(values[`p5.kick.${k}`]).toBe(v);
  });
});
