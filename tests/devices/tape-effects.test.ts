import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import type { TransportPosition } from '../../src/devices/dsp/core';
import { TapeBuffer, TapeReader } from '../../src/devices/dsp/tape-buffer';
import { REVERSE, REVERSE_LENGTHS } from '../../src/devices/effects/reverse/reverse';
import { ReverseCore } from '../../src/devices/effects/reverse/reverse-core';
import { BRAKE_DIVISIONS, STARTS, TAPE_STOP, TAPE_SYNC } from '../../src/devices/effects/tape-stop/tape-stop';
import { TapeStopCore } from '../../src/devices/effects/tape-stop/tape-stop-core';

const SR = 48000, BLOCK = 128, BPM = 120;
const BEAT = 24000, SIXTEENTH = 6000;
const BPS = BPM / 60 / SR;

/** Il campione n vale n + 1: dall'uscita si legge da dove viene il suono. */
const ramp = (n: number) => n + 1;
const sine = (n: number) => 0.5 * Math.sin((2 * Math.PI * 220 * n) / SR);

type Transport = (frame: number) => TransportPosition | null;
const fromZero: Transport = f => ({ beat: f * BPS, bpm: BPM, beatsPerBar: 4 });

interface Core {
  setTempo(bpm: number): void;
  setParams(p: Record<string, number>): void;
  setTransport(t: TransportPosition | null): void;
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void;
}

interface Run {
  readonly frames: number;
  readonly input?: (n: number) => number;
  readonly transport?: Transport;
  /** Parametri che cambiano dall'inizio del blocco che contiene il campione dato. */
  readonly changes?: readonly (readonly [frame: number, params: Record<string, number>])[];
}

function play(core: Core, resolve: (v: Record<string, number>) => Record<string, number>, params: Record<string, number>, o: Run): Float32Array {
  core.setTempo(BPM);
  let values = { ...params };
  core.setParams(resolve(values));
  const input = o.input ?? ramp, transport = o.transport ?? fromZero;
  const out = new Float32Array(o.frames);
  const inL = new Float32Array(BLOCK), inR = new Float32Array(BLOCK), l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
  for (let f = 0; f < o.frames; f += BLOCK) {
    for (const [at, change] of o.changes ?? []) {
      if (at >= f && at < f + BLOCK) {
        values = { ...values, ...change };
        core.setParams(resolve(values));
      }
    }
    for (let i = 0; i < BLOCK; i++) inL[i] = inR[i] = input(f + i);
    core.setTransport(transport(f));
    core.process(inL, inR, l, r, BLOCK);
    out.set(l.subarray(0, Math.min(BLOCK, o.frames - f)), f);
  }
  return out;
}

const tapeStop = (params: Record<string, number>, o: Run) => play(new TapeStopCore(SR), v => resolveParams(TAPE_STOP, v), params, o);
const reverse = (params: Record<string, number>, o: Run) => play(new ReverseCore(SR), v => resolveParams(REVERSE, v), params, o);

/** Il salto più grande tra due campioni vicini in [from, to). */
function maxJump(x: Float32Array, from = 1, to = x.length): number {
  let j = 0;
  for (let n = Math.max(1, from); n < to; n++) j = Math.max(j, Math.abs(x[n] - x[n - 1]));
  return j;
}

describe('Nastro', () => {
  it('rilegge i campioni registrati; fra due campioni interpola (una rampa resta una rampa)', () => {
    const tape = new TapeBuffer(1000), out = new Float32Array(2);
    for (let n = 0; n < 2500; n++) tape.write(n, -n);
    tape.read(2000, out);
    expect([...out]).toEqual([2000, -2000]);
    tape.read(1999.25, out);
    expect(out[0]).toBeCloseTo(1999.25, 6);
    // troppo indietro (il nastro ricorda 1000 campioni) o nel futuro: silenzio
    tape.read(1000, out);
    expect(out[0]).toBe(0);
    tape.read(2500, out);
    expect(out[0]).toBe(0);
  });

  it('allungato, tiene il passato che aveva', () => {
    const tape = new TapeBuffer(100), out = new Float32Array(2);
    for (let n = 0; n < 250; n++) tape.write(n, n);
    tape.ensure(1000);
    for (let n = 250; n < 300; n++) tape.write(n, n);
    for (const p of [150, 249, 250, 299]) {
      tape.read(p, out);
      expect(out[0]).toBe(p);
    }
  });

  it('la testina che salta sfuma dalla lettura vecchia a quella nuova', () => {
    const tape = new TapeBuffer(1000), out = new Float32Array(2);
    for (let n = 0; n < 1000; n++) tape.write(n < 500 ? 1 : 0, 0);
    const reader = new TapeReader(10);
    reader.pos = 100;
    reader.jump(800, 1);
    const heard: number[] = [];
    for (let k = 0; k < 12; k++) {
      reader.read(tape, 1, out);
      heard.push(out[0]);
    }
    expect(heard[0]).toBeCloseTo(1, 6);
    expect(heard.slice(1, 10).every((v, k) => v < heard[k])).toBe(true);
    expect(heard[11]).toBe(0);
  });
});

