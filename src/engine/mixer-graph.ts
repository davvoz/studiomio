import type { DeviceId, TrackId } from '../core/id';
import { isModulatorType } from '../devices/modulators/modulators';
import type { EffectSettings } from '../model/device';
import { MASTER, type ChainOwner, type Project } from '../model/project';
import { sidechainLinks } from '../model/sidechain';
import { SEND_OFF_DB, type MixerSettings, type Track } from '../model/track';
import { EffectChain, type Effect, type EffectHost } from './effect-chain';
import type { Meter, MeterHost, MeterReading } from './meters';
import { dbToGain, type AudioGraph, type AudioNodeLike, type AudioParamLike, type ConstantSourceNodeLike, type GainNodeLike, type PannerNodeLike } from './audio-graph';

/** Cosa lascia passare ogni canale: il suono verso la sua uscita e quello verso i bus. */
export interface MixerGates {
  /** I canali che si sentono dalla loro uscita (tracce, gruppi e bus). */
  readonly audible: Set<TrackId>;
  /** Le tracce le cui mandate suonano. */
  readonly sending: Set<TrackId>;
}

/** I canali aperti: mai quelli in mute; con almeno un solo attivo, come in Live, quelli in solo,
 *  quelli dentro un gruppo in solo e i gruppi che contengono una traccia in solo (il suo suono
 *  passa di lì). Il mute di un gruppo zittisce le sue tracce perché passano dal suo canale.
 *  I bus restano aperti al solo di una traccia (si sente anche il suo riverbero); il solo di un
 *  bus chiude le tracce e gli altri bus, ma le tracce continuano a mandargli il suono. Le mandate
 *  di una traccia tacciono se lei o un suo gruppo sono in mute, o se c'è il solo di un'altra. */
export function mixerGates(tracks: readonly Track[], buses: readonly Track[] = []): MixerGates {
  const byId = new Map(tracks.map(t => [t.id, t]));
  const groupsOf = (t: Track): Track[] => {
    const out: Track[] = [];
    for (let g = t.group ? byId.get(t.group) : undefined; g; g = g.group ? byId.get(g.group) : undefined) out.push(g);
    return out;
  };
  const soloed = tracks.filter(t => t.mixer.solo), soloedBuses = buses.filter(b => b.mixer.solo);
  const open = new Set(soloed.flatMap(t => [t, ...groupsOf(t)]).map(t => t.id));
  const passes = (t: Track) => !soloed.length || open.has(t.id) || groupsOf(t).some(g => g.mixer.solo);
  const audible = new Set([
    ...tracks.filter(t => !t.mixer.mute && (soloed.length ? passes(t) : !soloedBuses.length)),
    ...buses.filter(b => !b.mixer.mute && (!soloedBuses.length || b.mixer.solo)),
  ].map(t => t.id));
  const sending = new Set(tracks.filter(t => !t.mixer.mute && !groupsOf(t).some(g => g.mixer.mute) && passes(t)).map(t => t.id));
  return { audible, sending };
}

/** I canali che si sentono dalla loro uscita (vedi `mixerGates`). */
export const audibleTracks = (tracks: readonly Track[], buses: readonly Track[] = []): Set<TrackId> => mixerGates(tracks, buses).audible;

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

/** Gli effetti che il suono attraversa: i modulatori (LFO, Inviluppo) non lo toccano, li suona il
 *  motore. Se non ce ne sono, la stessa lista (così la catena vede che non è cambiata). */
const audioEffects = (effects: readonly EffectSettings[]): readonly EffectSettings[] =>
  (effects.some(e => isModulatorType(e.type)) ? effects.filter(e => !isModulatorType(e.type)) : effects);

/** Le modulazioni del canale: volume (un guadagno dopo il fader) e pan (un valore sommato al pan). */
export type MixerModulation = 'volume' | 'pan';

/** Stacca `from` da `to`. Un nodo già staccato del tutto (un canale tolto) dà errore: va bene così. */
function unlink(from: AudioNodeLike, to: AudioNodeLike): void {
  try {
    from.disconnect(to);
  } catch { /* non erano più collegati */ }
}

/** Una mandata fatta: il suo guadagno e l'ingresso del bus in cui entra. */
interface SendWire {
  readonly gain: GainNodeLike;
  readonly to: AudioNodeLike;
  db: number;
}

/** Canale del mixer di una traccia: effetti → `tap` → volume → modulazione del volume → pan →
 *  mute/solo → misuratore → uscita (il master, o il canale del gruppo che contiene la traccia).
 *  Da `tap` si prende il suono per il sidechain degli altri canali. La modulazione del pan è
 *  una sorgente costante sommata al pan. Le mandate partono dopo il pan (dopo il fader, come
 *  in Live) e passano per un loro cancello, che il solo dei bus lascia aperto. */
