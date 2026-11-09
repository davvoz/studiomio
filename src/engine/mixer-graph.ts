import type { DeviceId, TrackId } from '../core/id';
import { isArpType } from '../devices/arp/arp';
import { isModulatorType } from '../devices/modulators/modulators';
import type { EffectSettings } from '../model/device';
import { MASTER, type ChainOwner, type Project } from '../model/project';
import { sidechainLinks } from '../model/sidechain';
import { SEND_OFF_DB, type MixerSettings, type Track } from '../model/track';
import { EffectChain, type Effect, type EffectHost } from './effect-chain';
import type { Meter, MeterHost, MeterReading } from './meters';
import { dbToGain, type AudioGraph, type AudioNodeLike, type AudioParamLike, type ConstantSourceNodeLike, type GainNodeLike, type PannerNodeLike } from './audio-graph';

/** What each channel lets through: the sound towards its output and the one towards the buses. */
export interface MixerGates {
  /** The channels heard from their output (tracks, groups and buses). */
  readonly audible: Set<TrackId>;
  /** The tracks whose sends play. */
  readonly sending: Set<TrackId>;
}

/** The open channels: never the muted ones; with at least one solo active, as in Live, those soloed,
 *  those inside a soloed group and the groups containing a soloed track (its sound
 *  passes through there). A group's mute silences its tracks because they pass through its channel.
 *  Buses stay open on a track's solo (its reverb is heard too); a bus's solo
 *  closes the tracks and the other buses, but the tracks keep sending it sound. A track's
 *  sends are silent if it or one of its groups is muted, or if another is soloed. */
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

/** The channels heard from their output (see `mixerGates`). */
export const audibleTracks = (tracks: readonly Track[], buses: readonly Track[] = []): Set<TrackId> => mixerGates(tracks, buses).audible;

/** Settling time of the controls, to avoid audible jumps. */
const SMOOTH = 0.01;

/** A control's value: right away the first time, then with a smooth transition. */
function setParam(param: AudioParamLike, value: number, time: number, first: boolean): void {
  if (first) param.setValueAtTime(value, time);
  else param.setTargetAtTime(value, time, SMOOTH);
}

/** Puts the meter (if any) between `from` and `to`: it measures what reaches `to`. */
function metered(from: AudioNodeLike, to: AudioNodeLike, meter: Meter | null): void {
  if (!meter) from.connect(to);
  else {
    from.connect(meter.input);
    meter.output.connect(to);
  }
}

/** They don't touch the sound: the modulators (LFO, Envelope) are played by the engine, the Arpeggiator by the instrument. */
const soundless = (e: EffectSettings) => isModulatorType(e.type) || isArpType(e.type);

/** The effects the sound goes through. If they're all of them, the same list (so the chain sees it
 *  hasn't changed). */
const audioEffects = (effects: readonly EffectSettings[]): readonly EffectSettings[] =>
  (effects.some(soundless) ? effects.filter(e => !soundless(e)) : effects);

/** The channel's modulations: volume (a gain after the fader) and pan (a value added to the pan). */
export type MixerModulation = 'volume' | 'pan';

/** Disconnects `from` from `to`. An already fully disconnected node (a removed channel) gives an error: that's fine. */
function unlink(from: AudioNodeLike, to: AudioNodeLike): void {
  try {
    from.disconnect(to);
  } catch { /* they were no longer connected */ }
}

/** A send made: its gain and the input of the bus it enters. */
interface SendWire {
  readonly gain: GainNodeLike;
  readonly to: AudioNodeLike;
  db: number;
}

/** A track's mixer channel: effects → `tap` → volume → volume modulation → pan →
 *  mute/solo → meter → output (the master, or the channel of the group containing the track).
 *  From `tap` the sound is taken for the other channels' sidechain. The pan modulation is
 *  a constant source added to the pan. The sends start after the pan (post-fader, as
 *  in Live) and go through their own gate, which the buses' solo leaves open. */
