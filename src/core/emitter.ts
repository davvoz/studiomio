/** Event → listener arguments map. */
export type EventMap = { [event: string]: unknown[] };

export type Unsubscribe = () => void;

type AnyListener = (...args: unknown[]) => void;

/** Typed events: event name and arguments are checked by the compiler. */
export class Emitter<E extends EventMap> {
  private readonly listeners = new Map<keyof E, Set<AnyListener>>();

  on<K extends keyof E>(event: K, listener: (...args: E[K]) => void): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    // the map keeps listeners of different types: on/emit guarantee the pairing
    const l = listener as unknown as AnyListener;
    set.add(l);
    return () => set.delete(l);
  }

  emit<K extends keyof E>(event: K, ...args: E[K]): void {
    // a copy: a listener added while emitting hears the next event, not this one
    const listeners = Array.from(this.listeners.get(event) ?? []);
    for (const l of listeners) l(...args);
  }
}
