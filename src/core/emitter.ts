/** Mappa evento → argomenti del listener. */
export type EventMap = { [event: string]: unknown[] };

export type Unsubscribe = () => void;

type AnyListener = (...args: unknown[]) => void;

/** Eventi tipizzati: nome dell'evento e argomenti sono controllati dal compilatore. */
export class Emitter<E extends EventMap> {
  private readonly listeners = new Map<keyof E, Set<AnyListener>>();

  on<K extends keyof E>(event: K, listener: (...args: E[K]) => void): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    // la mappa conserva listener di tipi diversi: on/emit garantiscono l'abbinamento
    const l = listener as unknown as AnyListener;
    set.add(l);
    return () => set.delete(l);
  }

  emit<K extends keyof E>(event: K, ...args: E[K]): void {
    for (const l of [...(this.listeners.get(event) ?? [])]) l(...args);
  }
}