describe('Tape Stop', () => {
  /** Lo Stop si accende all'inizio di un blocco. */
  const on = 47 * BLOCK;

  it('spento il suono passa identico', () => {
    const out = tapeStop({}, { frames: 10000 });
    expect(out.every((y, n) => y === ramp(n))).toBe(true);
  });

  it('Stop: rallenta fino a fermarsi nella Durata (1/2 a 120 BPM = 1 s), poi tace', () => {
    const out = tapeStop({}, { frames: on + SR + 2000, changes: [[on, { stop: 1 }]] });
    expect(out[on - 1]).toBe(ramp(on - 1));
    // la velocità è quanto avanza la testina a ogni campione: cala in linea retta
    const speed = (n: number) => out[n + 1] - out[n];
    expect(speed(on + 10)).toBeCloseTo(1, 2);
    expect(speed(on + SR / 4)).toBeCloseTo(0.75, 2);
    expect(speed(on + SR / 2)).toBeCloseTo(0.5, 2);
    // ferma: silenzio
    expect(out[on + SR + 100]).toBe(0);
  });

  it('Durata in ms e curva rapida: a metà va già piano', () => {
    const out = tapeStop({ sync: TAPE_SYNC.ms, time: 200, curve: 2 }, { frames: on + SR / 2, changes: [[on, { stop: 1 }]] });
    expect(out[on + 4800 + 1] - out[on + 4800]).toBeCloseTo(0.25, 2);
    expect(out[on + 9700]).toBe(0);
  });

  it('spento lo Stop, senza ripartenza torna subito il suono di adesso', () => {
    const off = 500 * BLOCK;
    const out = tapeStop({}, { frames: off + 2000, changes: [[on, { stop: 1 }], [off, { stop: 0 }]] });
    expect(out[off - 1]).toBe(0);
    // sale in 5 ms (niente click), poi è il suono di adesso
    expect(out[off]).toBeLessThan(ramp(off) / 100);
    expect(out[off + 1000]).toBe(ramp(off + 1000));
  });

  it('con la ripartenza accelera da fermo e poi torna al vivo', () => {
    const off = 500 * BLOCK, spin = SR / 2;
    const out = tapeStop({ spin: 500 }, { frames: off + spin + 3000, changes: [[on, { stop: 1 }], [off, { stop: 0 }]] });
    const speed = (n: number) => out[n + 1] - out[n];
    expect(speed(off + spin / 2)).toBeCloseTo(0.5, 1);
    expect(speed(off + spin * 0.9)).toBeCloseTo(0.9, 1);
    expect(out[off + spin + 2000]).toBe(ramp(off + spin + 2000));
  });

  it('Partenza 1/4: la frenata aspetta il prossimo quarto', () => {
    const quarter = STARTS.findIndex(([l]) => l === '1/4');
    const out = tapeStop({ start: quarter }, { frames: BEAT + 1000, changes: [[10 * BLOCK, { stop: 1 }]] });
    expect(out[BEAT - 1]).toBe(ramp(BEAT - 1));
    expect(out[BEAT + 501] - out[BEAT + 500]).toBeLessThan(1);
  });

  it('da fermo la Partenza non aspetta', () => {
    const quarter = STARTS.findIndex(([l]) => l === '1/4');
    const out = tapeStop({ start: quarter }, { frames: 4000, transport: () => null, changes: [[10 * BLOCK, { stop: 1 }]] });
    expect(out[10 * BLOCK + 2001] - out[10 * BLOCK + 2000]).toBeLessThan(1);
  });

  it('niente click: frenata, silenzio, ripartenza e Stop spento a metà frenata', () => {
    const quick = BRAKE_DIVISIONS.findIndex(([l]) => l === '1/8');
    const cases: Run[] = [
      { frames: 3 * SR, input: sine, changes: [[on, { stop: 1 }], [SR + 100 * BLOCK, { stop: 0 }]] },
      { frames: 2 * SR, input: sine, changes: [[on, { stop: 1 }], [on + 40 * BLOCK, { stop: 0 }]] },
    ];
    for (const spin of [0, 300]) {
      for (const run of cases) expect(maxJump(tapeStop({ division: quick, spin }, run))).toBeLessThan(0.06); // il seno: 0.014
    }
  });
});

