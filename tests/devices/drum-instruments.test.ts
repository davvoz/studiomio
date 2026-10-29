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

/** Suona `pitch` su un motore per `seconds`, a blocchi come l'AudioWorklet. */
function play(core: InstrumentCore, pitch: number, seconds = 0.4, velocity = 110) {
  const n = at(seconds), left = new Float32Array(n), right = new Float32Array(n);
  core.noteOn(1, pitch, velocity);
  for (let f = 0; f < n; f += BLOCK) core.render(left, right, f, Math.min(n, f + BLOCK));
  return { left, right };
}

/** La Drum Machine con questi parametri, come gliela manda il motore (volume a 0 dB). */
function drums(params: Record<string, number>) {
  const core = new DrumCore(SR);
  core.setParams(resolveActiveParams(DRUMS, { volume: 0, velocity: 0, ...params }));
  return core;
}

/** Il pad `i` che suona lo strumento `model`, con i parametri dello strumento `inner` (senza prefisso). */
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

describe('Drum Machine: i pad con uno strumento', () => {
  it('un pad Kick suona come lo strumento Kick da solo', () => {
    const inner = { note: 7, decay: 0.6 };
    const pad = play(drums(instrumentPad(0, MODEL.kickInst, KICK, inner)), padNote(0));
    const alone = play(standalone(new KickCore(SR), KICK, inner), 36);
    expect(peak(pad.left)).toBeGreaterThan(0.1);
    expect(maxDiff(pad.left, alone.left)).toBeLessThan(1e-5);
  });

  it('i parametri del pad arrivano allo strumento: un\'altra nota, un altro suono', () => {
    const low = play(drums(instrumentPad(0, MODEL.kickInst, KICK, { note: 0 })), padNote(0)).left;
    const high = play(drums(instrumentPad(0, MODEL.kickInst, KICK, { note: 20 })), padNote(0)).left;
    expect(maxDiff(low, high)).toBeGreaterThan(0.05);
  });

  it('un pad Hat e Piatti suona il pezzo scelto, livello e pan sono del pad', () => {
    const open = play(drums(instrumentPad(5, MODEL.cymbalsInst, CYMBALS, {}, { [padParam(5, 'piece')]: 2 })), padNote(5));
    const alone = play(standalone(new CymbalsCore(SR), CYMBALS), PIECES[2].note);
    expect(maxDiff(open.left, alone.left)).toBeLessThan(1e-5);
    const right = play(drums(instrumentPad(5, MODEL.cymbalsInst, CYMBALS, {}, { [padParam(5, 'piece')]: 2, [padParam(5, 'pan')]: 100, [padParam(5, 'level')]: -6 })), padNote(5));
    expect(peak(right.left)).toBeLessThan(1e-6);
    expect(peak(right.right)).toBeCloseTo(peak(alone.right) * 10 ** (-6 / 20), 3);
  });

  it('i sample dello strumento del pad arrivano al suo posto', () => {
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

  it('il choke del pad ferma anche lo strumento', () => {
    const params = {
      ...instrumentPad(5, MODEL.cymbalsInst, CYMBALS, { openDecay: 2 }, { [padParam(5, 'piece')]: 2, [padParam(5, 'choke')]: 1 }),
      ...instrumentPad(6, MODEL.cymbalsInst, CYMBALS, {}, { [padParam(6, 'piece')]: 0, [padParam(6, 'choke')]: 1 }),
    };
    // l'aperto da solo suona ancora dopo 0,35 s; con il chiuso sopra resta solo il chiuso, corto
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

  it('tornando a un suono il pad non suona più lo strumento', () => {
    const core = drums(instrumentPad(0, MODEL.kickInst, KICK));
    core.setParams(resolveActiveParams(DRUMS, { volume: 0, [padParam(0, 'model')]: MODEL.rim, [padParam(0, 'decay')]: 0.03 }));
    const out = play(core, padNote(0), 0.3).left;
    expect(peak(out.subarray(at(0.15)))).toBeLessThan(1e-4);
  });

  it('i kit con gli strumenti suonano tutti i pad, senza esplodere, con la cassa sopra gli hi-hat', () => {
    const kits = DRUMS.presets.filter(p => Object.keys(p.params).some(k => k.includes('.')));
    expect(kits.map(k => k.name)).toEqual([
      'Strumenti', 'Rave', 'Industriale', '808 strumenti', 'Acustica', 'Lo-fi', 'House', 'Dub techno', 'Breakbeat', 'Trap', 'Minimal', 'Electro',
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
      // la cassa (C1) sopra l'hi-hat chiuso (F#1) di almeno 3 dB
      expect(peaks[0], kit.name).toBeGreaterThan(peaks[6] * 1.4);
    }
    expect(padNames(resolveParams(DRUMS, DRUMS.presets.find(p => p.name === 'Rave')!.params)).filter((_, i) => [0, 6, 8, 10, 13, 15].includes(i)))
      .toEqual(['Kick 1', 'Hat chiuso', 'Hat pedale', 'Hat aperto', 'Crash', 'Ride']);
  });
});

describe('Drum Machine: i parametri degli strumenti dei pad', () => {
  it('hanno il pad e lo strumento davanti, e le condizioni seguono', () => {
    const spec = paramSpec(DRUMS, 'p3.kick.decay');
    expect(spec?.label).toBe(paramSpec(KICK, 'decay')!.label);
    const sampleTune = paramSpec(DRUMS, 'p3.kick.sampleTune');
    expect(sampleTune?.when?.param).toBe('p3.kick.bodySource');
    expect(splitInner('p12.cymbals.closed')).toEqual({ pad: 11, type: 'cymbals', inner: 'closed' });
    expect(splitInner('p3model')).toBeNull();
  });

  it('al motore e nei menu ci sono solo quelli degli strumenti che i pad suonano', () => {
    const plain = resolveActiveParams(DRUMS, {});
    expect(Object.keys(plain).some(k => k.includes('.'))).toBe(false);
    const withKick = resolveActiveParams(DRUMS, { [padParam(2, 'model')]: MODEL.kickInst });
    const inner = Object.keys(withKick).filter(k => k.includes('.'));
    expect(inner.length).toBe(Object.keys(resolveParams(KICK, {})).length);
    expect(inner.every(k => k.startsWith('p3.kick.'))).toBe(true);
    expect(activeSections(DRUMS, { [padParam(2, 'model')]: MODEL.kickInst }).filter(s => s.when).every(s => s.label.startsWith('Pad 3 · Kick'))).toBe(true);
    expect(visibleParamsOf(DRUMS, {}).some(p => p.id.includes('.'))).toBe(false);
  });

  it('un preset dello strumento sul pad rimette anche i parametri che il preset non nomina', () => {
    const rumble = KICK.presets.find(p => p.name === 'Rumble')!;
    const values = innerPresetParams(4, KICK, rumble);
    expect(Object.keys(values).length).toBe(Object.keys(resolveParams(KICK, {})).length);
    for (const [k, v] of Object.entries(resolveParams(KICK, rumble.params))) expect(values[`p5.kick.${k}`]).toBe(v);
  });
});
