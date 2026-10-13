/** Posizioni e durate musicali in quarti (1 = una semiminima). È l'unità di tutto il
 *  modello: i secondi si ricavano dal tempo del progetto solo quando serve suonare. */
export type Beats = number;
export type Seconds = number;

export const MIN_BPM = 20;
export const MAX_BPM = 999;

/** Indicazione di tempo (4/4, 6/8…). */
export class TimeSignature {
  static readonly COMMON = new TimeSignature(4, 4);

  readonly numerator: number;
  readonly denominator: number;

  constructor(numerator: number, denominator: number) {
    if (!Number.isInteger(numerator) || numerator < 1 || numerator > 64) throw new RangeError(`numeratore non valido: ${numerator}`);
    if (![1, 2, 4, 8, 16, 32].includes(denominator)) throw new RangeError(`denominatore non valido: ${denominator}`);
    this.numerator = numerator;
    this.denominator = denominator;
  }

  /** Quarti in una battuta (6/8 → 3). */
  get beatsPerBar(): Beats {
    return (this.numerator * 4) / this.denominator;
  }

  /** Posizione in formato Live "battuta.tempo.sedicesimo", contando da 1. */
  format(beat: Beats): string {
    const bar = Math.floor(beat / this.beatsPerBar);
    const inBar = beat - bar * this.beatsPerBar;
    const unit = 4 / this.denominator;
    const b = Math.floor(inBar / unit + 1e-9);
    const six = Math.floor((inBar - b * unit) * 4 + 1e-9);
    return `${bar + 1}.${b + 1}.${six + 1}`;
  }

  equals(o: TimeSignature): boolean {
    return o.numerator === this.numerator && o.denominator === this.denominator;
  }

  toString(): string {
    return `${this.numerator}/${this.denominator}`;
  }
}

/** Conversione tra battiti e secondi. Oggi il tempo è costante; l'automazione del tempo
 *  sarà un'altra implementazione della stessa interfaccia. */
export interface TempoMap {
  secondsAt(beat: Beats): Seconds;
  beatAt(seconds: Seconds): Beats;
}

export class Tempo implements TempoMap {
  readonly bpm: number;

  constructor(bpm: number) {
    if (!(bpm >= MIN_BPM && bpm <= MAX_BPM)) throw new RangeError(`tempo fuori scala: ${bpm} BPM`);
    this.bpm = bpm;
  }

  secondsAt(beat: Beats): Seconds {
    return (beat * 60) / this.bpm;
  }

  beatAt(seconds: Seconds): Beats {
    return (seconds * this.bpm) / 60;
  }

  equals(o: Tempo): boolean {
    return o.bpm === this.bpm;
  }
}
