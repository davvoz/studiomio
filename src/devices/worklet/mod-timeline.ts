/* La modulazione dei parametri dei dispositivi, nell'AudioWorklet. Il thread principale manda
 * per ogni parametro scalini e rampe con il loro istante, come si fa con un AudioParam; qui si
 * calcola lo spostamento a ogni blocco e lo si somma al valore della manopola. Puro: si prova
 * anche in Node. */
import { paramFromUnit, paramToUnit, type ParamSpec } from '../params';

/** Uno scalino al valore all'istante dato, o una rampa lineare che ci arriva. */
export interface ModEvent {
  readonly kind: 'set' | 'ramp';
  readonly value: number;
  /** Secondi del contesto audio. */
  readonly time: number;
}

/** Gli eventi di un parametro nel tempo, con le regole degli AudioParam: una rampa parte dal
 *  valore e dall'istante dell'evento prima; a parità di istante vale l'ultimo arrivato. */
export class ModTimeline {
  private events: ModEvent[] = [];
  /** L'ultimo evento passato (da cui parte una rampa). */
  private last: { time: number; value: number };

  constructor(neutral: number) {
    this.last = { time: -Infinity, value: neutral };
  }

  add(e: ModEvent): void {
    // dopo quelli con lo stesso istante: di solito arrivano in ordine e finiscono in coda
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].time > e.time) i--;
    this.events.splice(i, 0, e);
  }

  /** Da `time` resta il valore che c'è; ciò che era programmato dopo si dimentica. */
  hold(time: number): void {
    const value = this.evaluate(time);
    this.events = this.events.filter(e => e.time < time);
    this.add({ kind: 'set', value, time });
  }

  /** Il valore all'istante `time` (che va solo avanti): gli eventi passati si dimenticano. */
  valueAt(time: number): number {
    let n = 0;
    while (n < this.events.length && this.events[n].time <= time) this.last = this.events[n++];
    if (n) this.events.splice(0, n);
    return this.evaluate(time);
  }

  /** Vero se ci sono eventi ancora da arrivare. */
  get pending(): boolean {
    return this.events.length > 0;
  }

  private evaluate(time: number): number {
    let prev = this.last;
    for (const e of this.events) {
      if (e.time > time) {
        const ramping = e.kind === 'ramp' && Number.isFinite(prev.time) && e.time > prev.time;
        return ramping ? prev.value + ((e.value - prev.value) * (time - prev.time)) / (e.time - prev.time) : prev.value;
      }
      prev = e;
    }
    return prev.value;
  }
}

/** I parametri di un dispositivo con le modulazioni: i valori delle manopole (`base`) più gli
 *  spostamenti nel tempo, in frazioni della corsa della manopola (−1 … +1). */
export class ParamModulation {
  private base: Readonly<Record<string, number>>;
  private readonly lines = new Map<string, ModTimeline>();
  /** Gli spostamenti usati per ultimi, diversi da zero. */
  private readonly offsets = new Map<string, number>();
  private dirty = true;

  constructor(private readonly specs: ReadonlyMap<string, ParamSpec>, base: Readonly<Record<string, number>>) {
    this.base = base;
  }

  setBase(params: Readonly<Record<string, number>>): void {
    this.base = params;
    this.dirty = true;
  }

  /** Un evento per un parametro del dispositivo (gli sconosciuti si ignorano); 'hold' tiene il
   *  valore da lì. */
  event(param: string, kind: ModEvent['kind'] | 'hold', value: number, time: number): void {
    if (!this.specs.has(param)) return;
    let line = this.lines.get(param);
    if (!line) this.lines.set(param, (line = new ModTimeline(0)));
    if (kind === 'hold') line.hold(time);
    else line.add({ kind, value, time });
  }

  /** I parametri da dare al motore all'istante `time`, o null se non sono cambiati. */
  paramsAt(time: number): Readonly<Record<string, number>> | null {
    let changed = this.dirty;
    for (const [param, line] of this.lines) {
      const v = line.valueAt(time);
      if (Math.abs(v - (this.offsets.get(param) ?? 0)) > 1e-6) {
        changed = true;
        if (v === 0) this.offsets.delete(param);
        else this.offsets.set(param, v);
      }
      // finita e a riposo: non serve più
      if (!line.pending && v === 0) this.lines.delete(param);
    }
    if (!changed) return null;
    this.dirty = false;
    if (!this.offsets.size) return this.base;
    const out: Record<string, number> = { ...this.base };
    for (const [param, offset] of this.offsets) {
      const spec = this.specs.get(param)!;
      out[param] = paramFromUnit(spec, paramToUnit(spec, out[param] ?? spec.default) + offset);
    }
    return out;
  }
}