describe('Reverse', () => {
  const sixteenths = REVERSE_LENGTHS.findIndex(([l]) => l === '1/16');

  it('durante un pezzo si sente quello prima, dalla fine all\'inizio', () => {
    const out = reverse({ length: sixteenths }, { frames: 3 * SIXTEENTH });
    // a 1000 campioni dall'inizio del secondo pezzo: 2000 campioni indietro
    expect(out[SIXTEENTH + 1000]).toBe(ramp(SIXTEENTH - 1000));
    expect(out[SIXTEENTH + 5000]).toBe(ramp(SIXTEENTH - 5000));
    expect(out[2 * SIXTEENTH + 3000]).toBe(ramp(2 * SIXTEENTH - 3000));
  });

  it('Dry/Wet mescola il suono diritto', () => {
    const out = reverse({ length: sixteenths, mix: 50 }, { frames: 2 * SIXTEENTH });
    expect(out[SIXTEENTH + 1000]).toBeCloseTo((ramp(SIXTEENTH + 1000) + ramp(SIXTEENTH - 1000)) / 2, 2);
  });

  it('acceso e spento al volo, con una sfumatura', () => {
    const off = 50 * BLOCK, on = 140 * BLOCK;
    const out = reverse({ length: sixteenths }, { frames: 4 * SIXTEENTH, changes: [[off, { reverse: 0 }], [on, { reverse: 1 }]] });
    expect(out[off + 1000]).toBe(ramp(off + 1000));
    const u = (on + 1000) % SIXTEENTH;
    expect(out[on + 1000]).toBe(ramp(on + 1000 - 2 * u));
  });

  it('dopo un salto del trasporto i pezzi ripartono dal punto giusto', () => {
    // a 3072 il trasporto salta a 1/8 + 1000 campioni: siamo a 1000 campioni dal pezzo che inizia lì
    const jump: Transport = f => ({ beat: f < 3072 ? f * BPS : 0.5 + (1000 + f - 3072) * BPS, bpm: BPM, beatsPerBar: 4 });
    const out = reverse({ length: sixteenths }, { frames: 6000, transport: jump });
    const n = 3072 + 1000, u = 2000;
    expect(out[n]).toBe(ramp(n - 2 * u));
  });

  it('una battuta segue il metro; da fermo i pezzi girano liberi', () => {
    const bar = REVERSE_LENGTHS.findIndex(([l]) => l === '1 battuta');
    const waltz = reverse({ length: bar }, { frames: 3 * BEAT + 2000, transport: f => ({ beat: f * BPS, bpm: BPM, beatsPerBar: 3 }) });
    expect(waltz[3 * BEAT + 1000]).toBe(ramp(3 * BEAT - 1000));
    const free = reverse({ length: sixteenths }, { frames: 2 * SIXTEENTH, transport: () => null });
    expect(free[SIXTEENTH + 1000]).toBe(ramp(SIXTEENTH - 1000));
  });

  it('niente click tra un pezzo e l\'altro', () => {
    for (const length of [sixteenths, REVERSE_LENGTHS.findIndex(([l]) => l === '1/4')]) {
      expect(maxJump(reverse({ length }, { frames: 2 * BEAT, input: sine }))).toBeLessThan(0.06);
    }
  });
});
