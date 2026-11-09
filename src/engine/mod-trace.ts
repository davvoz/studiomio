/* Where the modulations are now, for the interface: while a curve plays the parameter's knob
 * follows it. Each target remembers the steps and ramps scheduled on its
 * destination, with the AudioParam rules (the same ModTimeline as the worklet), and computes
 * the current value; what's past is forgotten. */
import { ModTimeline } from '../devices/worklet/mod-timeline';
import type { ModSink } from './modulation';

/** The traces of all the targets, by key; `now` is the audio context's time. A target
 *  can have more than one, one per source (the clip curves, each target of an LFO): they
 *  combine as in the sound. */
export class ModTraces {
  private readonly lines = new Map<string, ModTimeline>();
  /** Per target, the trace keys of the other sources. */
  private readonly channels = new Map<string, Set<string>>();

  constructor(private readonly now: () => number) {}

  /** The destination `inner` that also remembers what it receives, in trace `key` (with
   *  `channel`, the source's). */
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
    // even if nobody reads it, the trace throws away what's past
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

  /** The current value in trace `key`, or null if nothing ever arrived there. With the
   *  other sources: the offsets add up, the gains (`multiply`) multiply. */
  current(key: string, multiply = false): number | null {
    const now = this.now();
    let value = this.lines.get(key)?.valueAt(now) ?? null;
    for (const trace of this.channels.get(key) ?? []) {
      const v = this.lines.get(trace)!.valueAt(now);
      if (value === null) value = v;
      else value = multiply ? value * v : value + v;
    }
    return value;
  }
}
