/** Tempi dell'inviluppo in secondi, sustain 0..1. */
export interface AdsrTimes {
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
}

/** Livello sotto cui l'inviluppo si considera finito (−100 dB). */
const FLOOR = 1e-5;
/** Coefficiente per campione di una curva esponenziale che scende di 60 dB in `seconds`. */
export const decayCoef = (seconds: number, sampleRate: number) => Math.exp(Math.log(1e-3) / Math.max(1, seconds * sampleRate));

/** Inviluppo ADSR: attacco lineare, decadimento e rilascio esponenziali. Ogni fase è una
 *  funzione che fa un passo e decide la fase seguente (nessuno switch per campione).
 *  Un nuovo attacco riparte dal livello attuale: rubare una voce non fa click. */
export class Adsr {
  value = 0;
  private attackStep = 1;
  private decayK = 0;
  private releaseK = 0;
  private readonly killK: number;
  private sustain = 1;
  private stage: () => number = this.idle;

  constructor(private readonly sampleRate: number) {
    this.killK = decayCoef(0.005, sampleRate);
  }

  set(t: AdsrTimes): void {
    this.attackStep = 1 / Math.max(1, t.attack * this.sampleRate);
    this.decayK = decayCoef(t.decay, this.sampleRate);
    this.releaseK = decayCoef(t.release, this.sampleRate);
    this.sustain = t.sustain;
  }

  get active(): boolean {
    return this.stage !== this.idle;
  }

  get releasing(): boolean {
    return this.stage === this.releaseStage || this.stage === this.killStage;
  }

  trigger(): void {
    this.stage = this.attack;
  }

  release(): void {
    if (this.active) this.stage = this.releaseStage;
  }

  /** Rilascio in ~5 ms, per fermare subito senza click. */
  kill(): void {
    if (this.active) this.stage = this.killStage;
  }

  next(): number {
    return this.stage();
  }

  private idle(): number {
    return (this.value = 0);
  }

  private attack(): number {
    this.value += this.attackStep;
    if (this.value >= 1) {
      this.value = 1;
      this.stage = this.decayStage;
    }
    return this.value;
  }

  private decayStage(): number {
    this.value = this.sustain + (this.value - this.sustain) * this.decayK;
    if (Math.abs(this.value - this.sustain) < FLOOR) {
      this.value = this.sustain;
      this.stage = this.sustain > FLOOR ? this.hold : this.idle;
    }
    return this.value;
  }

  private hold(): number {
    return (this.value = this.sustain);
  }

  private releaseStage(): number {
    return this.fade(this.releaseK);
  }

  private killStage(): number {
    return this.fade(this.killK);
  }

  private fade(k: number): number {
    this.value *= k;
    if (this.value < FLOOR) this.stage = this.idle;
    return this.value;
  }
}
