/* Il suono del Reverse. L'ingresso va sempre sul nastro; a `u` campioni dall'inizio di un pezzo
 * la testina legge `2u` campioni indietro, quindi va all'indietro: all'inizio del pezzo legge il
 * suono appena passato, alla fine l'inizio del pezzo prima. A ogni pezzo nuovo (e a ogni salto
 * del trasporto) la testina torna avanti sfumando. I pezzi cadono sulla battuta, da fermo
 * girano liberi al tempo del progetto. Gira nell'AudioWorklet; qui niente Web Audio. */
import type { EffectCore, TransportFollower, TransportPosition } from '../../dsp/core';
import { LfoClock } from '../../dsp/lfo';
import { TapeBuffer, TapeReader } from '../../dsp/tape-buffer';
import { MIN_BPM } from '../../../core/music-time';
import { MAX_REVERSE_BEATS, REVERSE_LENGTHS } from './reverse';

/** La sfumatura tra un pezzo e l'altro e all'accensione, in secondi. */
const FADE = 0.005;

export class ReverseCore implements EffectCore, TransportFollower {
  private readonly tape: TapeBuffer;
  private readonly reader: TapeReader;
  private readonly clock: LfoClock;
  private readonly wet = new Float32Array(2);
  private readonly fadeStep: number;
  private transport: TransportPosition | null = null;
  private bpm = 120;
  /** Quanto si sente il suono al contrario (0..1), e quanto si vorrebbe. */
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
    // il nastro deve ricordare due pezzi (si cambia solo con un tempo o un pezzo nuovi)
    tape.ensure(2 * slice + 4 * FADE * this.sampleRate + (60 * this.sampleRate) / Math.max(MIN_BPM, bpm));
    clock.start({ beats, hz: 0 }, pos, this.bpm);
    const target = this.on ? 1 : 0, mix = this.mix;
    let a = this.amount;
    for (let i = 0; i < n; i++) {
      const xL = inL[i], xR = inR[i];
      tape.write(xL, xR);
      const cycles = clock.cycles, u = (cycles - Math.floor(cycles)) * slice;
      const head = tape.written - 1 - 2 * u;
      // la testina va indietro di un campione alla volta: se non è lì, è un pezzo nuovo o un salto
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
