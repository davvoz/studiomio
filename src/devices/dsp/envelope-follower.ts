/* An envelope follower: how loud the sound is now (the peak, 0..1 and beyond), with an
 * attack and a release. It moves a parameter with the sound: the Auto Filter's filter opening
 * on the hits. Pure: no Web Audio. */

export class EnvelopeFollower {
  value = 0;
  private attack = 1;
  private release = 1;

  constructor(private readonly sampleRate: number) {}

  /** Attack and release in seconds (the time to go about two thirds of the way). */
  set(attack: number, release: number): void {
    this.attack = 1 - Math.exp(-1 / (Math.max(1e-5, attack) * this.sampleRate));
    this.release = 1 - Math.exp(-1 / (Math.max(1e-5, release) * this.sampleRate));
  }

  /** The level after sample `x` (for stereo: the louder of the two channels). */
  process(x: number): number {
    const a = Math.abs(x), v = this.value;
    const next = v + (a > v ? this.attack : this.release) * (a - v);
    return (this.value = next < 1e-12 ? 0 : next);
  }
}
