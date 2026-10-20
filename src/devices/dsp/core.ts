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
  /** Per chi suona un sample: dove leggono le voci che suonano (frazioni del sample; con più
   *  sample, l'indice del sample più la frazione), scritte in `out`; restituisce quante sono.
   *  L'interfaccia le disegna sulla forma d'onda. */
  playheads?(out: Float32Array): number;
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

/** Dove si trova il trasporto all'inizio di un blocco: il battito della timeline (in quarti) e
 *  il tempo con cui avanza. */
export interface TransportPosition {
  readonly beat: number;
  readonly bpm: number;
  readonly beatsPerBar: number;
}

/** Un effetto che segue la battuta (es. il Beat Repeat). */
export interface TransportFollower {
  /** La posizione del trasporto all'inizio del prossimo `process`; null se è fermo. */
  setTransport(position: TransportPosition | null): void;
}

export const followsTransport = (core: object): core is TransportFollower =>
  typeof (core as Partial<TransportFollower>).setTransport === 'function';

/** Un effetto con il rilevatore che può ascoltare un altro suono (sidechain). */
export interface KeyedEffect {
  /** Il suono che il rilevatore ascolta nel prossimo `process` (stessa lunghezza dell'ingresso);
   *  null: torna ad ascoltare l'ingresso. */
  setKey(left: Float32Array | null, right: Float32Array | null): void;
}

export const isKeyed = (core: object): core is KeyedEffect => typeof (core as Partial<KeyedEffect>).setKey === 'function';

export const midiToHz = (pitch: number): number => 440 * Math.pow(2, (pitch - 69) / 12);

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
