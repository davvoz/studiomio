/* L'inviluppo di Prisma: attacco, hold, decadimento, sustain e rilascio, con la curva di ogni
 * tratto (vedi `bend` in shapes.ts). Un nuovo attacco riparte dal livello attuale (rubare una
 * voce non fa click) e i tempi si possono cambiare mentre suona: il tratto prosegue con la
 * velocità nuova (così la matrice può muoverli, es. la velocity che accorcia il decay).
 * La curva si calcola a passi: l'esponenziale di un tratto si moltiplica per una costante a ogni
 * campione, invece di ricalcolarla (l'inviluppo del volume va a frequenza piena). */

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
/** Sotto questo livello l'inviluppo è finito (−100 dB). */
const FLOOR = 1e-5;
/** Lo spegnimento veloce (stop, voce rubata in silenzio) dura così. */
const KILL_TIME = 0.005;

export class CurvedEnv {
  value = 0;
  private stage = IDLE;
  /** Quanto è andato avanti il tratto (0…1), e da che livello è partito. */
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
  /** La curva del tratto in corso: e^(k·t), quanto la moltiplica un passo, 1 / (e^k − 1);
   *  `curved` falso: il tratto è una retta. */
  private curved = false;
  private e = 1;
  private mul = 1;
  private inv = 1;

  /** `rate`: quante volte al secondo si chiama `next` (i campioni, o la frequenza di controllo). */
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
        // il sustain può cambiare mentre si tiene la nota
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

  /** Quanto è andato avanti il tratto, piegato dalla sua curva (dopo il passo di `t`). */
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

  /** La curva del tratto in corso, con il passo attuale (e la posizione `t` a cui è arrivato). */
  private prepare(): void {
    let curve = 0, step = 0;
    switch (this.stage) {
      case ATTACK: curve = this.attackCurve; step = this.attackStep; break;
      case DECAY: curve = this.decayCurve; step = this.decayStep; break;
      case RELEASE: curve = this.releaseCurve; step = this.releaseStep; break;
    }
    this.curved = Math.abs(curve) >= 0.5;
    if (!this.curved) return;
    // come `bend`: f(t) = (e^(k·t) − 1) / (e^k − 1)
    const k = -curve * 0.08;
    this.inv = 1 / Math.expm1(k);
    this.mul = Math.exp(k * step);
    this.e = Math.exp(k * this.t);
  }
}
