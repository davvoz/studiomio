/* Prisma's filter, stereo (the two channels with the same coefficients): low-pass at 12 and
 * 24 dB, the saturated ladder, high-pass, band-pass, notch, peak, the combs (positive and
 * negative), the formant (the vowels) and the phaser. The drive saturates the sound before the filter,
 * the mix blends it back with the dry. The coefficients are computed at the control
 * rate (`set`), the sound sample by sample (`process`, in place). */
import { clamp01 } from '../../../core/math';
import { FILTER } from './prisma';

/** The vowels A E I O U: three formants (Hz) and their levels. */
const VOWELS: readonly (readonly [number, number, number])[] = [
  [780, 1150, 2800], [420, 1650, 2650], [290, 2050, 2950], [460, 820, 2800], [330, 700, 2500],
];
const VOWEL_GAINS = [1, 0.6, 0.25];
/** The combs' longest delay: a period at 20 Hz (at the highest sample rate). */
const COMB_SIZE = 1 << 13;
const PHASER_STAGES = 4;

/** A state-variable filter (TPT), one channel: gives low-pass, band-pass and high-pass. */
class SvfState {
  ic1 = 0;
  ic2 = 0;
  low = 0;
  band = 0;
  high = 0;

  tick(c: SvfCoefs, v0: number): void {
    const v3 = v0 - this.ic2;
    const v1 = c.a1 * this.ic1 + c.a2 * v3;
    const v2 = this.ic2 + c.a2 * this.ic1 + c.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
    this.high = v0 - c.k * v1 - v2;
  }

  reset(): void {
    this.ic1 = this.ic2 = this.low = this.band = this.high = 0;
  }
}

class SvfCoefs {
  a1 = 1;
  a2 = 0;
  a3 = 0;
  k = 2;

