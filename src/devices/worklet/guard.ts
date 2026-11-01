/* La rete di sicurezza dei processori. Un campione non finito (NaN, infinito) uscito da un motore
 * non si ferma lì: i filtri, i compressori e i riverberi dopo di lui lo tengono nella loro
 * memoria per sempre, fino al master, e tutto il progetto tace. Per questo ogni processore
 * controlla il suo blocco: se è guasto lo azzera e riavvia il motore. Puro: si prova anche in
 * Node. */

/** Vero se nel buffer c'è un campione non finito (x − x è 0 solo per i numeri finiti). */
export function hasInvalid(buf: Float32Array): boolean {
  for (let i = 0; i < buf.length; i++) if (buf[i] - buf[i] !== 0) return true;
  return false;
}

/** `buf` se è sano, altrimenti la sua copia in `spare` con zero al posto dei campioni non finiti. */
export function cleaned(buf: Float32Array, spare: Float32Array): Float32Array {
  if (!hasInvalid(buf)) return buf;
  for (let i = 0; i < buf.length; i++) spare[i] = buf[i] - buf[i] === 0 ? buf[i] : 0;
  return spare.subarray(0, buf.length);
}

/** Quando riavviare un motore guasto: subito la prima volta, poi al massimo una volta ogni
 *  `pause` secondi (un motore che si guasta di continuo intanto tace, invece di essere ricreato
 *  a ogni blocco); ogni riavvio si segnala. */
export class FaultGate {
  private next = -Infinity;

  constructor(private readonly pause = 1) {}

  /** Vero se al secondo `now` si può riavviare. */
  restart(now: number): boolean {
    if (now < this.next) return false;
    this.next = now + this.pause;
    return true;
  }
}
