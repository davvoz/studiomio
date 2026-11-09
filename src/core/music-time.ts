/** Musical positions and durations in quarters (1 = a quarter note). It's the unit of the whole
 *  model: seconds are derived from the project's tempo only when it's time to play. */
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
    if (!Number.isInteger(numerator) || numerator < 1 || numerator > 64) throw new RangeError(`invalid numerator: ${numerator}`);
    if (![1, 2, 4, 8, 16, 32].includes(denominator)) throw new RangeError(`invalid denominator: ${denominator}`);
    this.numerator = numerator;
    this.denominator = denominator;
  }

  /** Quarters in a bar (6/8 → 3). */
  get beatsPerBar(): Beats {
    return (this.numerator * 4) / this.denominator;
  }

  /** Position in Live's "bar.beat.sixteenth" format, counting from 1. */
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

/** Conversion between beats and seconds. Today the tempo is constant; tempo automation
 *  will be another implementation of the same interface. */
export interface TempoMap {
  secondsAt(beat: Beats): Seconds;
  beatAt(seconds: Seconds): Beats;
}

export class Tempo implements TempoMap {
  readonly bpm: number;

  constructor(bpm: number) {
    if (!(bpm >= MIN_BPM && bpm <= MAX_BPM)) throw new RangeError(`tempo out of range: ${bpm} BPM`);
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