class ChannelStrip {
  readonly input: GainNodeLike;
  readonly chain: EffectChain;
  /** The sound after the effects and before the volume: what the sidechain listens to. */
  readonly tap: GainNodeLike;
  private readonly fader: GainNodeLike;
  private readonly modGain: GainNodeLike;
  private readonly panner: PannerNodeLike;
  private readonly panOffset: ConstantSourceNodeLike;
  private readonly gate: GainNodeLike;
  private readonly sendGate: GainNodeLike;
  private readonly sends = new Map<TrackId, SendWire>();
  /** The modulations of the LFOs and envelopes, one per channel: gains in a row between the fader and
   *  the volume modulation, constant sources added to the pan. */
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
    // the effects sit before the volume, as in Live; the meter after: you see what you hear
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

  /** The open sends, per bus: level in dB and the bus input. The others are disconnected. */
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

  /** Sends the channel elsewhere (a track that entered or left a group). */
  route(output: AudioNodeLike): void {
    if (output === this.output) return;
    const last = this.meter?.output ?? this.gate;
    last.disconnect();
    last.connect(output);
    this.output = output;
  }

  /** The parameter the modulation goes to: gain (1 = neutral) or pan offset (0). */
  modulation(param: MixerModulation, channel?: string): AudioParamLike {
    if (!channel) return param === 'volume' ? this.modGain.gain : this.panOffset.offset;
    const key = `${param}|${channel}`;
    let c = this.channels.get(key);
    if (!c) {
      if (param === 'volume') {
        // right after the fader: fader → new → (the previous ones) → volume modulation
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

/** A sidechain connection in the graph: a channel's `tap` into an effect's `sidechain`. */
interface KeyWire {
  readonly from: AudioNodeLike;
  readonly to: AudioNodeLike;
}

/** The mixer in the audio graph: one channel per track and the master, aligned with the project.
 *  The tracks are summed into the master's bus, which goes through its effects and then through its
 *  volume: bus → master effects → `master` → meter → output. The tracks of a group
 *  are instead summed into the group's channel, which goes out into the master (or into the group containing it).
 *  The sends carry the tracks' sound into the buses' channels, which go out into the master.
 *  The sidechain carries a channel's sound into the detector of another's effect (see
 *  model/sidechain.ts). With `meters` each channel has its level meter (in the export
 *  they're not needed). */
export class MixerGraph {
  /** After the master's effects: the metronome comes in here, so the effects don't touch it. */
  readonly master: GainNodeLike;
  private readonly bus: GainNodeLike;
  private readonly masterChain: EffectChain;
  private readonly masterMeter: Meter | null;
  private readonly strips = new Map<TrackId, ChannelStrip>();
  /** The sidechain connections made, per effect ("owner/id"). */
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

  /** The levels of a track or the master since the last read; null without meters. */
  levels(owner: ChainOwner): MeterReading | null {
    const meter = owner === MASTER ? this.masterMeter : this.strips.get(owner)?.meter;
    return meter?.read() ?? null;
  }

  /** A playing effect, in the chain of a track or of the master. */
  effect(owner: ChainOwner, id: DeviceId): Effect | undefined {
    const chain = owner === MASTER ? this.masterChain : this.strips.get(owner)?.chain;
    return chain?.effect(id);
  }

  /** Where the volume or pan modulation of a track goes. */
  modulation(id: TrackId, param: MixerModulation, channel?: string): AudioParamLike {
    return this.strip(id).modulation(param, channel);
  }

  /** Input of the track's channel (created if it isn't there). */
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
      // the group comes before its tracks: its channel is already there
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
      // the master has no pan or solo: only volume and mute
      const m = project.master;
      setParam(this.master.gain, m.mute ? 0 : dbToGain(m.volumeDb), this.graph.currentTime, this.masterSettings === null);
      this.masterSettings = m;
    }
    this.syncSidechains(project);
  }

  /** Connects and disconnects only the changed sidechains (also when an effect was recreated). */
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
