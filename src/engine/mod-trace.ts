/* Dove sono adesso le modulazioni, per l'interfaccia: mentre una curva suona la manopola del
 * parametro la segue. Ogni bersaglio si ricorda gli scalini e le rampe programmati sulla sua
 * destinazione, con le regole degli AudioParam (la stessa ModTimeline del worklet), e ne calcola
 * il valore di adesso; ciò che è già passato si dimentica. */
import { ModTimeline } from '../devices/worklet/mod-timeline';
import type { ModSink } from './modulation';

/** Le tracce di tutti i bersagli, per chiave; `now` è l'ora del contesto audio. */
export class ModTraces {
  private readonly lines = new Map<string, ModTimeline>();

  constructor(private readonly now: () => number) {}

  /** La destinazione `inner` che si ricorda anche ciò che riceve, nella traccia `key`. */
  wrap(key: string, neutral: number, inner: ModSink): ModSink {
    let line = this.lines.get(key);
    if (!line) this.lines.set(key, (line = new ModTimeline(neutral)));
    const l = line;
    // anche se nessuno la legge, la traccia butta ciò che è passato
    const add = (kind: 'set' | 'ramp', value: number, time: number) => {
      l.add({ kind, value, time });
      l.valueAt(this.now());
    };
    return {
      set: (v, t) => { inner.set(v, t); add('set', v, t); },
      ramp: (v, t) => { inner.ramp(v, t); add('ramp', v, t); },
      hold: t => { inner.hold(t); l.hold(t); },
    };
  }

  /** Il valore di adesso nella traccia `key`, o null se lì non è mai arrivato niente. */
  current(key: string): number | null {
    return this.lines.get(key)?.valueAt(this.now()) ?? null;
  }
}
