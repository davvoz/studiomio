/* The modulation of the devices' parameters, in the AudioWorklet. The main thread sends
 * for each parameter steps and ramps with their instant, as with an AudioParam; here the
 * offset is computed at each block and added to the knob's value. Pure: it's also tested
 * in Node. */
import { paramFromUnit, paramToUnit, type ParamSpec } from '../params';

/** A step to the value at the given instant, or a linear ramp reaching it. */
export interface ModEvent {
  readonly kind: 'set' | 'ramp';
  readonly value: number;
  /** Seconds of the audio context. */
  readonly time: number;
}

/** A parameter's events over time, with the AudioParam rules: a ramp starts from the
 *  value and instant of the previous event; at equal instants the last to arrive wins. */
export class ModTimeline {
  private events: ModEvent[] = [];
  /** The last past event (where a ramp starts from). */
  private last: { time: number; value: number };

  constructor(neutral: number) {
    this.last = { time: -Infinity, value: neutral };
  }

  add(e: ModEvent): void {
    // after those with the same instant: usually they arrive in order and end up at the end
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].time > e.time) i--;
    this.events.splice(i, 0, e);
  }

  /** From `time` the current value stays; what was scheduled after is forgotten. */
  hold(time: number): void {
    const value = this.evaluate(time);
    this.events = this.events.filter(e => e.time < time);
    this.add({ kind: 'set', value, time });
  }

  /** The value at instant `time` (which only goes forward): past events are forgotten. */
  valueAt(time: number): number {
    let n = 0;
    while (n < this.events.length && this.events[n].time <= time) this.last = this.events[n++];
    if (n) this.events.splice(0, n);
    return this.evaluate(time);
  }

  /** The value at instant `time` without forgetting anything (it can also be asked backwards, as far as
   *  the events haven't already been forgotten by `valueAt`). */
  peek(time: number): number {
    return this.evaluate(time);
  }

  /** True if there are still events to come. */
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

/** A device's parameters with the modulations: the knob values (`base`) plus the
 *  offsets over time, in fractions of the knob's travel (−1 … +1). Each source (the clip
 *  curves, each target of an LFO or an envelope) has its own channel: the offsets
 *  of a parameter's channels are summed. */
export class ParamModulation {
  private base: Readonly<Record<string, number>>;
  /** Per channel (see `lineKey`): the parameter and its events. */
  private readonly lines = new Map<string, { readonly param: string; readonly line: ModTimeline }>();
  /** The offsets used last, per channel, non-zero. */
  private readonly offsets = new Map<string, number>();
  private dirty = true;

  constructor(private readonly specs: ReadonlyMap<string, ParamSpec>, base: Readonly<Record<string, number>>) {
    this.base = base;
  }

  setBase(params: Readonly<Record<string, number>>): void {
    this.base = params;
    this.dirty = true;
  }

  /** An event for a parameter of the device (unknown ones are ignored) in the channel
   *  `channel` (absent: the clip curves' one); 'hold' holds the value from there. */
  event(param: string, kind: ModEvent['kind'] | 'hold', value: number, time: number, channel?: string): void {
    if (!this.specs.has(param)) return;
    const key = lineKey(param, channel);
    let entry = this.lines.get(key);
    if (!entry) this.lines.set(key, (entry = { param, line: new ModTimeline(0) }));
    if (kind === 'hold') entry.line.hold(time);
    else entry.line.add({ kind, value, time });
  }

  /** The parameters to give the engine at instant `time`, or null if they didn't change. */
  paramsAt(time: number): Readonly<Record<string, number>> | null {
    let changed = this.dirty;
    for (const [key, { line }] of this.lines) {
      const v = line.valueAt(time);
      if (Math.abs(v - (this.offsets.get(key) ?? 0)) > 1e-6) {
        changed = true;
        if (v === 0) this.offsets.delete(key);
        else this.offsets.set(key, v);
      }
      // finished and at rest: no longer needed
      if (!line.pending && v === 0) this.lines.delete(key);
    }
    if (!changed) return null;
    this.dirty = false;
    if (!this.offsets.size) return this.base;
    const sums = new Map<string, number>();
    for (const [key, offset] of this.offsets) {
      const param = paramOfKey(key);
      sums.set(param, (sums.get(param) ?? 0) + offset);
    }
    const out: Record<string, number> = { ...this.base };
    for (const [param, offset] of sums) {
      const spec = this.specs.get(param)!;
      out[param] = paramFromUnit(spec, paramToUnit(spec, out[param] ?? spec.default) + offset);
    }
    return out;
  }
}

/** A parameter's channel: the parameter's name (the clip curves) or "parameter␁channel". */
const SEPARATOR = '';
const lineKey = (param: string, channel: string | undefined): string => (channel ? `${param}${SEPARATOR}${channel}` : param);
const paramOfKey = (key: string): string => {
  const i = key.indexOf(SEPARATOR);
  return i < 0 ? key : key.slice(0, i);
};
