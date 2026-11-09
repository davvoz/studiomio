/* Is the controller still responding? A MIDI controller can stop talking without the
 * browser noticing: the port looks open but nothing arrives any more. After a while of
 * silence it's asked who it is (the standard MIDI identity request); if it doesn't answer, it's
 * silent. We decide only if the controller has already answered at least once: one that doesn't
 * know the request mustn't be mistaken for a hung one. Pure data and maths: the caller gives the time. */

/** Identity request (Universal SysEx, to all devices). */
export const IDENTITY_REQUEST: readonly number[] = [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7];

/** True if the message is an identity reply (F0 7E <id> 06 02 …). */
export const isIdentityReply = (data: ArrayLike<number>): boolean =>
  data.length >= 5 && data[0] === 0xf0 && data[1] === 0x7e && data[3] === 0x06 && data[4] === 0x02;

export type LivenessAction = 'ping' | 'silent' | null;

export class Liveness {
  private lastHeard: number;
  private pingAt: number | null = null;
  /** The controller has answered the identity request at least once. */
  private answers = false;
  /** It didn't answer the first request: it doesn't know it, and it's not asked again. */
  private deaf = false;

  /** On connection the caller sends the identity request right away: the reply says whether the
   *  controller knows it. `answers`: it's already known that it does (the ports were reopened). */
  constructor(now: number, answers = false, private readonly quietMs = 5000, private readonly replyMs = 1500) {
    this.lastHeard = now;
    this.pingAt = now;
    this.answers = answers;
  }

  /** A message arrived from the controller. */
  heard(now: number, data: ArrayLike<number>): void {
    this.lastHeard = now;
    this.pingAt = null;
    if (isIdentityReply(data)) this.answers = true;
  }

  /** The controller can answer the identity request: only then does silence mean something. */
  get watching(): boolean {
    return this.answers;
  }

  /** To be called often: 'ping' = send the identity request, 'silent' = it didn't answer. */
  check(now: number): LivenessAction {
    if (this.deaf) return null;
    if (this.pingAt !== null) {
      if (now - this.pingAt < this.replyMs) return null;
      this.pingAt = null;
      this.lastHeard = now; // silence is counted again from here
      if (!this.answers) this.deaf = true;
      return this.answers ? 'silent' : null;
    }
    if (now - this.lastHeard < this.quietMs) return null;
    this.pingAt = now;
    return 'ping';
  }
}
