import type { InstrumentSettings } from '../../model/instrument';
import type { AudioGraph, AudioNodeLike } from '../audio-graph';

/** Uno strumento che suona nel grafo audio: riceve note a orari precisi del contesto audio
 *  e le impostazioni della traccia quando cambiano. */
export interface Instrument {
  readonly type: string;
  readonly output: AudioNodeLike;
  /** `velocity` 1..127, tempi in secondi del contesto audio. */
  play(pitch: number, velocity: number, when: number, duration: number): void;
  /** Nuovi valori dei parametri (stesso tipo di strumento). */
  update(settings: InstrumentSettings): void;
  stopAll(): void;
  dispose(): void;
}

/** Dove nascono gli strumenti: nel browser l'AudioWorklet, nei test un registratore. */
export interface InstrumentHost {
  /** Prepara il grafo (es. carica il modulo AudioWorklet). */
  prepare(graph: AudioGraph): Promise<void>;
  create(graph: AudioGraph, settings: InstrumentSettings): Instrument;
  /** Si risolve quando gli strumenti del grafo hanno ricevuto tutto quello che è stato
   *  mandato loro: serve prima di un export offline. */
  settle(graph: AudioGraph): Promise<void>;
}
