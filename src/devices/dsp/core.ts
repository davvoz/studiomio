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
  /** Il tempo del progetto, per chi ha modulazioni a tempo (LFO sincronizzati). */
  setTempo?(bpm: number): void;
}

export type CoreFactory = (sampleRate: number) => InstrumentCore;

/** Un sample caricato in un dispositivo (es. su un pad): i campioni e la loro frequenza. */
export interface SampleData {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
}

/** Un motore che suona sample: li riceve per posto (null = posto vuoto). */
export interface SamplePlayer {
  setSample(slot: string, sample: SampleData | null): void;
}

export const playsSamples = (core: object): core is SamplePlayer => typeof (core as Partial<SamplePlayer>).setSample === 'function';

/** Il motore di un effetto, eseguito nell'AudioWorklet: trasforma l'ingresso nell'uscita un
 *  blocco alla volta. Lo spegnimento (bypass) lo gestisce il processore, non l'effetto. */
export interface EffectCore {
  setParams(params: Readonly<Record<string, number>>): void;
  /** Il tempo del progetto, per gli effetti a tempo. */
  setTempo(bpm: number): void;
  /** Elabora `n` campioni: legge gli ingressi e scrive (sovrascrive) le uscite. */
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void;
}

export type EffectFactory = (sampleRate: number) => EffectCore;

export const midiToHz = (pitch: number): number => 440 * Math.pow(2, (pitch - 69) / 12);

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
