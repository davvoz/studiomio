/* The Reverse's sound. The input always goes onto the tape; `u` samples from the start of a piece
 * the head reads `2u` samples back, so it goes backwards: at the start of the piece it reads the
 * sound just passed, at the end the start of the previous piece. At each new piece (and at each transport
 * jump) the head returns forward with a fade. The pieces fall on the bar, when stopped they
 * run free at the project's tempo. Runs in the AudioWorklet; no Web Audio here. */
import type { EffectCore, TransportFollower, TransportPosition } from '../../dsp/core';
import { LfoClock } from '../../dsp/lfo';
import { TapeBuffer, TapeReader } from '../../dsp/tape-buffer';
import { MIN_BPM } from '../../../core/music-time';
import { MAX_REVERSE_BEATS, REVERSE_LENGTHS } from './reverse';

/** The fade between one piece and the next and when switching on, in seconds. */
const FADE = 0.005;

export class ReverseCore implements EffectCore, TransportFollower {
  private readonly tape: TapeBuffer;
  private readonly reader: TapeReader;
  private readonly clock: LfoClock;
  private readonly wet = new Float32Array(2);
  private readonly fadeStep: number;
  private transport: TransportPosition | null = null;
  private bpm = 120;
  /** How much the reversed sound is heard (0..1), and how much is wanted. */
  private amount = 1;
  private fresh = true;
  private on = true;
  private beats = 2;
  private bars = 0;
  private mix = 1;

  constructor(private readonly sampleRate: number) {
    this.tape = new TapeBuffer(sampleRate);
    this.reader = new TapeReader(Math.round(FADE * sampleRate));
    this.clock = new LfoClock(sampleRate);
    this.fadeStep = 1 / (FADE * sampleRate);
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    this.on = v('reverse', 1) === 1;
    const [, beats, bars] = REVERSE_LENGTHS[v('length', 3)] ?? REVERSE_LENGTHS[3];
    this.beats = beats;
    this.bars = bars;
    this.mix = v('mix', 100) / 100;
    if (this.fresh) this.amount = this.on ? 1 : 0;
  }

  setTempo(bpm: number): void {
    if (bpm > 0) this.bpm = bpm;
  }

  setTransport(position: TransportPosition | null): void {
    this.transport = position;
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    this.fresh = false;
    const { tape, reader, clock, wet } = this, pos = this.transport;
    const bpm = pos?.bpm ?? this.bpm;
    const beats = Math.min(MAX_REVERSE_BEATS, this.beats || this.bars * (pos?.beatsPerBar ?? 4));
    const slice = (beats * 60 * this.sampleRate) / bpm;
    // the tape must remember two pieces (it changes only with a new tempo or piece)
    tape.ensure(2 * slice + 4 * FADE * this.sampleRate + (60 * this.sampleRate) / Math.max(MIN_BPM, bpm));
    clock.start({ beats, hz: 0 }, pos, this.bpm);
    const target = this.on ? 1 : 0, mix = this.mix;
    let a = this.amount;
    for (let i = 0; i < n; i++) {
      const xL = inL[i], xR = inR[i];
      tape.write(xL, xR);
      const cycles = clock.cycles, u = (cycles - Math.floor(cycles)) * slice;
      const head = tape.written - 1 - 2 * u;
      // the head goes back one sample at a time: if it isn't there, it's a new piece or a jump
      if (Math.abs(head - reader.pos) > 1.5) reader.jump(head, -1);
      else reader.pos = head;
      reader.read(tape, -1, wet);
      a = target > a ? Math.min(target, a + this.fadeStep) : Math.max(target, a - this.fadeStep);
      const w = a * mix;
      outL[i] = xL * (1 - w) + wet[0] * w;
      outR[i] = xR * (1 - w) + wet[1] * w;
      clock.next();
    }
    this.amount = a;
  }
}
