import { describe, expect, it } from 'vitest';
import { paramsOf, resolveParams } from '../../src/devices/device-type';
import { midiToHz } from '../../src/devices/dsp/core';
import { LFO_RATE, LFO_SHAPE, MOD_DEST, NEURO, NEURO_MODE } from '../../src/devices/instruments/neuro/neuro';
import { NeuroCore } from '../../src/devices/instruments/neuro/neuro-core';
import { NoteQueue } from '../../src/devices/worklet/note-queue';

const SR = 48000, BLOCK = 128;

/** Fa suonare `core` per `frames` campioni, a blocchi come l'AudioWorklet. */
function run(core: NeuroCore, queue: NoteQueue, frames: number): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (let f = 0; f < frames; f += BLOCK) {
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    queue.renderBlock(core, l, r, f);
    left.set(l.subarray(0, Math.min(BLOCK, frames - f)), f);
    right.set(r.subarray(0, Math.min(BLOCK, frames - f)), f);
  }
  return { left, right };
}

const synth = (params: Record<string, number> = {}, bpm = 120) => {
  const core = new NeuroCore(SR);
  core.setTempo(bpm);
  core.setParams(resolveParams(NEURO, params));
  return { core, queue: new NoteQueue() };
};

const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
};

/** L'ampiezza della componente a `hz` (DFT su una finestra di Hann). */
function amplitudeAt(x: Float32Array, hz: number, from: number, length: number): number {
  let re = 0, im = 0, w = 0;
  for (let i = 0; i < length; i++) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length), ph = (2 * Math.PI * hz * i) / SR;
    re += x[from + i] * win * Math.cos(ph);
    im += x[from + i] * win * Math.sin(ph);
    w += win;
  }
  return (2 * Math.hypot(re, im)) / w;
}

/** Il corpo nudo: un dente di sega, filtro aperto, niente sub né colori. */
const BARE = { unison: 1, mix: 0, cutoff: 20000, resonance: 0, drive: 0, keyTrack: 0, sub: 0, crossover: 40, velocity: 0, volume: 0, release: 0.01 };

