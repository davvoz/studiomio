import { describe, expect, it } from 'vitest';
import { paramSpec, resolveParams } from '../../src/devices/device-type';
import { BODY_SLOT, FIRST_NOTE, noteHz, OVERTONE, SNARE, SNAP_SLOT, SNAP_SOURCE, SOURCE } from '../../src/devices/instruments/snare/snare';
import { SnareCore } from '../../src/devices/instruments/snare/snare-core';
import { instrumentType } from '../../src/devices/registry';
import { INSTRUMENT_CORES } from '../../src/devices/worklet/cores';

const SR = 48000;
const at = (s: number) => Math.round(s * SR);

/** Un colpo con questi parametri (senza velocity, volume a 0 dB, niente taglio dei bassi né drive), per `seconds`. */
function hit(params: Record<string, number> = {}, seconds = 0.5, pitch = 38, velocity = 127, samples: Record<string, Float32Array> = {}) {
  const core = new SnareCore(SR);
  core.setParams(resolveParams(SNARE, { velocity: 0, volume: 0, lowCut: 20, drive: 0, ...params }));
  for (const [slot, data] of Object.entries(samples)) core.setSample(slot, { sampleRate: SR, channels: [data] });
  const n = at(seconds), left = new Float32Array(n), right = new Float32Array(n);
  core.noteOn(1, pitch, velocity);
  for (let f = 0; f < n; f += 128) core.render(left, right, f, Math.min(n, f + 128));
  return { left, right };
}

