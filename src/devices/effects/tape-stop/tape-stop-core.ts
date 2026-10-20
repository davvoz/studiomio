/* Il suono del Tape Stop. L'ingresso va sempre sul nastro e una testina lo rilegge: dal vivo
 * legge l'ultimo campione (il suono passa com'è); in frenata va sempre più piano, quindi il
 * suono scende di pitch e resta indietro, e sotto una certa velocità sfuma fino al silenzio;
 * da fermo tace. Alla ripartenza accelera da fermo sul suono di adesso e alla fine torna al vivo
 * con una sfumatura (è rimasta un po' indietro). Gira nell'AudioWorklet; qui niente Web Audio. */
import type { EffectCore, TransportFollower, TransportPosition } from '../../dsp/core';
import { TapeBuffer, TapeReader } from '../../dsp/tape-buffer';
import { MIN_BPM } from '../../../core/music-time';
import { BRAKE_CURVE, BRAKE_DIVISIONS, MAX_BRAKE_MS, MAX_SPIN_MS, STARTS, TAPE_SYNC } from './tape-stop';

/** Le sfumature dei salti della testina, in secondi; più lunga quella del ritorno al vivo. */
const FADE = 0.005, BACK_TO_LIVE = 0.02;
/** Sotto questa velocità il suono sfuma: un nastro quasi fermo non si sente più. */
const SILENT_SPEED = 0.12;
const EPS = 1e-9;

const STATE = { live: 0, waiting: 1, brake: 2, stopped: 3, spin: 4 } as const;
type State = (typeof STATE)[keyof typeof STATE];

/** La velocità a `x` (0..1) della frenata partita da `v0`. */
const CURVES: readonly ((v0: number, x: number) => number)[] = [
  (v0, x) => v0 * (1 - x),
  (v0, x) => v0 * (0.5 + 0.5 * Math.cos(Math.PI * x)),
  (v0, x) => v0 * (1 - x) * (1 - x),
];

export class TapeStopCore implements EffectCore, TransportFollower {
  private readonly tape: TapeBuffer;
  private readonly reader: TapeReader;
  private readonly out = new Float32Array(2);
  private readonly backToLive: number;
  private transport: TransportPosition | null = null;
  private bpm = 120;
  private state: State = STATE.live;
  /** La velocità della testina (1 = dal vivo) e la frenata o ripartenza in corso. */
  private speed = 1;
  private from = 1;
  private t = 0;
  private length = 1;
  private lastLine = 0;
  /** Dopo il silenzio il suono torna salendo: quanto è già salito (0..1) e di quanto a campione. */
  private rise = 1;
  private readonly riseStep: number;

  private stop = false;
  private startBeats = 0;
  private sync: number = TAPE_SYNC.tempo;
  private brakeBeats = 2;
  private brakeMs = 500;
  private curve: number = BRAKE_CURVE.linear;
  private spinMs = 0;

  constructor(private readonly sampleRate: number) {
    this.tape = new TapeBuffer(sampleRate);
    this.reader = new TapeReader(Math.round(FADE * sampleRate));
    this.backToLive = Math.round(BACK_TO_LIVE * sampleRate);
    this.riseStep = 1 / (FADE * sampleRate);
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    this.stop = v('stop', 0) === 1;
    this.startBeats = (STARTS[v('start', 0)] ?? STARTS[0])[1];
    this.sync = v('sync', TAPE_SYNC.tempo);
    this.brakeBeats = (BRAKE_DIVISIONS[v('division', 3)] ?? BRAKE_DIVISIONS[3])[1];
    this.brakeMs = Math.min(MAX_BRAKE_MS, v('time', 500));
    this.curve = v('curve', BRAKE_CURVE.linear);
    this.spinMs = Math.min(MAX_SPIN_MS, v('spin', 0));
    this.fitTape();
  }

  setTempo(bpm: number): void {
    if (bpm > 0) this.bpm = bpm;
    this.fitTape();
  }

  setTransport(position: TransportPosition | null): void {
    this.transport = position;
  }

