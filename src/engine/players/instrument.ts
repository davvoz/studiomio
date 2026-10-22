import type { InstrumentSettings } from '../../model/device';
import type { AudioGraph, AudioNodeLike } from '../audio-graph';
import type { TransportAnchor } from '../../devices/worklet/transport-clock';
import type { DeviceModulation } from '../modulation';

/** Uno strumento che suona nel grafo audio: riceve note a orari precisi del contesto audio
 *  e le impostazioni della traccia quando cambiano. */
export interface Instrument {
  readonly type: string;
  readonly output: AudioNodeLike;
  /** I parametri che le clip possono modulare. */
  readonly modulation?: DeviceModulation;
  /** `velocity` 1..127, tempi in secondi del contesto audio. */
  play(pitch: number, velocity: number, when: number, duration: number): void;
  /** Nuovi valori dei parametri (stesso tipo di strumento). */
  update(settings: InstrumentSettings): void;
  /** Il tempo del progetto è cambiato (per le modulazioni a tempo dello strumento). */
  setTempo?(bpm: number): void;
  stopAll(): void;
  /** Per chi suona un sample: dove leggono le voci adesso (frazioni del sample). */
  playheads?(): readonly number[];
  /** Toglie le note che partirebbero da `at` (secondi del contesto) e chiude lì quelle che
   *  suonerebbero oltre. */
  cut(at: number): void;
  /** Toglie le note che partirebbero da `at`; quelle già partite suonano fino alla loro fine
   *  (riprogrammazione dopo una modifica: le note da `at` arrivano di nuovo). */
  retake(at: number): void;
  dispose(): void;
}

/** Dove nascono gli strumenti: nel browser l'AudioWorklet, nei test un registratore. */
export interface InstrumentHost {
  /** Prepara il grafo (es. carica il modulo AudioWorklet). */
  prepare(graph: AudioGraph): Promise<void>;
  create(graph: AudioGraph, settings: InstrumentSettings, bpm: number): Instrument;
  /** Dove si trova il trasporto del grafo (null: fermo), per gli strumenti che seguono la
   *  battuta (il sequencer): vale anche per quelli creati dopo. */
  transport?(graph: AudioGraph, anchor: TransportAnchor | null): void;
  /** Si risolve quando gli strumenti del grafo hanno ricevuto tutto quello che è stato
   *  mandato loro: serve prima di un export offline. */
  settle(graph: AudioGraph): Promise<void>;
}