  set(g: number, k: number): void {
    this.k = k;
    this.a1 = 1 / (1 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
}

/** A channel of the filter: all the states the various types need. */
class Channel {
  readonly s1 = new SvfState();
  readonly s2 = new SvfState();
  readonly formants = [new SvfState(), new SvfState(), new SvfState()];
  /** The ladder's stages (one-pole TPT low-pass). */
  readonly ladder = new Float64Array(4);
  readonly allpass = new Float64Array(PHASER_STAGES);
  phaserFeedback = 0;
  comb: Float32Array | null = null;
  combAt = 0;
  combDamp = 0;

  reset(): void {
    this.s1.reset();
    this.s2.reset();
    for (const f of this.formants) f.reset();
    this.ladder.fill(0);
    this.allpass.fill(0);
    this.phaserFeedback = 0;
    this.comb?.fill(0);
    this.combDamp = 0;
  }
}


export class PrismaFilter {
  private type: number = FILTER.lp12;
  private readonly c1 = new SvfCoefs();
  private readonly c2 = new SvfCoefs();
  private readonly cf = [new SvfCoefs(), new SvfCoefs(), new SvfCoefs()];
  private readonly left = new Channel();
  private readonly right = new Channel();
  /** Ladder: the gain of one pole and the feedback. */
  private ladderG = 0;
  private ladderK = 0;
  private res = 0;
  private drive = 0;
  private driveGain = 1;
  private mix = 1;
  /** Comb: delay in samples, feedback (with sign), damping. */
  private combDelay = 1;
  private combFeedback = 0;
  private combDampK = 0;
  /** Phaser: the coefficients of the allpass stages. */
  private readonly allpassA = new Float64Array(PHASER_STAGES);
  private phaserFeedback = 0;

  constructor(private readonly sampleRate: number) {}

  /** `res`, `drive`, `variation`, `mix` in 0…1. */
  set(type: number, cutoff: number, res: number, drive: number, variation: number, mix: number): void {
    const sr = this.sampleRate;
    if (type !== this.type) {
      this.type = type;
      this.reset();
    }
    const fc = Math.max(10, Math.min(cutoff, sr * 0.45));
    const g = Math.tan((Math.PI * fc) / sr);
    this.res = res = clamp01(res);
    this.drive = drive = clamp01(drive);
    this.driveGain = 1 + drive * drive * 15;
    this.mix = clamp01(mix);
    switch (type) {
      case FILTER.lp24: case FILTER.hp24: case FILTER.bp24:
        // two stages like a fourth-order Butterworth: all the resonance on the second
        this.c1.set(g, 1.848);
        this.c2.set(g, 0.765 * (1 - 0.97 * res));
        break;
      case FILTER.ladder:
        this.ladderG = g / (1 + g);
        this.ladderK = 4.1 * res;
        break;
      case FILTER.combUp: case FILTER.combDown: {
        this.combDelay = Math.max(2, Math.min(COMB_SIZE - 2, sr / Math.max(20, cutoff)));
        this.combFeedback = (type === FILTER.combUp ? 1 : -1) * 0.95 * res;
        // Var damps the highs in the feedback: at 0 the comb is open, at 100 dark
        this.combDampK = variation * 0.9;
        break;
      }
      case FILTER.formant: {
        // Var chooses the vowel, the cutoff moves the formants (1 kHz: in their place)
        const x = clamp01(variation) * (VOWELS.length - 1), i = Math.min(VOWELS.length - 2, Math.floor(x)), f = x - i;
        const shift = Math.max(0.25, Math.min(4, Math.sqrt(cutoff / 1000)));
        for (let j = 0; j < 3; j++) {
          const hz = Math.min(sr * 0.45, (VOWELS[i][j] + (VOWELS[i + 1][j] - VOWELS[i][j]) * f) * shift);
          this.cf[j].set(Math.tan((Math.PI * hz) / sr), 0.35 - 0.3 * res);
        }
        break;
      }
      case FILTER.phaser: {
        // the stages spread around the cutoff (Var widens them), the resonance as feedback
        for (let j = 0; j < PHASER_STAGES; j++) {
          const spread = Math.pow(2, (j - (PHASER_STAGES - 1) / 2) * variation * 1.5);
          const t = Math.tan((Math.PI * Math.min(sr * 0.45, fc * spread)) / sr);
          this.allpassA[j] = (t - 1) / (t + 1);
        }
        this.phaserFeedback = 0.9 * res;
        break;
      }
      default:
        this.c1.set(g, 2 - 1.96 * res);
    }
  }

  reset(): void {
    this.left.reset();
    this.right.reset();
  }

  /** Filters `n` samples of the two channels, in place. */
  process(l: Float64Array, r: Float64Array, n: number): void {
    this.channel(this.left, l, n);
    this.channel(this.right, r, n);
  }

  private channel(ch: Channel, buf: Float64Array, n: number): void {
    const { type, mix, drive, driveGain } = this;
    // the drive raises the sound into the saturation; the ceiling drops a bit, so it doesn't explode in volume
    const ceiling = 1 / Math.sqrt(Math.sqrt(driveGain));
    for (let i = 0; i < n; i++) {
      const dry = buf[i];
      const x = drive > 0 ? Math.tanh(dry * driveGain) * ceiling : dry;
      const wet = this.tick(ch, type, x);
      buf[i] = dry + (wet - dry) * mix;
    }
  }

  private tick(ch: Channel, type: number, x: number): number {
    const { c1, c2 } = this;
    switch (type) {
      case FILTER.lp12: ch.s1.tick(c1, x); return ch.s1.low;
      case FILTER.hp12: ch.s1.tick(c1, x); return ch.s1.high;
      case FILTER.bp12: ch.s1.tick(c1, x); return ch.s1.band * c1.k;
      case FILTER.notch: ch.s1.tick(c1, x); return ch.s1.low + ch.s1.high;
      case FILTER.peak: ch.s1.tick(c1, x); return x + 3 * this.res * c1.k * ch.s1.band;
      case FILTER.lp24: ch.s1.tick(c1, x); ch.s2.tick(c2, ch.s1.low); return ch.s2.low;
      case FILTER.hp24: ch.s1.tick(c1, x); ch.s2.tick(c2, ch.s1.high); return ch.s2.high;
      case FILTER.bp24: ch.s1.tick(c1, x); ch.s2.tick(c2, ch.s1.band * c1.k); return ch.s2.band * c2.k;
      case FILTER.ladder: return this.ladder(ch, x);
      case FILTER.combUp: case FILTER.combDown: return this.comb(ch, x);
      case FILTER.formant: {
        let y = 0;
        for (let j = 0; j < 3; j++) {
          ch.formants[j].tick(this.cf[j], x);
          y += ch.formants[j].band * this.cf[j].k * VOWEL_GAINS[j];
        }
        return y * 1.6;
      }
      case FILTER.phaser: {
        let y = x + ch.phaserFeedback * this.phaserFeedback;
        for (let j = 0; j < PHASER_STAGES; j++) {
          // first-order allpass: y = a·x + s, s = x − a·y
          const a = this.allpassA[j], out = a * y + ch.allpass[j];
          ch.allpass[j] = y - a * out;
          y = out;
        }
        ch.phaserFeedback = y;
        return (x + y) * 0.5;
      }
      default: return x;
    }
  }

  /** Four TPT poles in a row with the feedback solved without delay, saturated (Zavalishin). */
  private ladder(ch: Channel, x: number): number {
    const G = this.ladderG, k = this.ladderK, s = ch.ladder;
    // each pole gives y = G·u + (1 − G)·s: the fourth's output is G⁴·u + S, with S from the states
    const b = 1 - G;
    const S = (((G * s[0] + s[1]) * G + s[2]) * G + s[3]) * b;
    const G4 = G * G * G * G;
    // u = x − k·output, solved; a slightly stronger input compensates the lows lost with the resonance
    let u = (x * (1 + k * 0.5) - k * S) / (1 + k * G4);
    u = Math.tanh(u);
    for (let j = 0; j < 4; j++) {
      const v = (u - s[j]) * G;
      const y = v + s[j];
      s[j] = y + v;
      u = y;
    }
    return u;
  }

  private comb(ch: Channel, x: number): number {
    let buf = ch.comb;
    if (!buf) buf = ch.comb = new Float32Array(COMB_SIZE);
    const mask = COMB_SIZE - 1, read = ch.combAt - this.combDelay;
    const i = Math.floor(read), t = read - i;
    const a = buf[i & mask], delayed = a + (buf[(i + 1) & mask] - a) * t;
    ch.combDamp += (delayed - ch.combDamp) * (1 - this.combDampK);
    const y = x + this.combFeedback * ch.combDamp;
    buf[ch.combAt & mask] = y;
    ch.combAt = (ch.combAt + 1) & mask;
    // more feedback, the more the comb resonates: it's lowered so the volume stays similar
    return y * (1 - Math.abs(this.combFeedback) * 0.75);
  }
}
