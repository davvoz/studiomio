import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import type { InstrumentCore, TransportPosition } from '../../src/devices/dsp/core';
import { seqSettings, seqStep, StepSequencer } from '../../src/devices/dsp/step-sequencer';
import { ANALOG } from '../../src/devices/instruments/analog/analog';
import { NEURO } from '../../src/devices/instruments/neuro/neuro';
import { SEQ_RATE, SEQ_SCALE, SEQ_SCALES } from '../../src/devices/sequencer';
import { INSTRUMENT_CORES } from '../../src/devices/worklet/cores';
import { NoteQueue } from '../../src/devices/worklet/note-queue';

const SR = 48000, BLOCK = 128, BPM = 120;
/** Campioni per battito a 120 BPM: un sedicesimo sono 6000 campioni. */
const BEAT = 24000, STEP = BEAT / 4;

type Event = { kind: 'on' | 'off'; frame: number; id: number; pitch?: number; velocity?: number };

/** Uno strumento finto che scrive cosa riceve e quando (il campione da cui riprende a suonare). */
class Recorder implements InstrumentCore {
  readonly events: Event[] = [];
  frame = 0;
  setParams(): void {}
  noteOn(id: number, pitch: number, velocity: number): void { this.events.push({ kind: 'on', frame: this.frame, id, pitch, velocity }); }
  noteOff(id: number): void { this.events.push({ kind: 'off', frame: this.frame, id }); }
  silence(): void {}
  render(_l: Float32Array, _r: Float32Array, _from: number, to: number): void { this.frame = this.block + to; }
  block = 0;
}

interface Held { readonly pitch: number; readonly on: number; readonly off: number }

/** Suona il sequencer a blocchi come l'AudioWorklet: note tenute dalla coda, trasporto da 0. */
function play(params: Record<string, number>, held: readonly Held[], frames: number, transport: (f: number) => TransportPosition | null = f => ({ beat: f / BEAT, bpm: BPM, beatsPerBar: 4 })) {
  const rec = new Recorder();
  const seq = new StepSequencer(rec, SR);
  seq.setTempo(BPM);
  seq.setParams(resolveParams(ANALOG, { seqOn: 1, ...params }));
  const queue = new NoteQueue();
  for (const h of held) queue.add(h.pitch, 100, h.on, h.off);
  const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
  for (let f = 0; f < frames; f += BLOCK) {
    rec.block = f;
    rec.frame = f;
    seq.setTransport(transport(f));
    queue.renderBlock(seq, l, r, f);
  }
  return rec.events;
}

const ons = (events: readonly Event[]) => events.filter(e => e.kind === 'on');