class ChannelStrip {
  readonly input: GainNodeLike;
  readonly chain: EffectChain;
  /** Il suono dopo gli effetti e prima del volume: quello che ascolta il sidechain. */
  readonly tap: GainNodeLike;
  private readonly fader: GainNodeLike;
  private readonly modGain: GainNodeLike;
  private readonly panner: PannerNodeLike;
  private readonly panOffset: ConstantSourceNodeLike;
  private readonly gate: GainNodeLike;
  private readonly sendGate: GainNodeLike;
  private readonly sends = new Map<TrackId, SendWire>();
  /** Le modulazioni degli LFO e degli inviluppi, una per canale: guadagni in fila tra il fader e
   *  la modulazione del volume, sorgenti costanti sommate al pan. */
  private readonly channels = new Map<string, { readonly volume?: GainNodeLike; readonly pan?: ConstantSourceNodeLike }>();
  private applied: { mixer: MixerSettings; audible: boolean; sending: boolean } | null = null;
  private output: AudioNodeLike;

  constructor(private readonly graph: AudioGraph, effects: EffectHost, output: AudioNodeLike, readonly meter: Meter | null) {
    this.output = output;
    this.input = graph.createGain();
    this.tap = graph.createGain();
    this.fader = graph.createGain();
    this.modGain = graph.createGain();
    this.panner = graph.createStereoPanner();
    this.panOffset = graph.createConstantSource();
    this.panOffset.offset.setValueAtTime(0, 0);
    this.panOffset.connect(this.panner.pan);
    this.panOffset.start();
    this.gate = graph.createGain();
    this.sendGate = graph.createGain();
    // gli effetti stanno prima del volume, come in Live; il misuratore dopo: si vede ciò che si sente
    this.chain = new EffectChain(graph, effects, this.input, this.tap);
    this.tap.connect(this.fader);
    this.fader.connect(this.modGain);
    this.modGain.connect(this.panner);
    this.panner.connect(this.gate);
    this.panner.connect(this.sendGate);
    metered(this.gate, output, meter);
  }

  apply(mixer: MixerSettings, audible: boolean, sending: boolean): void {
    const a = this.applied;
    if (a?.mixer === mixer && a.audible === audible && a.sending === sending) return;
    const t = this.graph.currentTime, first = a === null;
    setParam(this.fader.gain, dbToGain(mixer.volumeDb), t, first);
    setParam(this.panner.pan, Math.max(-1, Math.min(1, mixer.pan)), t, first);
    setParam(this.gate.gain, audible ? 1 : 0, t, first);
    setParam(this.sendGate.gain, sending ? 1 : 0, t, first);
    this.applied = { mixer, audible, sending };
  }

  /** Le mandate aperte, per bus: livello in dB e ingresso del bus. Le altre si staccano. */
  syncSends(targets: ReadonlyMap<TrackId, { readonly db: number; readonly to: AudioNodeLike }>): void {
    for (const [bus, wire] of this.sends) {
      if (targets.get(bus)?.to === wire.to) continue;
      wire.gain.disconnect();
      this.sends.delete(bus);
    }
    for (const [bus, { db, to }] of targets) {
      let wire = this.sends.get(bus);
      const first = !wire;
      if (!wire) {
        wire = { gain: this.graph.createGain(), to, db };
        this.sendGate.connect(wire.gain);
        wire.gain.connect(to);
        this.sends.set(bus, wire);
      } else if (wire.db === db) continue;
      setParam(wire.gain.gain, dbToGain(db), this.graph.currentTime, first);
      wire.db = db;
    }
  }

  /** Manda il canale altrove (una traccia entrata in un gruppo o uscita). */
  route(output: AudioNodeLike): void {
    if (output === this.output) return;
    const last = this.meter?.output ?? this.gate;
    last.disconnect();
    last.connect(output);
    this.output = output;
  }

  /** Il parametro su cui va la modulazione: guadagno (1 = neutro) o spostamento del pan (0). */
  modulation(param: MixerModulation, channel?: string): AudioParamLike {
    if (!channel) return param === 'volume' ? this.modGain.gain : this.panOffset.offset;
    const key = `${param}|${channel}`;
    let c = this.channels.get(key);
    if (!c) {
      if (param === 'volume') {
        // subito dopo il fader: fader → nuovo → (quelli di prima) → modulazione del volume
        const gain = this.graph.createGain();
        const next = [...this.channels.values()].map(x => x.volume).filter(g => !!g).at(-1) ?? this.modGain;
        unlink(this.fader, next);
        this.fader.connect(gain);
        gain.connect(next);
        c = { volume: gain };
      } else {
        const pan = this.graph.createConstantSource();
        pan.offset.setValueAtTime(0, 0);
        pan.connect(this.panner.pan);
        pan.start();
        c = { pan };
      }
      this.channels.set(key, c);
    }
    return c.volume?.gain ?? c.pan!.offset;
  }

