import { describe, expect, it } from 'vitest';
import { paramSpec, resolveParams } from '../../src/devices/device-type';
import { DRUM_MODELS, DRUMS, MODEL, padNames, padParam, padsOf } from '../../src/devices/instruments/drums/drums';
import { DrumCore } from '../../src/devices/instruments/drums/drums-core';
import { NoteQueue } from '../../src/devices/worklet/note-queue';

const SR = 48000, BLOCK = 128;

/** Fa suonare la drum machine per `frames` campioni, a blocchi come l'AudioWorklet. */
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

const kit = (params: Record<string, number> = {}) => {
  const core = new DrumCore(SR);
  core.setParams(resolveParams(DRUMS, { volume: 0, velocity: 0, ...params }));
  return { core, queue: new NoteQueue() };
};

const peak = (x: Float32Array, from = 0, to = x.length) => {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
};

/** Il pad 1 con il modello `model` e i suoi valori. */
const onPad1 = (model: number, extra: Record<string, number> = {}) => {
  const m = DRUM_MODELS[model];
  return { [padParam(0, 'model')]: model, [padParam(0, 'decay')]: m.decay, [padParam(0, 'tone')]: m.tone, [padParam(0, 'snap')]: m.snap,
    [padParam(0, 'level')]: 0, [padParam(0, 'pan')]: 0, ...extra };
};

/** Frequenza media dai passaggi per lo zero (verso l'alto) in [from, to). */
const zeroCrossHz = (x: Float32Array, from: number, to: number) => {
  let n = 0;
  for (let i = from + 1; i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return (n * SR) / (to - from);
};

describe('Drum Machine: descrizione', () => {
  it('16 pad da C1, il kit di partenza sulla mappa General MIDI', () => {
    const values = resolveParams(DRUMS, {});
    const pads = padsOf(values);
    expect(pads).toHaveLength(16);
    expect([pads[0].model, pads[2].model, pads[6].model, pads[10].model]).toEqual([MODEL.kick, MODEL.snare, MODEL.hatClosed, MODEL.hatOpen]);
    expect(pads[6].choke).toBe(1);
    expect(pads[10].choke).toBe(1);
    const names = DRUMS.noteNames!(values);
    expect([names.get(36), names.get(38), names.get(42), names.get(46)]).toEqual(['Cassa', 'Rullante 1', 'Hi-hat chiuso', 'Hi-hat aperto']);
    expect(names.get(35)).toBeUndefined();
    expect(padNames(values).filter(n => n.startsWith('Tom'))).toEqual(['Tom 1', 'Tom 2', 'Tom 3', 'Tom 4']);
    expect(paramSpec(DRUMS, 'p12decay')?.label).toBe('Decay');
  });

  it('i preset cambiano il kit', () => {
    const p808 = DRUMS.presets.find(p => p.name === '808')!;
    expect(padsOf(resolveParams(DRUMS, p808.params))[0].model).toBe(MODEL.boom);
  });
});

describe('Drum Machine: suono', () => {
  it.each(DRUM_MODELS.map((m, i) => [m.label, i] as const))('%s: suona, non satura e finisce', (_label, model) => {
    const { core, queue } = kit(onPad1(model));
    queue.add(36, 127, 0, 10);
    const frames = Math.round(SR * (DRUM_MODELS[model].decay * 2.2 + 0.1));
    const { left } = run(core, queue, frames);
    expect(left.every(Number.isFinite)).toBe(true);
    expect(peak(left)).toBeGreaterThan(0.15);
    expect(peak(left)).toBeLessThan(1.3);
    expect(peak(left, frames - BLOCK * 4)).toBeLessThan(0.01);
    // si spegne da sola: dopo un po' il pad non suona più
    run(core, queue, SR * 4);
    expect(core.activePads).toBe(0);
  });

  it('la nota fuori dai pad non suona; la fine della nota non ferma il colpo', () => {
    const { core, queue } = kit(onPad1(MODEL.boom));
    queue.add(30, 127, 0, 100);
    expect(peak(run(core, queue, SR / 10).left)).toBe(0);
    queue.add(36, 127, SR / 10, SR / 10 + 10); // nota cortissima
    const { left } = run(core, queue, SR);
    expect(peak(left, SR / 2, SR / 2 + 2000)).toBeGreaterThan(0.05);
  });

  it('l\'intonazione cambia la frequenza della cassa 808', () => {
    const hz = (tune: number) => {
      const { core, queue } = kit(onPad1(MODEL.boom, { [padParam(0, 'tune')]: tune, [padParam(0, 'snap')]: 0 }));
      queue.add(36, 127, 0, 10);
      return zeroCrossHz(run(core, queue, 2 * SR).left, SR / 5, 2 * SR);
    };
    expect(hz(0)).toBeCloseTo(46, -1);
    expect(hz(12) / hz(0)).toBeCloseTo(2, 1);
  });

  it('choke: l\'hi-hat chiuso ferma l\'aperto in pochi millisecondi', () => {
    const { core, queue } = kit();
    queue.add(46, 127, 0, 10); // hi-hat aperto
    const open = run(core, queue, SR / 2).left;
    const { core: c2, queue: q2 } = kit({ [padParam(6, 'level')]: -96 }); // il chiuso quasi muto: si sente solo l'aperto
    q2.add(46, 127, 0, 10);
    q2.add(42, 127, SR / 10, SR / 10 + 10);
    const choked = run(c2, q2, SR / 2).left;
    const after = SR / 10 + Math.round(0.03 * SR);
    expect(peak(open, after, after + 2000)).toBeGreaterThan(0.02);
    expect(peak(choked, after, after + 2000)).toBeLessThan(0.002);
  });

  it('pan e livello del pad; velocity con la sensibilità', () => {
    const { core, queue } = kit(onPad1(MODEL.kick, { [padParam(0, 'pan')]: 100, [padParam(0, 'level')]: -6 }));
    queue.add(36, 127, 0, 10);
    const { left, right } = run(core, queue, SR / 4);
    expect(peak(left)).toBeLessThan(1e-6);
    expect(peak(right)).toBeGreaterThan(0.2);
    const loud = (vel: number, sens: number) => {
      const k = kit({ ...onPad1(MODEL.kick), velocity: sens });
      k.queue.add(36, vel, 0, 10);
      return peak(run(k.core, k.queue, SR / 4).left);
    };
    expect(loud(40, 0)).toBeCloseTo(loud(127, 0), 5);
    expect(loud(40, 100)).toBeLessThan(loud(127, 100) * 0.2);
  });

  it('un colpo ripetuto non fa click e stop spegne tutto', () => {
    const { core, queue } = kit(onPad1(MODEL.boom));
    queue.add(36, 127, 0, 10);
    queue.add(36, 127, SR / 8, SR / 8 + 10);
    const { left } = run(core, queue, SR / 4);
    // nessun salto più grande di quelli del suono stesso
    let jump = 0;
    for (let i = 1; i < left.length; i++) jump = Math.max(jump, Math.abs(left[i] - left[i - 1]));
    expect(jump).toBeLessThan(0.1);
    core.silence();
    const tail = run(core, queue, SR / 20).left;
    expect(peak(tail, Math.round(0.03 * SR))).toBeLessThan(1e-4);
  });
});