const rms = (x: Float32Array, from: number, to: number) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
};
const peak = (x: Float32Array) => x.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
const zeroCrossHz = (x: Float32Array, from: number, to: number) => {
  let n = 0;
  for (let i = from + 1; i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return (n * SR) / (to - from);
};

/** Solo la pelle, un seno: niente colpo, cordiera, armonico, forma, caduta. */
const SKIN = { snapLevel: 0, wiresLevel: 0, overtone: 0, shape: 0, pitch: 0, bodyLevel: 100, decay: 1 };
/** Solo la cordiera. */
const WIRES = { snapLevel: 0, bodyLevel: 0, wiresLevel: 100 };

describe('Snare: descrizione', () => {
  it('è uno strumento con il suo motore; la nota va da A1 ad A3, la prima scelta è G2', () => {
    expect(instrumentType('snare')).toBe(SNARE);
    expect(INSTRUMENT_CORES.snare(SR)).toBeInstanceOf(SnareCore);
    const note = paramSpec(SNARE, 'note')!;
    expect(note.kind === 'choice' && note.options[0]).toBe('A1 · 110 Hz');
    expect(note.kind === 'choice' && note.options[note.default]).toBe('G2 · 196 Hz');
  });

  it('ogni preset suona, senza esplodere', () => {
    for (const preset of SNARE.presets) {
      const { left, right } = hit({ ...preset.params, volume: preset.params.volume ?? -6 }, 1.5);
      expect(left.every(Number.isFinite) && right.every(Number.isFinite), preset.name).toBe(true);
      expect(peak(left), preset.name).toBeGreaterThan(0.05);
      expect(peak(left), preset.name).toBeLessThan(2);
    }
  });
});

describe('Snare: il suono', () => {
  it('la pelle sta sulla nota; Segue: D1 suona la nota, le altre la spostano', () => {
    for (const note of [0, 10, 20]) {
      const { left } = hit({ ...SKIN, note }, 0.5, 60);
      expect(zeroCrossHz(left, at(0.1), at(0.5))).toBeCloseTo(noteHz(FIRST_NOTE + note), -1);
    }
    const up = hit({ ...SKIN, note: 10, follow: 1 }, 0.5, 38 + 5).left;
    expect(zeroCrossHz(up, at(0.1), at(0.5))).toBeCloseTo(noteHz(FIRST_NOTE + 15), -1);
  });

  it('l\'armonico aggiunge il secondo modo della membrana, che si spegne prima', () => {
    const plain = hit({ ...SKIN }, 0.3).left;
    const rich = hit({ ...SKIN, overtone: 100 }, 0.3).left;
    expect(zeroCrossHz(rich, 0, at(0.05))).toBeGreaterThan(zeroCrossHz(plain, 0, at(0.05)) * 1.2);
    expect(OVERTONE).toBeCloseTo(1.59, 2);
  });

  it('la cordiera: rumore acuto, che parte dopo il ritardo e dura quanto il suo decay', () => {
    const { left } = hit({ ...WIRES, wiresDelay: 10, wiresDecay: 0.1 }, 0.5);
    expect(peak(left.subarray(0, at(0.009)))).toBeLessThan(1e-6);
    expect(rms(left, at(0.011), at(0.03))).toBeGreaterThan(0.05);
    expect(zeroCrossHz(left, at(0.011), at(0.05))).toBeGreaterThan(1500);
    expect(rms(left, at(0.3), at(0.5))).toBeLessThan(1e-3);
    const long = hit({ ...WIRES, wiresDelay: 10, wiresDecay: 1 }, 0.5).left;
    expect(rms(long, at(0.3), at(0.5))).toBeGreaterThan(0.01);
  });

  it('la grana tiene fermo il rumore: meno passaggi per lo zero', () => {
    const clean = hit({ ...WIRES, wiresTone: 300, grain: 0 }, 0.1).left;
    const grainy = hit({ ...WIRES, wiresTone: 300, grain: 100 }, 0.1).left;
    expect(zeroCrossHz(grainy, at(0.005), at(0.08))).toBeLessThan(zeroCrossHz(clean, at(0.005), at(0.08)) * 0.6);
  });

  it('il colpo: click, rumore o sample, acuto e corto', () => {
    const none = hit({ ...SKIN, snapLevel: 0 }, 0.05).left;
    for (const snapSource of [SNAP_SOURCE.click, SNAP_SOURCE.noise]) {
      const snap = hit({ ...SKIN, snapSource, snapLevel: 100, snapTone: 6000 }, 0.05).left.map((v, i) => v - none[i]);
      expect(zeroCrossHz(snap, 0, at(0.004)), `colpo ${snapSource}`).toBeGreaterThan(3000);
      expect(peak(snap.subarray(at(0.04))), `colpo ${snapSource}`).toBeLessThan(0.01);
    }
    const tick = Float32Array.from({ length: 480 }, (_, i) => (i % 4 < 2 ? 0.8 : -0.8));
    const sample = hit({ ...SKIN, bodyLevel: 0, snapSource: SNAP_SOURCE.sample, snapLevel: 100, snapDecay: 400 }, 0.02, 38, 127, { [SNAP_SLOT]: tick }).left;
    expect(zeroCrossHz(sample, 0, at(0.008))).toBeGreaterThan(5000);
  });

  it('la pelle può essere un sample, con la sua intonazione', () => {
    const sine = Float32Array.from({ length: SR }, (_, i) => Math.sin((2 * Math.PI * 300 * i) / SR) * 0.9);
    const body = { ...SKIN, bodySource: SOURCE.sample, decay: 2 };
    expect(zeroCrossHz(hit(body, 0.3, 38, 127, { [BODY_SLOT]: sine }).left, at(0.02), at(0.3))).toBeCloseTo(300, -1);
    expect(zeroCrossHz(hit({ ...body, sampleTune: 12 }, 0.3, 38, 127, { [BODY_SLOT]: sine }).left, at(0.02), at(0.3))).toBeCloseTo(600, -1);
    expect(peak(hit(body, 0.2).left)).toBeLessThan(1e-6);
  });

  it('la stanza: una coda stereo dopo il colpo', () => {
    const dry = hit({ ...WIRES, wiresDecay: 0.05 }, 1);
    const wet = hit({ ...WIRES, wiresDecay: 0.05, roomOn: 1, room: 100, roomTime: 1.5 }, 1);
    expect(rms(wet.left, at(0.4), at(0.7))).toBeGreaterThan(rms(dry.left, at(0.4), at(0.7)) * 10 + 0.002);
    const side = rms(wet.left.map((v, i) => v - wet.right[i]), at(0.1), at(0.6));
    expect(side).toBeGreaterThan(0.002);
    expect(rms(dry.left.map((v, i) => v - dry.right[i]), 0, at(1))).toBeLessThan(1e-6);
  });

  it('i colpi piano: più deboli e, con "Vel → tono", più scuri', () => {
    const loud = hit({ ...WIRES, velocity: 100, velTone: 100 }, 0.1, 38, 127).left;
    const soft = hit({ ...WIRES, velocity: 100, velTone: 100 }, 0.1, 38, 30).left;
    expect(peak(soft)).toBeLessThan(peak(loud) * 0.4);
    const flat = hit({ ...WIRES, velocity: 0, velTone: 0 }, 0.1, 38, 30).left;
    const dark = hit({ ...WIRES, velocity: 0, velTone: 100 }, 0.1, 38, 30).left;
    expect(zeroCrossHz(dark, at(0.005), at(0.08))).toBeLessThan(zeroCrossHz(flat, at(0.005), at(0.08)));
  });

  it('un colpo nuovo spegne quello prima senza salti', () => {
    const core = new SnareCore(SR);
    core.setParams(resolveParams(SNARE, { velocity: 0, volume: 0, ...SKIN, snapLevel: 0 }));
    const n = at(0.4), left = new Float32Array(n), right = new Float32Array(n);
    core.noteOn(1, 38, 127);
    core.render(left, right, 0, at(0.2));
    core.noteOn(2, 38, 127);
    core.render(left, right, at(0.2), n);
    let jump = 0;
    for (let i = at(0.2) - 2; i < at(0.21); i++) jump = Math.max(jump, Math.abs(left[i + 1] - left[i]));
    expect(jump).toBeLessThan(0.25);
  });
});
