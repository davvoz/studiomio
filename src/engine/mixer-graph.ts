import type { DeviceId, TrackId } from '../core/id';
import { MASTER, type ChainOwner, type Project } from '../model/project';
import type { MixerSettings, Track } from '../model/track';
import { EffectChain, type Effect, type EffectHost } from './effect-chain';
import type { Meter, MeterHost, MeterReading } from './meters';
import { dbToGain, type AudioGraph, type AudioNodeLike, type AudioParamLike, type ConstantSourceNodeLike, type GainNodeLike, type PannerNodeLike } from './audio-graph';

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

/** Mette il misuratore (se c'è) tra `from` e `to`: misura ciò che arriva a `to`. */
function metered(from: AudioNodeLike, to: AudioNodeLike, meter: Meter | null): void {
  if (!meter) from.connect(to);
  else {
    from.connect(meter.input);
    meter.output.connect(to);
  }
}

/** Le modulazioni del canale: volume (un guadagno dopo il fader) e pan (un valore sommato al pan). */
export type MixerModulation = 'volume' | 'pan';

/** Canale del mixer di una traccia: effetti → volume → modulazione del volume → pan → mute/solo
 *  → misuratore → master. La modulazione del pan è una sorgente costante sommata al pan. */
class ChannelStrip {
  readonly input: GainNodeLike;
  readonly chain: EffectChain;
  private readonly fader: GainNodeLike;
  private readonly modGain: GainNodeLike;
  private readonly panner: PannerNodeLike;
  private readonly panOffset: ConstantSourceNodeLike;
  private readonly gate: GainNodeLike;
  private applied: { mixer: MixerSettings; audible: boolean } | null = null;

  constructor(private readonly graph: AudioGraph, effects: EffectHost, output: AudioNodeLike, readonly meter: Meter | null) {
    this.input = graph.createGain();
    this.fader = graph.createGain();
    this.modGain = graph.createGain();
    this.panner = graph.createStereoPanner();
    this.panOffset = graph.createConstantSource();
    this.panOffset.offset.setValueAtTime(0, 0);
    this.panOffset.connect(this.panner.pan);
    this.panOffset.start();
    this.gate = graph.createGain();
    // gli effetti stanno prima del volume, come in Live; il misuratore dopo: si vede ciò che si sente
    this.chain = new EffectChain(graph, effects, this.input, this.fader);
    this.fader.connect(this.modGain);
    this.modGain.connect(this.panner);
    this.panner.connect(this.gate);
    metered(this.gate, output, meter);
  }

  apply(mixer: MixerSettings, audible: boolean): void {
    if (this.applied?.mixer === mixer && this.applied.audible === audible) return;
    const t = this.graph.currentTime, first = this.applied === null;
    setParam(this.fader.gain, dbToGain(mixer.volumeDb), t, first);
    setParam(this.panner.pan, Math.max(-1, Math.min(1, mixer.pan)), t, first);
    setParam(this.gate.gain, audible ? 1 : 0, t, first);
    this.applied = { mixer, audible };
  }

  /** Il parametro su cui va la modulazione: guadagno (1 = neutro) o spostamento del pan (0). */
  modulation(param: MixerModulation): AudioParamLike {
    return param === 'volume' ? this.modGain.gain : this.panOffset.offset;
  }

  dispose(): void {
    this.chain.dispose();
    for (const n of [this.fader, this.modGain, this.panner, this.panOffset, this.gate]) n.disconnect();
    this.meter?.dispose();
  }
}

/** Il mixer nel grafo audio: un canale per traccia e il master, allineati al progetto.
 *  Le tracce si sommano nel bus del master, che passa per i suoi effetti e poi per il suo
 *  volume: bus → effetti del master → `master` → misuratore → uscita. Con `meters` ogni
 *  canale ha il suo misuratore di livello (nell'export non servono). */
export class MixerGraph {
  /** Dopo gli effetti del master: il metronomo entra qui, così gli effetti non lo toccano. */
  readonly master: GainNodeLike;
  private readonly bus: GainNodeLike;
  private readonly masterChain: EffectChain;
  private readonly masterMeter: Meter | null;
  private readonly strips = new Map<TrackId, ChannelStrip>();
  private masterSettings: MixerSettings | null = null;

  constructor(
    private readonly graph: AudioGraph,
    private readonly effects: EffectHost,
    destination: AudioNodeLike = graph.destination,
    private readonly meters: MeterHost | null = null,
  ) {
    this.bus = graph.createGain();
    this.master = graph.createGain();
    this.masterChain = new EffectChain(graph, effects, this.bus, this.master);
    this.masterMeter = meters?.create(graph) ?? null;
    metered(this.master, destination, this.masterMeter);
  }

  /** I livelli di una traccia o del master dall'ultima lettura; null senza misuratori. */
  levels(owner: ChainOwner): MeterReading | null {
    const meter = owner === MASTER ? this.masterMeter : this.strips.get(owner)?.meter;
    return meter?.read() ?? null;
  }

  /** Un effetto che suona, nella catena di una traccia o del master. */
  effect(owner: ChainOwner, id: DeviceId): Effect | undefined {
    const chain = owner === MASTER ? this.masterChain : this.strips.get(owner)?.chain;
    return chain?.effect(id);
  }

  /** Dove va la modulazione del volume o del pan di una traccia. */
  modulation(id: TrackId, param: MixerModulation): AudioParamLike {
    return this.strip(id).modulation(param);
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
    for (const t of project.tracks) {
      const strip = this.strip(t.id);
      strip.apply(t.mixer, audible.has(t.id));
      strip.chain.sync(t.effects, project.tempo.bpm);
    }
    this.masterChain.sync(project.masterEffects, project.tempo.bpm);
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
      s = new ChannelStrip(this.graph, this.effects, this.bus, this.meters?.create(this.graph) ?? null);
      this.strips.set(id, s);
    }
    return s;
  }
}
