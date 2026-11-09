/* Prisma's envelope: attack, hold, decay, sustain and release, with the curve of each
 * stage (see `bend` in shapes.ts). A new attack restarts from the current level (stealing a
 * voice doesn't click) and the times can be changed while it plays: the stage continues at the
 * new speed (so the matrix can move them, e.g. velocity shortening the decay).
 * The curve is computed in steps: a stage's exponential is multiplied by a constant at each
 * sample, instead of recomputing it (the volume envelope runs at full rate). */

export interface EnvShape {
  readonly attack: number;
  readonly hold: number;
  readonly decay: number;
  /** 0…1. */
  readonly sustain: number;
  readonly release: number;
  readonly attackCurve: number;
  readonly decayCurve: number;
  readonly releaseCurve: number;
}

const IDLE = 0, ATTACK = 1, HOLD = 2, DECAY = 3, SUSTAIN = 4, RELEASE = 5, KILL = 6;
/** Below this level the envelope is finished (−100 dB). */
const FLOOR = 1e-5;
/** The fast shutdown (stop, voice stolen in silence) lasts this long. */
const KILL_TIME = 0.005;

export class CurvedEnv {
  value = 0;
  private stage = IDLE;
  /** How far the stage has gone (0…1), and from what level it started. */
  private t = 0;
  private from = 0;
  private attackStep = 1;
  private holdStep = 1;
  private decayStep = 1;
  private releaseStep = 1;
  private readonly killStep: number;
  private sustain = 1;
  private attackCurve = 0;
  private decayCurve = 0;
  private releaseCurve = 0;
  /** The curve of the current stage: e^(k·t), how much a step multiplies it, 1 / (e^k − 1);
   *  `curved` false: the stage is a straight line. */
  private curved = false;
  private e = 1;
  private mul = 1;
  private inv = 1;

  /** `rate`: how many times per second `next` is called (the samples, or the control rate). */
  constructor(private readonly rate: number) {
    this.killStep = 1 / (KILL_TIME * rate);
  }

  set(e: EnvShape): void {
    const rate = this.rate;
    this.attackStep = 1 / Math.max(1, e.attack * rate);
    this.holdStep = 1 / Math.max(1, e.hold * rate);
    this.decayStep = 1 / Math.max(1, e.decay * rate);
    this.releaseStep = 1 / Math.max(1, e.release * rate);
    this.sustain = Math.max(0, Math.min(1, e.sustain));
    this.attackCurve = e.attackCurve;
    this.decayCurve = e.decayCurve;
    this.releaseCurve = e.releaseCurve;
    this.prepare();
  }

  get active(): boolean {
    return this.stage !== IDLE;
  }

  get releasing(): boolean {
    return this.stage === RELEASE || this.stage === KILL;
  }

  trigger(): void {
    this.begin(ATTACK);
  }

  release(): void {
    if (this.active && !this.releasing) this.begin(RELEASE);
  }

  kill(): void {
    if (this.active) this.begin(KILL);
  }

  next(): number {
    switch (this.stage) {
      case ATTACK:
        if ((this.t += this.attackStep) >= 1) {
          this.value = 1;
          this.begin(HOLD);
        } else this.value = this.from + (1 - this.from) * this.shaped();
        break;
      case HOLD:
        if ((this.t += this.holdStep) >= 1) this.begin(DECAY);
        break;
      case DECAY:
        if ((this.t += this.decayStep) >= 1) {
          this.value = this.sustain;
          this.begin(this.sustain > FLOOR ? SUSTAIN : IDLE);
        } else this.value = 1 - (1 - this.sustain) * this.shaped();
        break;
      case SUSTAIN:
        // the sustain can change while the note is held
        this.value = this.sustain;
        if (this.sustain <= FLOOR) this.begin(IDLE);
        break;
      case RELEASE:
      case KILL:
        this.t += this.stage === KILL ? this.killStep : this.releaseStep;
        this.value = this.t >= 1 ? 0 : this.from * (1 - (this.stage === KILL ? this.t : this.shaped()));
        if (this.t >= 1 || this.value < FLOOR) {
          this.value = 0;
          this.stage = IDLE;
        }
        break;
      default:
        this.value = 0;
    }
    return this.value;
  }

  /** How far the stage has gone, bent by its curve (after the step of `t`). */
  private shaped(): number {
    if (!this.curved) return this.t;
    this.e *= this.mul;
    return (this.e - 1) * this.inv;
  }

  private begin(stage: number): void {
    this.stage = stage;
    this.t = 0;
    this.from = this.value;
    this.e = 1;
    this.prepare();
  }

  /** The curve of the current stage, with the current step (and the position `t` it has reached). */
  private prepare(): void {
    let curve = 0, step = 0;
    switch (this.stage) {
      case ATTACK: curve = this.attackCurve; step = this.attackStep; break;
      case DECAY: curve = this.decayCurve; step = this.decayStep; break;
      case RELEASE: curve = this.releaseCurve; step = this.releaseStep; break;
    }
    this.curved = Math.abs(curve) >= 0.5;
    if (!this.curved) return;
    // like `bend`: f(t) = (e^(k·t) − 1) / (e^k − 1)
    const k = -curve * 0.08;
    this.inv = 1 / Math.expm1(k);
    this.mul = Math.exp(k * step);
    this.e = Math.exp(k * this.t);
  }
}
