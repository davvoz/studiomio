import type { DeviceId } from '../core/id';
import type { EffectSettings } from '../model/device';
import type { AudioGraph, AudioNodeLike } from './audio-graph';

/** Un effetto nel grafo audio: il suono entra da `input` ed esce da `output`. */
export interface Effect {
  readonly type: string;
  readonly input: AudioNodeLike;
  readonly output: AudioNodeLike;
  /** Nuove impostazioni dello stesso tipo (parametri, acceso/spento). */
  update(settings: EffectSettings): void;
  setTempo(bpm: number): void;
  dispose(): void;
}

/** Dove nascono gli effetti: nel browser l'AudioWorklet, nei test un registratore. */
export interface EffectHost {
  create(graph: AudioGraph, settings: EffectSettings, bpm: number): Effect;
}

interface Slot {
  settings: EffectSettings;
  readonly effect: Effect;
}

/** La catena degli effetti di un canale, tra `input` e `output`, allineata alla traccia:
 *  crea, aggiorna, toglie e ricollega gli effetti solo quando serve. */
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

  /** input → effetti nell'ordine → output. */
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