  /** La velocità della testina adesso (1 = dal vivo, 0 = ferma). */
  get headSpeed(): number {
    return this.state === STATE.stopped ? 0 : this.speed;
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const { tape, reader, out } = this, pos = this.transport;
    const bps = pos ? pos.bpm / 60 / this.sampleRate : 0;
    // dal vivo la testina è sull'ultimo campione (anche dopo un bypass, quando il nastro è fermo)
    if (this.state === STATE.live && !reader.fading) reader.pos = tape.written;
    if (this.stop && (this.state === STATE.live || this.state === STATE.spin)) {
      if (this.startBeats > 0 && pos) {
        this.state = STATE.waiting;
        this.lastLine = Math.floor((pos.beat - bps) / this.startBeats + EPS);
      } else this.brake();
    } else if (!this.stop) {
      if (this.state === STATE.waiting) this.state = STATE.live;
      else if (this.state === STATE.brake || this.state === STATE.stopped) this.release();
    }
    for (let i = 0; i < n; i++) {
      if (this.state === STATE.waiting) {
        const line = pos ? Math.floor((pos.beat + i * bps) / this.startBeats + EPS) : Infinity;
        if (line > this.lastLine) this.brake();
        else this.lastLine = line;
      }
      tape.write(inL[i], inR[i]);
      let gain = 1;
      switch (this.state) {
        case STATE.brake: {
          this.speed = (CURVES[this.curve] ?? CURVES[0])(this.from, this.t / this.length);
          if (++this.t >= this.length) this.state = STATE.stopped;
          gain = Math.min(1, this.speed / SILENT_SPEED);
          break;
        }
        case STATE.spin: {
          this.speed = this.from + ((1 - this.from) * this.t) / this.length;
          gain = Math.min(1, this.speed / SILENT_SPEED);
          if (++this.t >= this.length) {
            // è rimasta indietro: torna al vivo sfumando (dal prossimo campione)
            reader.read(tape, this.speed, out);
            reader.jump(tape.written, 1, this.backToLive);
            this.state = STATE.live;
            this.speed = 1;
            outL[i] = out[0] * gain;
            outR[i] = out[1] * gain;
            continue;
          }
          break;
        }
        case STATE.stopped:
          this.speed = 0;
          gain = 0;
          break;
        default:
          this.speed = 1;
      }
      if (this.rise < 1) gain *= (this.rise = Math.min(1, this.rise + this.riseStep));
      if (gain === 0) {
        outL[i] = outR[i] = 0;
        continue;
      }
      reader.read(tape, this.speed, out);
      outL[i] = out[0] * gain;
      outR[i] = out[1] * gain;
    }
  }

  /** Comincia a frenare da questo campione, dalla velocità che ha. */
  private brake(): void {
    this.state = STATE.brake;
    this.from = this.speed;
    this.t = 0;
    this.length = Math.max(1, Math.round(this.brakeSeconds() * this.sampleRate));
  }

  /** Stop spento: riparte dal suono di adesso (accelerando, se c'è la ripartenza). */
  private release(): void {
    const spin = Math.round((this.spinMs / 1000) * this.sampleRate);
    const speed = this.state === STATE.stopped ? 0 : this.speed;
    // il prossimo campione registrato sarà a `written`: è lì il suono di adesso; da fermo
    // taceva, quindi non c'è niente da sfumare (la testina ferma darebbe un gradino)
    if (this.state === STATE.stopped) {
      this.reader.pos = this.tape.written;
      this.rise = 0;
    } else this.reader.jump(this.tape.written, speed);
    if (spin <= 0) {
      this.state = STATE.live;
      this.speed = 1;
      return;
    }
    // riaccelera dalla velocità che aveva (da fermo, da zero)
    this.state = STATE.spin;
    this.from = speed;
    this.speed = speed;
    this.t = 0;
    this.length = spin;
  }

  private brakeSeconds(): number {
    if (this.sync === TAPE_SYNC.ms) return this.brakeMs / 1000;
    const bpm = this.transport?.bpm ?? this.bpm;
    return (this.brakeBeats * 60) / bpm;
  }

  /** Il nastro deve ricordare tutta la frenata più lunga possibile con il tempo di adesso. */
  private fitTape(): void {
    const brake = this.sync === TAPE_SYNC.ms ? this.brakeMs / 1000 : (this.brakeBeats * 60) / Math.max(MIN_BPM, this.bpm);
    this.tape.ensure((brake + this.spinMs / 1000 + 4 * BACK_TO_LIVE) * this.sampleRate);
  }
}
