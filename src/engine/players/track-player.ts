import type { Track } from '../../model/track';
import type { AudioGraph, AudioNodeLike, ScheduledNodeLike } from '../audio-graph';
import type { ScheduledSource } from '../scheduler';

/** Fa suonare una traccia: riceve le versioni nuove della traccia e programma le sue clip. */
export interface TrackPlayer extends ScheduledSource {
  update(track: Track): void;
  /** Suona subito una nota, per chi ha uno strumento. */
  audition?(pitch: number, velocity: number, seconds: number): void;
  dispose(): void;
}

export interface PlayerContext {
  readonly graph: AudioGraph;
  /** Ingresso del canale del mixer della traccia. */
  readonly output: AudioNodeLike;
  /** Da chiamare quando qualcosa non parte perché il suo audio non è ancora pronto. */
  readonly missing: () => void;
}

/** Nodi programmati e non ancora finiti, per poterli fermare tutti insieme. */
export class ActiveNodes {
  private readonly nodes = new Set<ScheduledNodeLike>();

  /** Registra il nodo; alla fine `cleanup` scollega ciò che serve. */
  add(node: ScheduledNodeLike, cleanup: () => void): void {
    this.nodes.add(node);
    node.onended = () => {
      this.nodes.delete(node);
      cleanup();
    };
  }

  get size(): number {
    return this.nodes.size;
  }

  stopAll(): void {
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        // già fermo
      }
    }
  }
}
