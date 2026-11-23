/* The Spectral Resonator's tables, one value per bin of the spectrum: how much of the input enters
 * the resonance on each side (the bins near a partial; the others nothing), how much of the
 * resonance stays after a step (the partial's decay) and by how much its phase turns in a step (the
 * partial's exact frequency, so a ringing partial is a clean tone even between two bins). Rebuilt
 * when the knobs change or the partials move. No objects created: it runs in the AudioWorklet. */
import { eachPartial, type PartialMoves, type ResonatorSettings, type Voice } from './partials';

/** Bins on each side of a partial that take part in it (the Hann window's main lobe). */
const LOBE = 2;
/** A bin with no partial: what was ringing there fades in this many seconds (no click when a partial moves away). */
const RELEASE = 0.05;
/** How much of the volume lost to the bins that don't ring is given back: 0 none, 0.5 all of
 *  it for a noise (then a single partial would come out tens of dB louder). A little: the presets
 *  set the rest with their Input. */
const MAKEUP = 0.1;

export class ResonanceBank {
  /** Per bin: how much of the input belongs to the resonance, left and right (0: none). */
  readonly inLeft: Float64Array;
  readonly inRight: Float64Array;
  /** Per bin: how much of that enters at every step, so that a noise or a hit keeps its energy
   *  however long the decay. */
  readonly enter: Float64Array;
  /** Per bin: how much of the resonance stays after a step. */
  readonly keep: Float64Array;
  /** Per bin: the step's turn of the phase, as cosine and sine. */
  readonly turnCos: Float64Array;
  readonly turnSin: Float64Array;
  /** Per bin: the strongest partial's weight there, its frequency and decay (while building). */
  private readonly weight: Float64Array;
  private readonly hz: Float64Array;
  private readonly decay: Float64Array;
  private size = 0;
  private sampleRate = 48000;
  /** The gain giving back part of the volume of the bins that don't ring (see MAKEUP). */
  makeup = 1;

  constructor(maxSize: number) {
    const bins = maxSize / 2 + 1;
    this.inLeft = new Float64Array(bins);
    this.inRight = new Float64Array(bins);
    this.enter = new Float64Array(bins);
    this.keep = new Float64Array(bins);
    this.turnCos = new Float64Array(bins);
    this.turnSin = new Float64Array(bins);
    this.weight = new Float64Array(bins);
    this.hz = new Float64Array(bins);
    this.decay = new Float64Array(bins);
  }

  /** The tables for a spectrum of `size` points, moved on by `hop` samples at every step. */
  build(size: number, hop: number, sampleRate: number, s: ResonatorSettings, voices: readonly Voice[], moves: PartialMoves): void {
    this.size = size;
    this.sampleRate = sampleRate;
    const bins = size / 2 + 1;
    for (let b = 0; b < bins; b++) {
      this.weight[b] = 0;
      this.inLeft[b] = 0;
      this.inRight[b] = 0;
      this.hz[b] = (b * sampleRate) / size;
      this.decay[b] = RELEASE;
    }
    eachPartial(s, voices, sampleRate * 0.45, moves, this.place);
    let open = 0;
    for (let b = 0; b < bins; b++) {
      // Decay is the time to fall by 60 dB
      const keep = Math.pow(10, (-3 * hop) / (sampleRate * Math.max(1e-3, this.decay[b])));
      this.keep[b] = keep;
      this.enter[b] = Math.sqrt(1 - keep * keep);
      open += (this.inLeft[b] ** 2 + this.inRight[b] ** 2) / 2;
      const turn = (2 * Math.PI * this.hz[b] * hop) / sampleRate;
      this.turnCos[b] = Math.cos(turn);
      this.turnSin[b] = Math.sin(turn);
    }
    this.makeup = open > 0 ? Math.min(Math.pow(bins / open, MAKEUP), 8) : 1;
  }

  /** A partial takes the bins around it where it's the strongest. */
  private readonly place = (hz: number, left: number, right: number, decay: number): void => {
    const at = (hz * this.size) / this.sampleRate, last = this.size / 2 - 1;
    for (let b = Math.max(1, Math.ceil(at - LOBE)); b <= Math.min(last, Math.floor(at + LOBE)); b++) {
      const w = 0.5 + 0.5 * Math.cos((Math.PI * (b - at)) / LOBE);
      const strength = w * Math.max(left, right);
      if (strength <= this.weight[b]) continue;
      this.weight[b] = strength;
      this.inLeft[b] = w * left;
      this.inRight[b] = w * right;
      this.hz[b] = hz;
      this.decay[b] = decay;
    }
  };
}
