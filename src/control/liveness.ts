/* Il controller risponde ancora? Un controller MIDI può smettere di parlare senza che il
 * browser se ne accorga: la porta risulta aperta ma non arriva più niente. Dopo un po' di
 * silenzio gli si chiede chi è (la richiesta d'identità MIDI standard); se non risponde, è
 * muto. Si decide solo se il controller ha già risposto almeno una volta: uno che la richiesta
 * non la conosce non va scambiato per uno bloccato. Dati e conti puri: il tempo lo dà chi chiama. */

/** Richiesta d'identità (Universal SysEx, a tutti gli apparecchi). */
export const IDENTITY_REQUEST: readonly number[] = [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7];

/** Vero se il messaggio è una risposta d'identità (F0 7E <id> 06 02 …). */
export const isIdentityReply = (data: ArrayLike<number>): boolean =>
  data.length >= 5 && data[0] === 0xf0 && data[1] === 0x7e && data[3] === 0x06 && data[4] === 0x02;

export type LivenessAction = 'ping' | 'silent' | null;

export class Liveness {
  private lastHeard: number;
  private pingAt: number | null = null;
  /** Il controller ha risposto almeno una volta alla richiesta d'identità. */
  private answers = false;
  /** Non ha risposto alla prima richiesta: non la conosce, e non si chiede più. */
  private deaf = false;

  /** Al collegamento chi chiama manda subito la richiesta d'identità: la risposta dice se il
   *  controller la conosce. `answers`: si sa già che la conosce (le porte sono state riaperte). */
  constructor(now: number, answers = false, private readonly quietMs = 5000, private readonly replyMs = 1500) {
    this.lastHeard = now;
    this.pingAt = now;
    this.answers = answers;
  }

  /** È arrivato un messaggio dal controller. */
  heard(now: number, data: ArrayLike<number>): void {
    this.lastHeard = now;
    this.pingAt = null;
    if (isIdentityReply(data)) this.answers = true;
  }

  /** Il controller sa rispondere alla richiesta d'identità: solo allora il silenzio vuol dire qualcosa. */
  get watching(): boolean {
    return this.answers;
  }

  /** Da chiamare spesso: 'ping' = manda la richiesta d'identità, 'silent' = non ha risposto. */
  check(now: number): LivenessAction {
    if (this.deaf) return null;
    if (this.pingAt !== null) {
      if (now - this.pingAt < this.replyMs) return null;
      this.pingAt = null;
      this.lastHeard = now; // si ricomincia a contare il silenzio da qui
      if (!this.answers) this.deaf = true;
      return this.answers ? 'silent' : null;
    }
    if (now - this.lastHeard < this.quietMs) return null;
    this.pingAt = now;
    return 'ping';
  }
}
