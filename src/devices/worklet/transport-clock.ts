/* Dove si trova il trasporto, nell'AudioWorklet: per gli effetti che seguono la battuta (Beat
 * Repeat). Il thread principale manda un ancoraggio a ogni partenza, giro di loop, salto o
 * cambio di tempo, con l'istante in cui vale (di solito un attimo nel futuro); da lì la
 * posizione si calcola da sola. Puro: si prova anche in Node. */
import type { TransportPosition } from '../dsp/core';

/** Il battito `beat` della timeline suona all'istante `time` (secondi del contesto audio) e da
 *  lì il trasporto avanza a `bpm`. */
export interface TransportAnchor {
  readonly time: number;
  readonly beat: number;
  readonly bpm: number;
  readonly beatsPerBar: number;
}

export class TransportClock {
  /** In ordine di istante: il primo è quello in vigore (o il prossimo, se nessuno lo è ancora). */
  private anchors: TransportAnchor[] = [];

  /** Un ancoraggio nuovo sostituisce quelli che sarebbero valsi da quell'istante in poi (un salto
   *  annulla il giro di loop già annunciato); null: il trasporto si è fermato, subito. */
  set(anchor: TransportAnchor | null): void {
    if (!anchor) {
      this.anchors = [];
      return;
    }
    this.anchors = [...this.anchors.filter(a => a.time < anchor.time), anchor];
  }

  /** La posizione all'istante `time` (null se fermo, o non ancora partito). */
  at(time: number): TransportPosition | null {
    const a = this.anchors;
    while (a.length > 1 && a[1].time <= time) a.shift();
    const now = a[0];
    if (!now || now.time > time) return null;
    return { beat: now.beat + ((time - now.time) * now.bpm) / 60, bpm: now.bpm, beatsPerBar: now.beatsPerBar };
  }
}
