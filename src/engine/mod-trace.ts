/* Dove sono adesso le modulazioni, per l'interfaccia: mentre una curva suona la manopola del
 * parametro la segue. Ogni bersaglio si ricorda gli scalini e le rampe programmati sulla sua
 * destinazione, con le regole degli AudioParam (la stessa ModTimeline del worklet), e ne calcola
 * il valore di adesso; ciò che è già passato si dimentica. */
import { ModTimeline } from '../devices/worklet/mod-timeline';
import type { ModSink } from './modulation';

/** Le tracce di tutti i bersagli, per chiave; `now` è l'ora del contesto audio. Un bersaglio
 *  può averne più d'una, una per fonte (le curve delle clip, ogni destinazione di un LFO): si
 *  combinano come nel suono. */
export class ModTraces {
  private readonly lines = new Map<string, ModTimeline>();
  /** Per bersaglio, le chiavi delle tracce delle altre fonti. */
  private readonly channels = new Map<string, Set<string>>();

  constructor(private readonly now: () => number) {}

  /** La destinazione `inner` che si ricorda anche ciò che riceve, nella traccia `key` (con
   *  `channel`, quella della fonte). */
  wrap(key: string, neutral: number, inner: ModSink, channel?: string): ModSink {
    const trace = channel ? `${key}|${channel}` : key;
    if (channel) {
      let set = this.channels.get(key);
      if (!set) this.channels.set(key, (set = new Set()));
      set.add(trace);
    }
    let line = this.lines.get(trace);
    if (!line) this.lines.set(trace, (line = new ModTimeline(neutral)));
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

  /** Il valore di adesso nella traccia `key`, o null se lì non è mai arrivato niente. Con le
   *  altre fonti: gli spostamenti si sommano, i guadagni (`multiply`) si moltiplicano. */
  current(key: string, multiply = false): number | null {
    const now = this.now();
    let value = this.lines.get(key)?.valueAt(now) ?? null;
    for (const trace of this.channels.get(key) ?? []) {
      const v = this.lines.get(trace)!.valueAt(now);
      value = value === null ? v : multiply ? value * v : value + v;
    }
    return value;
  }
}
