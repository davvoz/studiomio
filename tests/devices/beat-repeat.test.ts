import { beforeAll, describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import type { TransportPosition } from '../../src/devices/dsp/core';
import { BEAT_REPEAT, GRIDS, INTERVALS, REPEAT_MODE } from '../../src/devices/effects/beat-repeat/beat-repeat';
import { BeatRepeatCore } from '../../src/devices/effects/beat-repeat/beat-repeat-core';
import { EFFECT_PROCESSOR, type EffectMessage, type EffectProcessorOptions } from '../../src/devices/worklet/protocol';
import { TransportClock } from '../../src/devices/worklet/transport-clock';

const SR = 48000, BLOCK = 128, BPM = 120;
/** Campioni per battito e per battuta a 120 BPM. */
const BEAT = 24000, BAR = 4 * BEAT;
const BPS = BPM / 60 / SR;

/** Un ingresso che dice da dove viene ogni campione: il campione n vale n + 1 (a destra −(n + 1)). */
const ramp = (n: number) => n + 1;

/** La posizione del trasporto al campione `f` (null: fermo). Di base parte dal battito 0. */
type Transport = (frame: number) => TransportPosition | null;
const fromZero: Transport = f => ({ beat: f * BPS, bpm: BPM, beatsPerBar: 4 });

interface Run {
  readonly frames: number;
  readonly input?: (n: number) => number;
  readonly transport?: Transport;
  /** Parametri che cambiano dall'inizio del blocco che contiene il campione dato. */
  readonly changes?: readonly (readonly [frame: number, params: Record<string, number>])[];
}

/** Fa suonare il Beat Repeat a blocchi, come l'AudioWorklet. */
function play(params: Record<string, number>, o: Run): [Float32Array, Float32Array] {
  const core = new BeatRepeatCore(SR);
  core.setTempo(BPM);
  let values = { ...params };
  core.setParams(resolveParams(BEAT_REPEAT, values));
  const input = o.input ?? ramp, transport = o.transport ?? fromZero;
  const outL = new Float32Array(o.frames), outR = new Float32Array(o.frames);
  const inL = new Float32Array(BLOCK), inR = new Float32Array(BLOCK), l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
  for (let f = 0; f < o.frames; f += BLOCK) {
    for (const [at, change] of o.changes ?? []) {
      if (at >= f && at < f + BLOCK) {
        values = { ...values, ...change };
        core.setParams(resolveParams(BEAT_REPEAT, values));
      }
    }
    for (let i = 0; i < BLOCK; i++) {
      inL[i] = input(f + i);
      inR[i] = -input(f + i);
    }
    core.setTransport(transport(f));
    core.process(inL, inR, l, r, BLOCK);
    outL.set(l.subarray(0, Math.min(BLOCK, o.frames - f)), f);
    outR.set(r.subarray(0, Math.min(BLOCK, o.frames - f)), f);
  }
  return [outL, outR];
}

const grid = (label: string) => GRIDS.findIndex(([l]) => l === label);
const interval = (label: string) => INTERVALS.findIndex(([l]) => l === label);

/** Con i valori predefiniti: ogni battuta, dal terzo quarto (campione 48000), un pezzo di 1/16
 *  (6000 campioni) per mezza battuta (48000 campioni). Qui le ripetizioni sostituiscono il suono. */
const INSERT = { mode: REPEAT_MODE.insert };
const TRIGGER = 2 * BEAT, SLICE = BEAT / 4, GATE = 2 * BEAT;

describe('Beat Repeat: quando ripete', () => {
  it('dal terzo quarto il pezzo di 1/16 si ripete fino alla fine del gate, poi torna il suono', () => {
    const [l, r] = play(INSERT, { frames: 2 * BAR });
    expect(l[TRIGGER - 1]).toBe(ramp(TRIGGER - 1)); // prima: il suono diretto
    expect(l[TRIGGER + 100]).toBe(ramp(TRIGGER + 100)); // il pezzo passa dal vivo mentre si cattura
    expect(l[TRIGGER + SLICE + 100]).toBe(ramp(TRIGGER + 100)); // primo giro
    expect(l[TRIGGER + 5 * SLICE + 3000]).toBe(ramp(TRIGGER + 3000)); // quinto
    expect(r[TRIGGER + 5 * SLICE + 3000]).toBe(-ramp(TRIGGER + 3000));
    expect(l[TRIGGER + GATE + 200]).toBe(ramp(TRIGGER + GATE + 200)); // dopo il gate
    // e alla battuta dopo, di nuovo
    expect(l[BAR + TRIGGER + SLICE + 100]).toBe(ramp(BAR + TRIGGER + 100));
  });

  it('Mix somma le ripetizioni al suono, Gate lascia solo le ripetizioni', () => {
    const [mix] = play({ mode: REPEAT_MODE.mix }, { frames: BAR });
    expect(mix[TRIGGER + 100]).toBe(ramp(TRIGGER + 100));
    expect(mix[TRIGGER + SLICE + 100]).toBe(ramp(TRIGGER + SLICE + 100) + ramp(TRIGGER + 100));
    const [gate] = play({ mode: REPEAT_MODE.gate }, { frames: BAR });
    expect(gate[1000]).toBe(0);
    expect(gate[TRIGGER + 100]).toBe(0);
    expect(gate[TRIGGER + SLICE + 100]).toBe(ramp(TRIGGER + 100));
  });

  it('Intervallo e Offset: ogni quarto, sul secondo sedicesimo', () => {
    const [l] = play({ ...INSERT, interval: interval('1/4'), offset: 1, gate: 2, grid: grid('1/32') }, { frames: 3 * BEAT });
    const at = BEAT / 4, slice = BEAT / 8;
    for (const beat of [0, 1, 2]) expect(l[beat * BEAT + at + slice + 50]).toBe(ramp(beat * BEAT + at + 50));
  });

  it('a 0% di probabilità non ripete mai', () => {
    const [l] = play({ ...INSERT, chance: 0, interval: interval('1/16'), offset: 0 }, { frames: BAR });
    expect(l.every((y, n) => y === ramp(n))).toBe(true);
  });

  it('al 50% ripete più o meno metà delle volte', () => {
    const [l] = play({ ...INSERT, chance: 50, interval: interval('1/8'), offset: 0, gate: 2, grid: grid('1/16') }, { frames: 16 * BAR });
    let hits = 0;
    for (let k = 0; k < 128; k++) if (l[(k * BEAT) / 2 + SLICE + 10] !== ramp((k * BEAT) / 2 + SLICE + 10)) hits++;
    expect(hits).toBeGreaterThan(40);
    expect(hits).toBeLessThan(88);
  });

  it('un salto all\'indietro (loop) su una linea dell\'intervallo fa ripetere lì', () => {
    // un loop di una battuta da 0: si ripete all'inizio di ogni giro
    const loop: Transport = f => ({ beat: (f % BAR) * BPS, bpm: BPM, beatsPerBar: 4 });
    const [l] = play({ ...INSERT, offset: 0 }, { frames: 2 * BAR, transport: loop });
    expect(l[SLICE + 100]).toBe(ramp(100));
    expect(l[BAR + SLICE + 100]).toBe(ramp(BAR + 100));
  });

  it('le battute seguono il metro: in 3/4 "1 battuta" sono tre quarti', () => {
    const waltz: Transport = f => ({ beat: f * BPS, bpm: BPM, beatsPerBar: 3 });
    const [l] = play({ ...INSERT, offset: 0, gate: 4 }, { frames: 4 * BEAT, transport: waltz });
    expect(l[3 * BEAT + SLICE + 100]).toBe(ramp(3 * BEAT + 100));
  });

  it('da fermo non ripete da solo', () => {
    const [l] = play(INSERT, { frames: BAR, transport: () => null });
    expect(l.every((y, n) => y === ramp(n))).toBe(true);
  });
});

describe('Beat Repeat: il pulsante Repeat', () => {
  it('da fermo ripete subito, finché resta acceso', () => {
    const on = 10 * BLOCK, off = 40000 - (40000 % BLOCK);
    const [l] = play(INSERT, { frames: 50000, transport: () => null, changes: [[on, { repeat: 1 }], [off, { repeat: 0 }]] });
    expect(l[on - 1]).toBe(ramp(on - 1));
    expect(l[on + SLICE + 100]).toBe(ramp(on + 100));
    expect(l[on + 5 * SLICE + 100]).toBe(ramp(on + 100));
    expect(l[off + 500]).toBe(ramp(off + 500)); // spento: torna il suono dopo la dissolvenza
  });

  it('mentre suona parte sulla prossima linea della griglia e intanto non ripete da solo', () => {
    const [l] = play(INSERT, { frames: 60000, changes: [[10 * BLOCK, { repeat: 1 }]] });
    // acceso a 1280: la prossima linea di 1/16 è 6000
    expect(l[5000]).toBe(ramp(5000));
    expect(l[SLICE + SLICE + 100]).toBe(ramp(SLICE + 100));
    // al terzo quarto (48000) non riparte: continua lo stesso pezzo
    expect(l[TRIGGER + 3000]).toBe(ramp(SLICE + 3000));
  });
});

describe('Beat Repeat: le ripetizioni', () => {
  it('Pitch −12: le ripetizioni vanno a metà velocità', () => {
    const [l] = play({ ...INSERT, pitch: -12 }, { frames: BAR });
    expect(l[TRIGGER + SLICE + 1000]).toBeCloseTo(ramp(TRIGGER + 500), 3);
    expect(l[TRIGGER + 2 * SLICE + 1001]).toBeCloseTo(ramp(TRIGGER + 500.5), 3);
  });

  it('Discesa: ogni giro un po\' più in basso', () => {
    const [l] = play({ ...INSERT, pitchDecay: 2 }, { frames: BAR });
    expect(l[TRIGGER + SLICE + 1000]).toBe(ramp(TRIGGER + 1000)); // il primo giro com'è
    expect(l[TRIGGER + 2 * SLICE + 1000]).toBeCloseTo(ramp(TRIGGER + 1000 * 2 ** (-2 / 12)), 1);
    expect(l[TRIGGER + 3 * SLICE + 1000]).toBeCloseTo(ramp(TRIGGER + 1000 * 2 ** (-4 / 12)), 1);
  });

  it('Decadimento e Volume: ogni giro più piano', () => {
    const [l] = play({ ...INSERT, decay: 50, volume: -6 }, { frames: BAR });
    const g = 10 ** (-6 / 20);
    expect(l[TRIGGER + SLICE + 100]).toBeCloseTo(ramp(TRIGGER + 100) * g, 0);
    expect(l[TRIGGER + 2 * SLICE + 100]).toBeCloseTo(ramp(TRIGGER + 100) * g * 0.5, 0);
    expect(l[TRIGGER + 3 * SLICE + 100]).toBeCloseTo(ramp(TRIGGER + 100) * g * 0.25, 0);
  });

  it('Variazione: pezzi di lunghezze diverse, mai più lunghi della griglia', () => {
    const [l] = play({ ...INSERT, variation: 100, interval: interval('1/2'), offset: 0, gate: 8 }, { frames: 8 * BAR });
    const lengths = new Set<number>();
    for (let k = 0; k < 16; k++) {
      // dopo un pezzo lungo `len` si rilegge il suo inizio
      const at = k * 2 * BEAT;
      const len = [SLICE / 8, SLICE / 4, SLICE / 2, SLICE].find(n => l[at + n + 10] === ramp(at + 10));
      expect(len).toBeDefined();
      lengths.add(len!);
    }
    expect(lengths.size).toBeGreaterThan(2);
  });

  it('niente click: su un seno il suono non salta, né tra i giri né all\'inizio e alla fine', () => {
    const sine = (n: number) => Math.sin((2 * Math.PI * 220 * n) / SR);
    const cases: Record<string, number>[] = [
      INSERT, { ...INSERT, pitch: -7, pitchDecay: 1 }, { ...INSERT, interval: interval('1/8'), offset: 0, gate: 4, grid: grid('1/32T') },
      { mode: REPEAT_MODE.mix, decay: 20 }, { ...INSERT, interval: interval('1/16'), offset: 0, gate: 16, grid: grid('1/16') },
    ];
    for (const params of cases) {
      const [l] = play(params, { frames: 2 * BAR, input: sine });
      let jump = 0;
      for (let n = 1; n < l.length; n++) jump = Math.max(jump, Math.abs(l[n] - l[n - 1]));
      expect(jump).toBeLessThan(0.08); // il seno da solo arriva a 0.029 per campione
    }
  });

  it('il filtro passa-banda toglie acuti e bassi dalle ripetizioni, non dal suono diretto', () => {
    const hiss = (n: number) => Math.sin((2 * Math.PI * 12000 * n) / SR);
    const [plain] = play(INSERT, { frames: BAR, input: hiss });
    const [filtered] = play({ ...INSERT, filter: 1, freq: 500, width: 1 }, { frames: BAR, input: hiss });
    const rms = (x: Float32Array, from: number, to: number) => Math.sqrt(x.subarray(from, to).reduce((s, y) => s + y * y, 0) / (to - from));
    expect(rms(filtered, 1000, 20000)).toBeCloseTo(rms(plain, 1000, 20000), 6);
    expect(rms(filtered, TRIGGER + SLICE, TRIGGER + 3 * SLICE)).toBeLessThan(rms(plain, TRIGGER + SLICE, TRIGGER + 3 * SLICE) * 0.05);
  });
});

describe('Orologio del trasporto (worklet)', () => {
  const bar = { bpm: 120, beatsPerBar: 4 };

  it('fermo finché il primo ancoraggio non vale, poi conta da solo', () => {
    const c = new TransportClock();
    expect(c.at(0)).toBeNull();
    c.set({ time: 1, beat: 0, ...bar });
    expect(c.at(0.9)).toBeNull();
    expect(c.at(1.5)).toEqual({ beat: 1, ...bar });
  });

  it('un giro di loop annunciato vale dal suo istante; un salto annulla quelli che verrebbero dopo', () => {
    const c = new TransportClock();
    c.set({ time: 0, beat: 0, ...bar });
    c.set({ time: 2, beat: 0, ...bar }); // loop di 4 battiti
    expect(c.at(1.9)!.beat).toBeCloseTo(3.8, 9);
    expect(c.at(2.1)!.beat).toBeCloseTo(0.2, 9);
    c.set({ time: 4, beat: 0, ...bar });
    c.set({ time: 3, beat: 8, bpm: 60, beatsPerBar: 4 }); // salto (a un altro tempo) prima del giro
    expect(c.at(5)!.beat).toBeCloseTo(10, 9);
  });

  it('allo stop si ferma subito', () => {
    const c = new TransportClock();
    c.set({ time: 0, beat: 0, ...bar });
    c.set(null);
    expect(c.at(1)).toBeNull();
  });
});

// ------------------------------------------------------------------ nel processore dell'AudioWorklet

interface FakePort { onmessage: ((e: { data: EffectMessage }) => void) | null; postMessage(): void }
type Processor = { port: FakePort; process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean };
const processors = new Map<string, new (o: { processorOptions: EffectProcessorOptions }) => Processor>();

describe('Beat Repeat nel processore degli effetti', () => {
  const scope = globalThis as unknown as { currentFrame: number };

  beforeAll(async () => {
    // i globali dell'AudioWorkletGlobalScope che il modulo usa
    Object.assign(globalThis, {
      sampleRate: SR, currentFrame: 0,
      AudioWorkletProcessor: class { readonly port: FakePort = { onmessage: null, postMessage() {} }; },
      registerProcessor: (name: string, ctor: never) => processors.set(name, ctor),
    });
    await import('../../src/devices/worklet/devices.worklet');
  });

  /** Fa suonare il processore da `from` a `to` (campioni del contesto) con l'ingresso a rampa. */
  function render(p: Processor, out: Float32Array, from: number, to: number): void {
    for (let f = from; f < to; f += BLOCK) {
      scope.currentFrame = f;
      const inp = Float32Array.from({ length: BLOCK }, (_, i) => ramp(f + i));
      const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
      p.process([[inp, inp]], [[l, r]]);
      out.set(l, f);
    }
  }

  it('segue gli ancoraggi del trasporto: parte all\'istante dato e allo stop non ripete più', () => {
    const params = resolveParams(BEAT_REPEAT, INSERT);
    // il trasporto parte a 0.5 s (campione 24000): il terzo quarto cade a 72000
    const transport = { time: 0.5, beat: 0, bpm: BPM, beatsPerBar: 4 };
    const p = new (processors.get(EFFECT_PROCESSOR)!)({
      processorOptions: { type: 'beatRepeat', params, enabled: true, bpm: BPM, keyed: false, transport },
    });
    const start = 24000 + TRIGGER, stop = Math.ceil((start + BAR) / BLOCK) * BLOCK, out = new Float32Array(4 * BAR);
    render(p, out, 0, stop);
    expect(out[start - 1]).toBe(ramp(start - 1));
    expect(out[start + SLICE + 100]).toBe(ramp(start + 100));
    p.port.onmessage!({ data: { type: 'transport', anchor: null } });
    render(p, out, stop, 4 * BAR);
    // quella partita appena prima dello stop finisce il suo gate, poi niente più
    for (let n = stop + GATE; n < 4 * BAR; n += 1000) expect(out[n]).toBe(ramp(n));
  });
});
