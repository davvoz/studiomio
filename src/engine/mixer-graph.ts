import type { TrackId } from '../core/id';
import type { Project } from '../model/project';
import type { MixerSettings, Track } from '../model/track';
import { dbToGain, type AudioGraph, type AudioNodeLike, type AudioParamLike, type GainNodeLike, type PannerNodeLike } from './audio-graph';

/** Tracce che si sentono: con almeno un solo attivo solo quelle in solo, mai quelle in mute. */
export function audibleTracks(tracks: readonly Track[]): Set<TrackId> {
  const soloing = tracks.some(t => t.mixer.solo);
  return new Set(tracks.filter(t => !t.mixer.mute && (!soloing || t.mixer.solo)).map(t => t.id));
}

/** Tempo di assestamento dei controlli, per evitare scatti udibili. */
const SMOOTH = 0.01;

/** Valore di un controllo: subito la prima volta, poi con una transizione morbida. */
function setParam(param: AudioParamLike, value: number, time: number, first: boolean): void {
  if (first) param.setValueAtTime(value, time);
  else param.setTargetAtTime(value, time, SMOOTH);
}

/** Canale del mixer di una traccia: volume → pan → mute/solo → master. */
class ChannelStrip {
  readonly input: GainNodeLike;
  private readonly panner: PannerNodeLike;
  private readonly gate: GainNodeLike;
  private applied: { mixer: MixerSettings; audible: boolean } | null = null;

  constructor(private readonly graph: AudioGraph, output: AudioNodeLike) {
    this.input = graph.createGain();
    this.panner = graph.createStereoPanner();
    this.gate = graph.createGain();
    this.input.connect(this.panner);
    this.panner.connect(this.gate);
    this.gate.connect(output);
  }

  apply(mixer: MixerSettings, audible: boolean): void {
    if (this.applied?.mixer === mixer && this.applied.audible === audible) return;
    const t = this.graph.currentTime, first = this.applied === null;
    setParam(this.input.gain, dbToGain(mixer.volumeDb), t, first);
    setParam(this.panner.pan, Math.max(-1, Math.min(1, mixer.pan)), t, first);
    setParam(this.gate.gain, audible ? 1 : 0, t, first);
    this.applied = { mixer, audible };
  }

  dispose(): void {
    for (const n of [this.input, this.panner, this.gate]) n.disconnect();
  }
}

/** Il mixer nel grafo audio: un canale per traccia e il master, allineati al progetto. */
export class MixerGraph {
  readonly master: GainNodeLike;
  private readonly strips = new Map<TrackId, ChannelStrip>();
  private masterSettings: MixerSettings | null = null;

  constructor(private readonly graph: AudioGraph, destination: AudioNodeLike = graph.destination) {
    this.master = graph.createGain();
    this.master.connect(destination);
  }

  /** Ingresso del canale della traccia (creato se non c'è). */
  input(id: TrackId): AudioNodeLike {
    return this.strip(id).input;
  }

  sync(project: Project): void {
    const audible = audibleTracks(project.tracks);
    const present = new Set(project.tracks.map(t => t.id));
    for (const [id, s] of this.strips) {
      if (!present.has(id)) {
        s.dispose();
        this.strips.delete(id);
      }
    }
    for (const t of project.tracks) this.strip(t.id).apply(t.mixer, audible.has(t.id));
    if (this.masterSettings !== project.master) {
      // il master non ha pan né solo: solo volume e mute
      const m = project.master;
      setParam(this.master.gain, m.mute ? 0 : dbToGain(m.volumeDb), this.graph.currentTime, this.masterSettings === null);
      this.masterSettings = m;
    }
  }

  private strip(id: TrackId): ChannelStrip {
    let s = this.strips.get(id);
    if (!s) {
      s = new ChannelStrip(this.graph, this.master);
      this.strips.set(id, s);
    }
    return s;
  }
}
