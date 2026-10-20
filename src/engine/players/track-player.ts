import type { Track } from '../../model/track';
import type { AudioGraph, AudioNodeLike, ScheduledNodeLike } from '../audio-graph';
import type { DeviceModulation } from '../modulation';
import type { NoteActivity } from '../note-activity';
import type { ScheduledSource } from '../scheduler';
import type { Program } from '../session';

/** Fa suonare una traccia: riceve le versioni nuove della traccia e programma le sue clip. */
export interface TrackPlayer extends ScheduledSource {
  update(track: Track): void;
  /** Suona subito una nota, per chi ha uno strumento. */
  audition?(pitch: number, velocity: number, seconds: number): void;
  /** I parametri modulabili dello strumento, per chi ne ha uno. */
  instrumentModulation?(): DeviceModulation | null;
  /** Dove leggono le voci dello strumento, se suona un sample (frazioni del sample). */
  playheads?(): readonly number[];
  /** Taglia all'istante `at` tutto ciò che ha già programmato oltre (una clip lanciata
   *  prende il posto di quella che suonava). */
  cut(at: number): void;
  dispose(): void;
}

export interface PlayerContext {
  readonly graph: AudioGraph;
  /** Ingresso del canale del mixer della traccia. */
  readonly output: AudioNodeLike;
  /** Da chiamare quando qualcosa non parte perché il suo audio non è ancora pronto. */
  readonly missing: () => void;
  /** Cosa suona la traccia e quando (timeline o clip della session), sull'orologio continuo. */
  readonly programs: () => readonly Program[];
  /** Dove annotare le note programmate, per l'interfaccia. */
  readonly notes: NoteActivity;
  /** Il tempo del progetto (BPM). */
  readonly tempo: () => number;
}

/** Come un nodo programmato smette prima del previsto. */
export interface NodeEnding {
  /** Finisce all'istante `at` (di norma con una breve dissolvenza). */
  cut(at: number): void;
  /** Riprogrammazione da `at`: se parte da `at` in poi non suona; se è già in corso lascia il
   *  posto a quello che lo sostituisce (che riparte da `at`). */
  retake(at: number): void;
}

/** Nodi programmati e non ancora finiti, per poterli fermare tutti insieme. */
export class ActiveNodes {
  private readonly nodes = new Map<ScheduledNodeLike, NodeEnding>();

  /** Registra il nodo; alla fine `cleanup` scollega ciò che serve. Senza `ending` il nodo si
   *  ferma di colpo all'istante del taglio. */
  add(node: ScheduledNodeLike, cleanup: () => void, ending?: NodeEnding): void {
    const stop = (at: number) => stopQuietly(node, at);
    this.nodes.set(node, ending ?? { cut: stop, retake: stop });
    node.onended = () => {
      this.nodes.delete(node);
      cleanup();
    };
  }

  /** Fa finire all'istante `at` tutti i nodi che suonerebbero oltre. */
  cutAt(at: number): void {
    for (const e of this.nodes.values()) e.cut(at);
  }

  /** Riprogrammazione da `at` (vedi `NodeEnding.retake`). */
  retakeAt(at: number): void {
    for (const e of this.nodes.values()) e.retake(at);
  }

  get size(): number {
    return this.nodes.size;
  }

  stopAll(): void {
    for (const n of this.nodes.keys()) stopQuietly(n);
  }
}

/** Ferma un nodo (subito, o all'istante `at`); se è già fermo non fa nulla. */
export function stopQuietly(node: ScheduledNodeLike, at?: number): void {
  try {
    node.stop(at);
  } catch {
    // già fermo
  }
}
