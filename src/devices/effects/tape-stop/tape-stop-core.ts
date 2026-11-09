/* The Tape Stop's sound. The input always goes onto the tape and a head reads it back: live
 * it reads the last sample (the sound passes as it is); while braking it goes slower and slower, so the
 * sound drops in pitch and falls behind, and below a certain speed it fades to silence;
 * when stopped it's silent. On restart it speeds up from standstill on the sound of now and at the end returns to live
 * with a fade (it has fallen a little behind). Runs in the AudioWorklet; no Web Audio here. */
import type { EffectCore, TransportFollower, TransportPosition } from '../../dsp/core';
import { TapeBuffer, TapeReader } from '../../dsp/tape-buffer';
import { MIN_BPM } from '../../../core/music-time';
import { BRAKE_CURVE, BRAKE_DIVISIONS, MAX_BRAKE_MS, MAX_SPIN_MS, STARTS, TAPE_SYNC } from './tape-stop';

/** The fades of the head's jumps, in seconds; longer the one back to live. */
const FADE = 0.005, BACK_TO_LIVE = 0.02;
/** Below this speed the sound fades: an almost stopped tape can't be heard any more. */
const SILENT_SPEED = 0.12;
const EPS = 1e-9;

const STATE = { live: 0, waiting: 1, brake: 2, stopped: 3, spin: 4 } as const;
type State = (typeof STATE)[keyof typeof STATE];

/** The speed at `x` (0..1) of the braking started from `v0`. */
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
  /** The head's speed (1 = live) and the braking or restart in progress. */
  private speed = 1;
  private from = 1;
  private t = 0;
  private length = 1;
  private lastLine = 0;
  /** After the silence the sound comes back rising: how much it has risen already (0..1) and by how much per sample. */
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

  /** The head's speed now (1 = live, 0 = stopped). */
  get headSpeed(): number {
    return this.state === STATE.stopped ? 0 : this.speed;
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const { tape, reader, out } = this, pos = this.transport;
    const bps = pos ? pos.bpm / 60 / this.sampleRate : 0;
    // live the head is on the last sample (also after a bypass, when the tape is still)
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
            // it fell behind: back to live with a fade (from the next sample)
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

  /** Starts braking from this sample, from the speed it has. */
  private brake(): void {
    this.state = STATE.brake;
    this.from = this.speed;
    this.t = 0;
    this.length = Math.max(1, Math.round(this.brakeSeconds() * this.sampleRate));
  }

  /** Stop off: restarts from the sound of now (speeding up, if there's a restart). */
  private release(): void {
    const spin = Math.round((this.spinMs / 1000) * this.sampleRate);
    const speed = this.state === STATE.stopped ? 0 : this.speed;
    // the next recorded sample will be at `written`: that's where the sound of now is; when stopped
    // it was silent, so there's nothing to fade (the still head would give a step)
    if (this.state === STATE.stopped) {
      this.reader.pos = this.tape.written;
      this.rise = 0;
    } else this.reader.jump(this.tape.written, speed);
    if (spin <= 0) {
      this.state = STATE.live;
      this.speed = 1;
      return;
    }
    // speeds up again from the speed it had (from standstill, from zero)
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

  /** The tape must remember the whole longest possible braking at the current tempo. */
  private fitTape(): void {
    const brake = this.sync === TAPE_SYNC.ms ? this.brakeMs / 1000 : (this.brakeBeats * 60) / Math.max(MIN_BPM, this.bpm);
    this.tape.ensure((brake + this.spinMs / 1000 + 4 * BACK_TO_LIVE) * this.sampleRate);
  }
}