describe('Neuro', () => {
  it('i parametri hanno tutti un predefinito valido', () => {
    const r = resolveParams(NEURO, {});
    expect(Object.keys(r)).toHaveLength(paramsOf(NEURO).length);
    expect(new Set(paramsOf(NEURO).map(p => p.id)).size).toBe(paramsOf(NEURO).length);
  });

  it('suona la nota giusta', () => {
    const { core, queue } = synth({ ...BARE });
    queue.add(45, 100, 0, SR);
    const { left } = run(core, queue, SR / 2);
    const f = midiToHz(45);
    const fundamental = amplitudeAt(left, f, 4800, 9600);
    expect(fundamental).toBeGreaterThan(0.3);
    expect(amplitudeAt(left, f * 1.5, 4800, 9600)).toBeLessThan(fundamental * 0.05);
  });

  it('il sub è un seno pulito e il corpo resta sopra il taglio', () => {
    const pitch = 31, f = midiToHz(pitch); // Sol 1, 49 Hz
    const body = (crossover: number) => {
      const { core, queue } = synth({ ...BARE, crossover });
      queue.add(pitch, 100, 0, SR);
      return run(core, queue, SR).left;
    };
    const open = amplitudeAt(body(40), f, 9600, 28800), cut = amplitudeAt(body(160), f, 9600, 28800);
    expect(cut / open).toBeLessThan(0.05); // più di 26 dB sotto il taglio

    const { core, queue } = synth({ ...BARE, mix: 0, sub: 100, crossover: 400, cutoff: 20 });
    queue.add(pitch, 100, 0, SR);
    const { left } = run(core, queue, SR);
    const s = amplitudeAt(left, f, 9600, 28800);
    expect(s).toBeGreaterThan(0.5);
    expect(amplitudeAt(left, 2 * f, 9600, 28800)).toBeLessThan(s * 0.01); // niente armoniche
  });

  it("l'LFO va a tempo: un volume a quadra da 1/4 a 120 BPM apre e chiude ogni mezzo secondo", () => {
    const { core, queue } = synth({ ...BARE, lfo1Shape: LFO_SHAPE.square, lfo1Rate: LFO_RATE['1/4'], lfo1Dest: MOD_DEST.volume, lfo1Amount: 100 });
    queue.add(45, 100, 0, 2 * SR);
    const { left } = run(core, queue, 2 * SR);
    const half = SR / 4; // mezzo giro: 0.25 s
    for (let k = 0; k < 4; k++) {
      const on = rms(left, k * 2 * half + 600, (k * 2 + 1) * half - 600);
      const off = rms(left, (k * 2 + 1) * half + 600, (k * 2 + 2) * half - 600);
      expect(on).toBeGreaterThan(0.2);
      expect(off).toBeLessThan(on * 0.01);
    }
    // a 60 BPM lo stesso LFO va lento la metà
    const slow = synth({ ...BARE, lfo1Shape: LFO_SHAPE.square, lfo1Rate: LFO_RATE['1/4'], lfo1Dest: MOD_DEST.volume, lfo1Amount: 100 }, 60);
    slow.queue.add(45, 100, 0, 2 * SR);
    const s = run(slow.core, slow.queue, 2 * SR).left;
    expect(rms(s, half + 600, 2 * half - 600)).toBeGreaterThan(0.2);
    expect(rms(s, 2 * half + 600, 4 * half - 600)).toBeLessThan(0.01);
  });

  it('in Legato le note sovrapposte scivolano senza ripartire', () => {
    const { core, queue } = synth({ ...BARE, voiceMode: NEURO_MODE.legato, glide: 30, attack: 0.2, sustain: 100 });
    queue.add(45, 100, 0, SR / 2 + 100);
    queue.add(57, 100, SR / 2, SR);
    const { left } = run(core, queue, SR);
    // l'attacco lento non riparte: il livello resta pieno attraverso il cambio di nota
    expect(rms(left, SR / 2 - 2400, SR / 2)).toBeGreaterThan(0.4);
    expect(rms(left, SR / 2, SR / 2 + 2400)).toBeGreaterThan(0.4);
    expect(amplitudeAt(left, midiToHz(57), SR / 2 + 7200, 9600)).toBeGreaterThan(0.3);
  });

  it('il formante fa le vocali: la A ha il primo formante alto, la I basso', () => {
    const vowel = (v: number) => {
      const { core, queue } = synth({ ...BARE, formant: 100, vowel: v });
      queue.add(43, 100, 0, SR);
      const { left } = run(core, queue, SR / 2);
      const f0 = midiToHz(43);
      const near = (hz: number) => amplitudeAt(left, Math.round(hz / f0) * f0, 4800, 14400);
      return { f780: near(780), f290: near(290) };
    };
    const a = vowel(0), i = vowel(50);
    expect(a.f780 / a.f290).toBeGreaterThan(2 * (i.f780 / i.f290));
  });

  it("l'unison apre lo stereo; da sola la copia è al centro", () => {
    const wide = synth({ ...BARE, unison: 5, detune: 30, spread: 100 });
    wide.queue.add(45, 100, 0, SR);
    const w = run(wide.core, wide.queue, SR / 2);
    let diff = 0;
    for (let i = 4800; i < 24000; i++) diff += (w.left[i] - w.right[i]) ** 2;
    expect(Math.sqrt(diff / 19200)).toBeGreaterThan(0.1);

    const mono = synth({ ...BARE });
    mono.queue.add(45, 100, 0, SR);
    const m = run(mono.core, mono.queue, SR / 2);
    expect(m.left).toEqual(m.right);
  });

  it('i preset suonano senza esplodere e finiscono dopo il rilascio', () => {
    for (const preset of NEURO.presets) {
      const { core, queue } = synth(preset.params);
      queue.add(31, 127, 0, SR / 2);
      queue.add(43, 100, SR / 4, SR / 2);
      const { left, right } = run(core, queue, SR);
      let peak = 0;
      for (let i = 0; i < SR; i++) {
        expect(Number.isFinite(left[i]) && Number.isFinite(right[i])).toBe(true);
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      }
      expect(peak, preset.name).toBeGreaterThan(0.01);
      expect(peak, preset.name).toBeLessThan(2);
      expect(rms(left, SR - 4800, SR), preset.name).toBeLessThan(1e-4);
    }
  });

  it('costa poco: dieci secondi del preset più pesante in meno di un secondo', () => {
    const { core, queue } = synth({ ...NEURO.presets.find(p => p.name === 'Neuro ringhio')!.params, unison: 7, formant: 100 });
    queue.add(31, 100, 0, 10 * SR);
    const t = performance.now();
    run(core, queue, 10 * SR);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});