  dispose(): void {
    this.chain.dispose();
    for (const c of this.channels.values()) (c.volume ?? c.pan)!.disconnect();
    for (const n of [this.tap, this.fader, this.modGain, this.panner, this.panOffset, this.gate, this.sendGate]) n.disconnect();
    for (const wire of this.sends.values()) wire.gain.disconnect();
    this.meter?.dispose();
  }
}

/** Un collegamento del sidechain nel grafo: il `tap` di un canale nel `sidechain` di un effetto. */
interface KeyWire {
  readonly from: AudioNodeLike;
  readonly to: AudioNodeLike;
}

/** Il mixer nel grafo audio: un canale per traccia e il master, allineati al progetto.
 *  Le tracce si sommano nel bus del master, che passa per i suoi effetti e poi per il suo
 *  volume: bus → effetti del master → `master` → misuratore → uscita. Le tracce di un gruppo
 *  si sommano invece nel canale del gruppo, che esce nel master (o nel gruppo che lo contiene).
 *  Le mandate portano il suono delle tracce nei canali dei bus, che escono nel master.
 *  Il sidechain porta il suono di un canale nel rilevatore di un effetto di un altro (vedi
 *  model/sidechain.ts). Con `meters` ogni canale ha il suo misuratore di livello (nell'export
 *  non servono). */
export class MixerGraph {
  /** Dopo gli effetti del master: il metronomo entra qui, così gli effetti non lo toccano. */
  readonly master: GainNodeLike;
  private readonly bus: GainNodeLike;
  private readonly masterChain: EffectChain;
  private readonly masterMeter: Meter | null;
  private readonly strips = new Map<TrackId, ChannelStrip>();
  /** I collegamenti del sidechain fatti, per effetto ("proprietario/id"). */
  private wires = new Map<string, KeyWire>();
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
  modulation(id: TrackId, param: MixerModulation, channel?: string): AudioParamLike {
    return this.strip(id).modulation(param, channel);
  }

  /** Ingresso del canale della traccia (creato se non c'è). */
  input(id: TrackId): AudioNodeLike {
    return this.strip(id).input;
  }

  sync(project: Project): void {
    const { audible, sending } = mixerGates(project.tracks, project.buses);
    const present = new Set(project.channels.map(t => t.id));
    for (const [id, s] of this.strips) {
      if (!present.has(id)) {
        s.dispose();
        this.strips.delete(id);
      }
    }
    for (const t of project.tracks) {
      const strip = this.strip(t.id);
      // il gruppo viene prima delle sue tracce: il suo canale c'è già
      strip.route(t.group ? this.strip(t.group).input : this.bus);
      strip.apply(t.mixer, audible.has(t.id), sending.has(t.id));
      strip.chain.sync(audioEffects(t.effects), project.tempo.bpm);
      const sends = new Map<TrackId, { db: number; to: AudioNodeLike }>();
      for (const [bus, db] of Object.entries(t.sends) as [TrackId, number][]) {
        if (db > SEND_OFF_DB && present.has(bus)) sends.set(bus, { db, to: this.strip(bus).input });
      }
      strip.syncSends(sends);
    }
    for (const b of project.buses) {
      const strip = this.strip(b.id);
      strip.route(this.bus);
      strip.apply(b.mixer, audible.has(b.id), false);
      strip.chain.sync(audioEffects(b.effects), project.tempo.bpm);
    }
    this.masterChain.sync(audioEffects(project.masterEffects), project.tempo.bpm);
    if (this.masterSettings !== project.master) {
      // il master non ha pan né solo: solo volume e mute
      const m = project.master;
      setParam(this.master.gain, m.mute ? 0 : dbToGain(m.volumeDb), this.graph.currentTime, this.masterSettings === null);
      this.masterSettings = m;
    }
    this.syncSidechains(project);
  }

  /** Collega e stacca solo i sidechain cambiati (anche quando un effetto è stato ricreato). */
  private syncSidechains(project: Project): void {
    const next = new Map<string, KeyWire>();
    for (const link of sidechainLinks(project)) {
      const to = this.effect(link.owner, link.device)?.sidechain;
      const from = this.strips.get(link.source)?.tap;
      if (to && from) next.set(`${link.owner}/${link.device}`, { from, to });
    }
    const same = (a: KeyWire | undefined, b: KeyWire | undefined) => !!a && !!b && a.from === b.from && a.to === b.to;
    for (const [key, wire] of this.wires) if (!same(wire, next.get(key))) unlink(wire.from, wire.to);
    for (const [key, wire] of next) if (!same(wire, this.wires.get(key))) wire.from.connect(wire.to);
    this.wires = next;
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
