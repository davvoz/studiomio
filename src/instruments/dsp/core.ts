/** Il motore di uno strumento, eseguito nell'AudioWorklet: riceve note e parametri e somma
 *  il suo suono nei buffer d'uscita. Un tipo di strumento nuovo implementa questa interfaccia
 *  e si registra in worklet/cores.ts. Non sa nulla di tempi assoluti: le note arrivano
 *  esattamente al campione giusto, divise dal processore. */
export interface InstrumentCore {
  setParams(params: Readonly<Record<string, number>>): void;
  /** `id` identifica la nota per il suo noteOff (più note della stessa altezza possono sovrapporsi). */
  noteOn(id: number, pitch: number, velocity: number): void;
  noteOff(id: number): void;
  /** Spegne tutto in pochi millisecondi (stop, salto del cursore). */
  silence(): void;
  /** Somma l'uscita nei campioni [from, to) dei due canali. */
  render(left: Float32Array, right: Float32Array, from: number, to: number): void;
}

export type CoreFactory = (sampleRate: number) => InstrumentCore;

export const midiToHz = (pitch: number): number => 440 * Math.pow(2, (pitch - 69) / 12);

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
