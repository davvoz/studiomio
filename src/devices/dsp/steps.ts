/* Dove si trova uno step sequencer: dato quanti step sono passati dall'inizio del pattern, quale
 * step suona e quanto ne è passato, con lo swing (gli step dispari partono in ritardo e quelli
 * pari si allungano altrettanto: a 2/3 è una terzina). La posizione la dà un LfoClock con un
 * giro lungo quanto il pattern, così gli step cadono sulla battuta. Puro: niente Web Audio. */

/** Lo swing più forte: gli step dispari partono mezzo step dopo. */
const MAX_SWING_DELAY = 0.5;

export class StepPosition {
  /** Lo step che suona (0..length−1). */
  index = 0;
  /** Quanto ne è passato, da 0 (l'inizio) a 1 (la fine). */
  t = 0;

  /** `pos` in step dall'inizio del pattern (0..length), `swing` 0..1. */
  locate(pos: number, length: number, swing: number): void {
    const pair = Math.floor(pos / 2) * 2, u = pos - pair;
    // l'ultimo step di un pattern dispari non ha il compagno: niente swing
    if (pair + 1 >= length) {
      this.index = Math.min(length - 1, pair);
      this.t = Math.min(1, u);
      return;
    }
    const split = 1 + swing * MAX_SWING_DELAY;
    if (u < split) {
      this.index = pair;
      this.t = u / split;
    } else {
      this.index = pair + 1;
      this.t = (u - split) / (2 - split);
    }
  }
}
