/* Where a step sequencer is: given how many steps have passed since the start of the pattern, which
 * step plays and how much of it has passed, with swing (the odd steps start late and the
 * even ones lengthen by as much: at 2/3 it's a triplet). The position is given by an LfoClock with a
 * cycle as long as the pattern, so the steps fall on the bar. Pure: no Web Audio. */

/** The strongest swing: the odd steps start half a step later. */
const MAX_SWING_DELAY = 0.5;

export class StepPosition {
  /** The playing step (0..length−1). */
  index = 0;
  /** How much of it has passed, from 0 (the start) to 1 (the end). */
  t = 0;

  /** `pos` in steps from the start of the pattern (0..length), `swing` 0..1. */
  locate(pos: number, length: number, swing: number): void {
    const pair = Math.floor(pos / 2) * 2, u = pos - pair;
    // the last step of an odd pattern has no partner: no swing
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
