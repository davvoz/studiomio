import type { DeviceId } from '../core/id';
import type { TransportAnchor } from '../devices/worklet/transport-clock';
import type { EffectSettings } from '../model/device';
import type { AudioGraph, AudioNodeLike } from './audio-graph';
import type { DeviceModulation } from './modulation';

/** Points to listen to an effect from (for the spectrum): the sound before and after. Nobody touches
 *  their outputs, so a connection made there stays even if the chain is reconnected. */
export interface EffectMonitor {
  readonly pre: AudioNodeLike;
  readonly post: AudioNodeLike;
  /** For the dynamics effects: who wants to know what they're doing (null: nobody). */
  watch?(listener: DynamicsListener | null): void;
}

/** The level the detector hears and the reduction, in dB. */
export type DynamicsListener = (input: number, reduction: number) => void;

/** An effect in the audio graph: the sound enters from `input` and exits from `output`. */
export interface Effect {
  readonly type: string;
  readonly input: AudioNodeLike;
  readonly output: AudioNodeLike;
  readonly monitor?: EffectMonitor;
  /** For the types with sidechain: where the sound the detector listens to enters. */
  readonly sidechain?: AudioNodeLike;
  /** The parameters the clips can modulate. */
  readonly modulation?: DeviceModulation;
  /** New settings of the same type (parameters, on/off). */
  update(settings: EffectSettings): void;
  setTempo(bpm: number): void;
  dispose(): void;
}

/** Where the effects are born: in the browser the AudioWorklet, in tests a recorder. */
export interface EffectHost {
  create(graph: AudioGraph, settings: EffectSettings, bpm: number): Effect;
  /** Where the transport is, for the effects that follow the bar: it applies to all the
   *  graph's effects, also those created later. null: stopped. */
  transport?(graph: AudioGraph, anchor: TransportAnchor | null): void;
  /** Resolves when the graph's effects have received the messages sent so far. */
  settle?(graph: AudioGraph): Promise<void>;
}

interface Slot {
  settings: EffectSettings;
  readonly effect: Effect;
}

/** The effect chain of a channel, between `input` and `output`, aligned with the track:
 *  creates, updates, removes and reconnects the effects only when needed. */
export class EffectChain {
  private slots = new Map<DeviceId, Slot>();
  private order: readonly DeviceId[] = [];
  private bpm = 0;

  constructor(
    private readonly graph: AudioGraph,
    private readonly host: EffectHost,
    private readonly input: AudioNodeLike,
    private readonly output: AudioNodeLike,
  ) {
    input.connect(output);
  }

  get size(): number {
    return this.order.length;
  }

  effect(id: DeviceId): Effect | undefined {
    return this.slots.get(id)?.effect;
  }

  sync(effects: readonly EffectSettings[], bpm: number): void {
    const next = new Map<DeviceId, Slot>();
    let rewire = effects.length !== this.order.length || effects.some((e, i) => e.id !== this.order[i]);
    for (const e of effects) {
      const slot = this.slots.get(e.id);
      if (slot && slot.effect.type === e.type) {
        if (slot.settings !== e) slot.effect.update(e);
        slot.settings = e;
        next.set(e.id, slot);
      } else {
        slot?.effect.dispose();
        next.set(e.id, { settings: e, effect: this.host.create(this.graph, e, bpm) });
        rewire = true;
      }
    }
    for (const [id, slot] of this.slots) if (!next.has(id)) slot.effect.dispose();
    if (bpm !== this.bpm) for (const [id, slot] of next) if (this.slots.get(id) === slot) slot.effect.setTempo(bpm);
    this.slots = next;
    this.bpm = bpm;
    if (rewire) this.connect(effects.map(e => e.id));
  }

  dispose(): void {
    for (const { effect } of this.slots.values()) effect.dispose();
    this.slots.clear();
    this.input.disconnect();
  }

  /** input → effects in order → output. */
  private connect(order: readonly DeviceId[]): void {
    this.order = order;
    const effects = order.map(id => this.slots.get(id)!.effect);
    this.input.disconnect();
    for (const e of effects) e.output.disconnect();
    let from = this.input;
    for (const e of effects) {
      from.connect(e.input);
      from = e.output;
    }
    from.connect(this.output);
  }
}