describe('sequencer a passi', () => {
  it('spento lascia passare le note com\'è', () => {
    const rec = new Recorder();
    const seq = new StepSequencer(rec, SR);
    seq.setParams(resolveParams(ANALOG, {}));
    seq.noteOn(7, 48, 100);
    seq.noteOff(7);
    expect(rec.events.map(e => [e.kind, e.id, e.pitch])).toEqual([['on', 7, 48], ['off', 7, undefined]]);
  });

  it('acceso suona i passi sui sedicesimi, trasposti sulla nota tenuta, finché la si tiene', () => {
    const events = play({ seqDensity: 100, seqRange: 0, seqSlide: 0, seqGate: 50 }, [{ pitch: 36, on: 0, off: 8 * STEP }], 12 * STEP);
    const on = ons(events);
    expect(on).toHaveLength(8);
    on.forEach((e, k) => {
      expect(e.frame).toBe(k * STEP);
      expect(e.pitch).toBe(36);
    });
    // gate al 50 %: ogni nota finisce a metà del suo passo
    const offs = events.filter(e => e.kind === 'off');
    expect(offs[0].frame).toBe(STEP / 2);
    expect(events.at(-1)!.kind).toBe('off');
  });

  it('una nota tenuta che arriva un attimo dopo il confine suona lo stesso il primo passo', () => {
    const events = play({ seqDensity: 100, seqRange: 0 }, [{ pitch: 40, on: 300, off: 4 * STEP }], 6 * STEP);
    expect(ons(events)[0].frame).toBe(300);
    expect(ons(events)[0].pitch).toBe(40);
    expect(ons(events)).toHaveLength(4);
  });

  it('acceso un blocco dopo la sua nota (la clip che lo accende) prende quella nota e suona il primo passo', () => {
    const rec = new Recorder();
    const seq = new StepSequencer(rec, SR);
    seq.setTempo(BPM);
    seq.setParams(resolveParams(ANALOG, {}));
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    for (let f = 0; f < 4 * STEP; f += BLOCK) {
      rec.block = rec.frame = f;
      if (f === BLOCK) seq.setParams(resolveParams(ANALOG, { seqOn: 1, seqDensity: 100, seqRange: 0 }));
      seq.setTransport({ beat: f / BEAT, bpm: BPM, beatsPerBar: 4 });
      if (f === 0) seq.noteOn(1, 41, 100);
      seq.render(l, r, 0, BLOCK);
    }
    // la nota passata diretta si spegne; il primo passo suona subito, gli altri sui sedicesimi
    expect(rec.events[0]).toMatchObject({ kind: 'on', id: 1, pitch: 41 });
    expect(rec.events[1]).toMatchObject({ kind: 'off', id: 1, frame: BLOCK });
    const steps = ons(rec.events).slice(1).filter(e => e.frame < 4 * STEP);
    expect(steps.map(e => e.frame)).toEqual([BLOCK, STEP, 2 * STEP, 3 * STEP]);
    expect(steps.every(e => e.pitch === 41)).toBe(true);
  });

  it('a densità più alta si aggiungono passi, quelli che c\'erano restano', () => {
    const s = (density: number) => seqSettings(resolveParams(ANALOG, { seqDensity: density }));
    const hits = (density: number) => Array.from({ length: 16 }, (_, i) => seqStep(s(density), 5, i, i / 4).hit);
    let prev = hits(0);
    expect(prev.every(h => !h)).toBe(true);
    for (const d of [20, 40, 60, 80, 100]) {
      const now = hits(d);
      prev.forEach((h, i) => { if (h) expect(now[i]).toBe(true); });
      prev = now;
    }
    expect(prev.every(Boolean)).toBe(true);
    // con poca densità entrano prima i levare dell'ottavo (tra una cassa e l'altra)
    const few = Array.from({ length: 64 }, (_, pattern) => Array.from({ length: 16 }, (_, i) => (seqStep(s(25), pattern, i, i / 4).hit ? [i % 4] : [])).flat()).flat();
    expect(few.length).toBeGreaterThan(64);
    expect(few.filter(p => p === 2).length / few.length).toBeGreaterThan(0.75);
  });

  it('l\'altezza allarga la scala nell\'ordine: a 0 solo la tonica', () => {
    const at = (range: number) => seqSettings(resolveParams(ANALOG, { seqRange: range, seqScale: SEQ_SCALE['Frigio e tritono'] }));
    const intervals = (range: number) => new Set(Array.from({ length: 32 }, (_, i) => seqStep(at(range), 9, i, i / 4).interval));
    expect([...intervals(0)]).toEqual([0]);
    const scale = SEQ_SCALES[SEQ_SCALE['Frigio e tritono']][1];
    for (const i of intervals(100)) expect(scale).toContain(i);
    expect(intervals(100).size).toBeGreaterThan(4);
  });

  it('"Lascia alla cassa": nessun passo sul battito', () => {
    const events = play({ seqDensity: 100, seqKick: 1 }, [{ pitch: 36, on: 0, off: 16 * STEP }], 16 * STEP);
    expect(ons(events).length).toBe(12);
    for (const e of ons(events)) expect(e.frame % BEAT).not.toBe(0);
  });

  it('lo slide accende la nota nuova prima di spegnere quella di prima (il legato della 303)', () => {
    const events = play({ seqDensity: 100, seqSlide: 100, seqRange: 100, seqPattern: 3 }, [{ pitch: 36, on: 0, off: 4 * STEP }], 4 * STEP);
    const second = events.findIndex((e, i) => i > 0 && e.kind === 'on');
    expect(events[second + 1]).toMatchObject({ kind: 'off', id: events[0].id, frame: STEP });
  });

  it('un pattern nuovo entra all\'inizio del giro', () => {
    const rec = new Recorder();
    const seq = new StepSequencer(rec, SR);
    const base = { seqOn: 1, seqDensity: 100, seqRange: 100, seqLength: 16, seqPattern: 1 };
    seq.setTempo(BPM);
    seq.setParams(resolveParams(ANALOG, base));
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    seq.noteOn(1, 36, 100);
    for (let f = 0; f < 32 * STEP; f += BLOCK) {
      // il pattern cambia a metà del primo giro
      if (f === 8 * STEP) seq.setParams(resolveParams(ANALOG, { ...base, seqPattern: 2 }));
      rec.block = rec.frame = f;
      seq.setTransport({ beat: f / BEAT, bpm: BPM, beatsPerBar: 4 });
      seq.render(l, r, 0, BLOCK);
    }
    const pitches = ons(rec.events).map(e => e.pitch! - 36);
    const s = seqSettings(resolveParams(ANALOG, base));
    const expected = (pattern: number) => Array.from({ length: 16 }, (_, i) => seqStep(s, pattern, i, i / 4).interval);
    expect(pitches.slice(0, 16)).toEqual(expected(1));
    expect(pitches.slice(16, 32)).toEqual(expected(2));
  });

  it('fermo il trasporto, tace; un salto riparte da lì', () => {
    const events = play({ seqDensity: 100, seqRange: 0 }, [{ pitch: 36, on: 0, off: 40 * STEP }], 20 * STEP, f => (f < 8 * STEP ? null : { beat: 100 + (f - 8 * STEP) / BEAT, bpm: BPM, beatsPerBar: 4 }));
    // dal battito 100 i passi cadono di nuovo sui sedicesimi
    const on = ons(events).filter(e => e.frame < 20 * STEP);
    expect(on[0].frame).toBe(8 * STEP);
    expect(on).toHaveLength(12);
    on.forEach((e, k) => expect(e.frame).toBe((8 + k) * STEP));
  });

  it('le velocità: ottavi, sedicesimi, terzine, trentaduesimi', () => {
    for (const [rate, count] of [['1/8', 4], ['1/16', 8], ['1/16T', 12], ['1/32', 16]] as const) {
      const events = play({ seqDensity: 100, seqRate: SEQ_RATE[rate] }, [{ pitch: 36, on: 0, off: 2 * BEAT }], 2 * BEAT);
      expect(ons(events), rate).toHaveLength(count);
    }
  });

  it('Analog e Neuro hanno il sequencer, spento: i progetti salvati suonano come prima', () => {
    for (const type of [ANALOG, NEURO]) {
      expect(resolveParams(type, {}).seqOn).toBe(0);
      const core = INSTRUMENT_CORES[type.type](SR);
      expect(core).toBeInstanceOf(StepSequencer);
    }
  });

  it('con un Analog vero suona: c\'è segnale dove ci sono i passi', () => {
    const core = INSTRUMENT_CORES.analog(SR) as StepSequencer;
    core.setTempo(BPM);
    core.setParams(resolveParams(ANALOG, { seqOn: 1, seqDensity: 100, seqRange: 0, seqGate: 50, voiceMode: 2 }));
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    let energy = 0;
    core.noteOn(1, 45, 100);
    for (let f = 0; f < 2 * BEAT; f += BLOCK) {
      l.fill(0);
      r.fill(0);
      core.setTransport({ beat: f / BEAT, bpm: BPM, beatsPerBar: 4 });
      core.render(l, r, 0, BLOCK);
      for (let i = 0; i < BLOCK; i++) energy += l[i] * l[i];
    }
    expect(energy).toBeGreaterThan(1);
  });
});
