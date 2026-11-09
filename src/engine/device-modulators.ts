/* The chain's modulators (LFO and Envelope, see devices/modulators) in the engine. For each
 * track (and for the master) a ChainModulators computes, window by window like the clip
 * curves, the value of each modulator on a dense grid and schedules it in advance with steps
 * and ramps on the targets: device parameters, macros, volume and pan. Each target
 * has its own channel, so the modulations add to the curves' instead of taking their
 * place. The envelopes (and the restarting LFOs) hear the notes of the track's clips, which
 * here are read as the player reads them. The modulators' own parameters can be moved
 * with the curves and with other modulators: they arrive here and are taken into account point by point. */
import type { DeviceId } from '../core/id';
import { paramSpec, resolveParams, type DeviceType } from '../devices/device-type';
import { pointsOf, type LfoPoint } from '../devices/instruments/prisma/shapes';
import { envValue, lfoUnit, type EnvTimes, type EnvTrigger } from '../devices/modulators/mod-shapes';
import { ENV_TRIG, ENVELOPE_DEVICE, LFO_TRIG, linkAmount, POLARITY, SYNC } from '../devices/modulators/modulators';
import { paramFromUnit, paramToUnit } from '../devices/params';
import { TEMPO_RATES } from '../devices/rates';
import { effectType } from '../devices/registry';
import { ModTimeline } from '../devices/worklet/mod-timeline';
import type { Placement } from '../model/arrangement';
import type { EffectSettings } from '../model/device';
import { targetKey, type ModTarget } from '../model/envelope';
import type { MidiClip } from '../model/midi-clip';
import { MidiTrack, type Track } from '../model/track';
import type { DeviceModulation, ModSink } from './modulation';
import { timeAtClock, type ScheduledSource, type ScheduleWindow } from './scheduler';
import { placementSegments, type Segment } from './segments';
import type { Program } from './session';
import { piecesInWindow } from './track-content';

/** Where a modulator's target goes, in its channel. */
export type ModSinkOf = (target: ModTarget, channel: string) => ModSink | null;

/** The channel of target `slot` (from 0) of modulator `id`. */
export const modChannel = (id: DeviceId, slot: number): string => `${id}/${slot}`;

/** The grid: a point every so often (seconds), dense for fast LFOs, sparse for slow ones. */
const LFO_STEP_MIN = 0.003, LFO_STEP_MAX = 0.03, LFO_STEPS_PER_CYCLE = 48;
const ENV_STEP = 0.004;
/** Below this difference two points in a row count as equal (a still stretch: no messages). */
const FLAT = 1e-5;
const EPS = 1e-9;
/** The past starts that are kept (for the levels the following ones restart from). */
const KEEP_TRIGGERS = 8;

/** The value reaching the target for a knob offset `x`: the volume is a
 *  gain (squared, as the fader is heard) that doesn't exceed the fader's. */
function sinkValue(target: ModTarget, x: number): number {
  if (target.kind === 'mixer' && target.param === 'volume') {
    const g = Math.max(0, Math.min(1, 1 + x));
    return g * g;
  }
  return x;
}

const neutralOf = (target: ModTarget) => (target.kind === 'mixer' && target.param === 'volume' ? 1 : 0);

/** A note of the track, in context seconds. */
interface Hit {
  readonly on: number;
  readonly off: number;
  readonly velocity: number;
}

/** A start: when, how loud and, for the envelopes, its curve. */
interface Trigger extends Hit {
  readonly env: EnvTrigger | null;
  /** For the random shapes of the restarting LFOs: each start has its own values. */
  readonly seed: number;
}

/** A modulator of the chain, with the modulations reaching its parameters. */
class Modulator {
  settings: EffectSettings;
  values: Record<string, number>;
  points: LfoPoint[];
  readonly type: DeviceType;
  triggers: Trigger[] = [];
  /** The modulations of its parameters (curves, macros, other modulators), per channel. */
  private readonly lines = new Map<string, { readonly param: string; readonly line: ModTimeline }>();
  readonly modulation: DeviceModulation = {
    sink: (param, channel) => {
      const key = channel ? `${param}|${channel}` : param;
      const line = () => {
        let entry = this.lines.get(key);
        if (!entry) this.lines.set(key, (entry = { param, line: new ModTimeline(0) }));
        return entry.line;
      };
      return {
        set: (value, time) => line().add({ kind: 'set', value, time }),
        ramp: (value, time) => line().add({ kind: 'ramp', value, time }),
        hold: time => line().hold(time),
      };
    },
  };

  constructor(settings: EffectSettings, type: DeviceType) {
    this.type = type;
    this.settings = settings;
    this.values = resolveParams(type, settings.params);
    this.points = pointsOf(this.values, 1);
  }

  update(settings: EffectSettings): void {
    if (settings.params !== this.settings.params) {
      this.values = resolveParams(this.type, settings.params);
      this.points = pointsOf(this.values, 1);
    }
    this.settings = settings;
  }

  get isEnvelope(): boolean {
    return this.type === ENVELOPE_DEVICE;
  }

  /** The parameter at instant `t`: the knob plus the modulations reaching it. */
  param(id: string, t: number): number {
    const base = this.values[id];
    if (!this.lines.size) return base;
    let offset = 0;
    for (const { param, line } of this.lines.values()) if (param === id) offset += line.peek(t);
    if (Math.abs(offset) < EPS) return base;
    const spec = paramSpec(this.type, id)!;
    return paramFromUnit(spec, paramToUnit(spec, base) + offset);
  }

  /** What's past is forgotten (the parameters' modulations, the old starts). */
  forget(now: number): void {
    for (const [key, { line }] of this.lines) {
      const v = line.valueAt(now);
      if (!line.pending && v === 0) this.lines.delete(key);
    }
    const past = this.triggers.filter(g => g.on < now).length;
    if (past > KEEP_TRIGGERS) this.triggers.splice(0, past - KEEP_TRIGGERS);
  }

  /** The last start within `t`. */
  triggerAt(t: number): Trigger | null {
    for (let i = this.triggers.length - 1; i >= 0; i--) if (this.triggers[i].on <= t) return this.triggers[i];
    return null;
  }

  /** The starts of what plays from `at` on are forgotten (rescheduling). */
  dropFrom(at: number): void {
    this.triggers = this.triggers.filter(g => g.on < at);
  }

  /** The envelope's times at instant `t`. */
  envTimes(t: number): EnvTimes {
    const p = (id: string) => this.param(id, t);
    return {
      attack: p('e1A'), hold: p('e1H'), decay: p('e1D'), sustain: p('e1S') / 100, release: p('e1R'),
      attackCurve: p('e1Ac'), decayCurve: p('e1Dc'), releaseCurve: p('e1Rc'),
    };
  }

  /** Adds the starts `hits` (in order). */
  addTriggers(hits: readonly Hit[]): void {
    for (const h of hits) {
      const last = this.triggers[this.triggers.length - 1];
      // after a rescheduling the starts arrive again: those already seen aren't repeated
      if (last && h.on < last.on + EPS) continue;
      let env: EnvTrigger | null = null;
      if (this.isEnvelope) {
        const sens = this.param('vel', h.on) / 100;
        const level = 1 - sens * (1 - h.velocity / 127);
        const prev = this.triggerAt(h.on);
        const now = prev?.env ? envValue(prev.env, h.on) : 0;
        env = { on: h.on, off: h.off, from: level > 0 ? Math.min(1, now / level) : 0, level, times: this.envTimes(h.on) };
      }
      this.triggers.push({ ...h, env, seed: Math.round(h.on * 1000) });
    }
  }
}

/** What a chain's modulators must know about the window: where the beats are and how long
 *  a beat lasts. */
interface Grid {
  readonly w: ScheduleWindow;
  readonly secondsPerBeat: number;
}

/** The modulators of a chain (track or master): a scheduler source. */
export class ChainModulators implements ScheduledSource {
  private readonly mods = new Map<DeviceId, Modulator>();
  private order: readonly DeviceId[] = [];
  private track: Track | null = null;
  private readonly segments = new WeakMap<Placement, Segment[]>();
  /** The targets already touched, to bring them back to neutral. */
  private readonly touched = new Map<string, { readonly target: ModTarget; readonly sink: ModSink }>();
  private stale = false;

  constructor(
    private readonly sinkOf: ModSinkOf,
    private readonly now: () => number,
    private readonly programs: () => readonly Program[] = () => [],
  ) {}

  /** The modulators of the chain `effects` (the track, for the notes); true if something
   *  audible changed (then it has to be rescheduled). */
  update(effects: readonly EffectSettings[], track: Track | null): boolean {
    this.track = track;
    let changed = false;
    const order: DeviceId[] = [];
    for (const e of effects) {
      const type = effectType(e.type);
      if (!type?.modulator) continue;
      order.push(e.id);
      const m = this.mods.get(e.id);
      if (m && m.type === type) {
        if (m.settings !== e) {
          m.update(e);
          changed = true;
        }
      } else {
        this.mods.set(e.id, new Modulator(e, type));
        changed = true;
      }
    }
    for (const id of this.mods.keys()) {
      if (!order.includes(id)) {
        this.mods.delete(id);
        changed = true;
      }
    }
    this.order = order;
    return changed;
  }

  /** True if the chain has at least one modulator. */
  get active(): boolean {
    return this.order.length > 0;
  }

  /** The modulations of the parameters of modulator `id` (the curves moving it), if it's here. */
  modulation(id: DeviceId): DeviceModulation | undefined {
    return this.mods.get(id)?.modulation;
  }

  schedule(w: ScheduleWindow): void {
    if (w.to - w.from <= EPS) return;
    const t0 = w.timeAt(w.from), t1 = w.timeAt(w.to);
    if (this.stale) {
      // all neutral from the start of the window: those still playing take their place right away
      this.stale = false;
      for (const { target, sink } of this.touched.values()) sink.set(neutralOf(target), t0);
    }
    if (!this.order.length) return;
    const grid: Grid = { w, secondsPerBeat: (t1 - t0) / (w.to - w.from) };
    let hits: Hit[] | null = null;
    const now = this.now();
    for (const id of this.order) {
      const m = this.mods.get(id)!;
      m.forget(now);
      if (!m.settings.enabled || !m.settings.targets?.some(t => t)) continue;
      const trig = m.values.trig;
      const byNotes = m.isEnvelope ? trig === ENV_TRIG.note : trig !== LFO_TRIG.free;
      if (byNotes) m.addTriggers((hits ??= this.notes(w)));
      else if (m.isEnvelope) m.addTriggers(tempoHits(m, w));
      this.play(m, grid);
    }
  }

  /** Rescheduling: what was scheduled is forgotten, the current value stays until
   *  the new windows pick it up again. */
  stopAll(): void {
    this.retake(this.now());
  }

  retake(at: number): void {
    for (const { sink } of this.touched.values()) sink.hold(at);
    for (const m of this.mods.values()) m.dropFrom(at);
    this.stale = this.touched.size > 0;
  }

  /** Transport stopped: everything neutral right away. */
  reset(): void {
    const t = this.now();
    for (const { target, sink } of this.touched.values()) {
      sink.hold(t);
      sink.set(neutralOf(target), t);
    }
    this.touched.clear();
    for (const m of this.mods.values()) m.triggers = [];
    this.stale = false;
  }

  /** Modulator `m` in the window: its values on the grid, then to each target. */
  private play(m: Modulator, grid: Grid): void {
    const { w } = grid;
    const t0 = w.timeAt(w.from), t1 = w.timeAt(w.to);
    const times = m.isEnvelope ? envGrid(m, t0, t1) : lfoGrid(m, grid, t0, t1);
    const depth = times.map(t => m.param('depth', t) / 100);
    const bipolar = m.values.pol === POLARITY.bi;
    const shape = times.map((t, i) => {
      const u = m.isEnvelope ? envAt(m, t) : lfoAt(m, grid, t);
      return (bipolar ? 2 * u - 1 : u) * depth[i];
    });
    (m.settings.targets ?? []).forEach((target, slot) => {
      if (!target) return;
      const channel = modChannel(m.settings.id, slot);
      const amount = linkAmount(slot + 1);
      const sink = this.sinkFor(target, channel);
      if (!sink) return;
      emit(sink, times, times.map((t, i) => sinkValue(target, (m.param(amount, t) / 100) * shape[i])));
    });
  }

  private sinkFor(target: ModTarget, channel: string): ModSink | null {
    const sink = this.sinkOf(target, channel);
    if (sink) this.touched.set(`${targetKey(target)}|${channel}`, { target, sink });
    return sink;
  }

  /** The notes starting in the window, from the track's clips (as the player plays them). */
  private notes(w: ScheduleWindow): Hit[] {
    const track = this.track;
    if (!(track instanceof MidiTrack)) return [];
    const out: Hit[] = [];
    for (const { clip, start, end, contentStart } of piecesInWindow<MidiClip>(track, this.programs(), w, p => this.segmentsOf(p))) {
      const from = Math.max(w.from + w.shift, start), to = Math.min(w.to + w.shift, end);
      if (to <= from) continue;
      const c0 = contentStart + (from - start), c1 = contentStart + (to - start);
      for (const n of clip.notesIn(c0, c1)) {
        const at = start + (n.start - contentStart);
        out.push({ on: timeAtClock(w, at), off: timeAtClock(w, Math.min(at + n.duration, end)), velocity: n.velocity });
      }
    }
    return out.sort((a, b) => a.on - b.on);
  }

  private segmentsOf(p: Placement<MidiClip>): Segment[] {
    let s = this.segments.get(p);
    if (!s) this.segments.set(p, (s = placementSegments(p)));
    return s;
  }
}

/** An envelope's synced starts in the window: one at every division of the bar,
 *  held for `gate` of the division. */
function tempoHits(m: Modulator, w: ScheduleWindow): Hit[] {
  const div = TEMPO_RATES[m.values.division]?.[1] ?? 1;
  const out: Hit[] = [];
  for (let k = Math.ceil(w.from / div - EPS); k * div < w.to - EPS; k++) {
    const b = k * div, on = w.timeAt(b);
    const gate = Math.max(0, Math.min(1, m.param('gate', on) / 100));
    out.push({ on, off: w.timeAt(b + gate * div), velocity: 127 });
  }
  return out;
}

/** The envelope at instant `t` (0…1): the last start, or nothing. */
function envAt(m: Modulator, t: number): number {
  const g = m.triggerAt(t);
  return g?.env ? envValue(g.env, t) : 0;
}

/** How many beats a cycle of the synced LFO lasts (null if it runs in Hz). */
const lfoBeats = (m: Modulator): number | null =>
  (m.values.sync === SYNC.tempo ? TEMPO_RATES[m.values.division]?.[1] ?? 1 : null);

/** The LFO at instant `t` (0…1). Free: synced it locks to the bar, in Hz to the
 *  context's clock. With the notes it restarts at every note, after the delay, and rises in `rise` seconds; "once"
 *  does one cycle and stays on the last value. */
function lfoAt(m: Modulator, grid: Grid, t: number): number {
  const beats = lfoBeats(m), phase = m.param('phase', t) / 360, shape = m.values.l1Shape;
  const trig = m.values.trig;
  const cyclesIn = (seconds: number) => (beats !== null ? seconds / (beats * grid.secondsPerBeat) : seconds * m.param('rate', t));
  const g = trig === LFO_TRIG.free ? null : m.triggerAt(t);
  if (!g) {
    // free, or before the first note: it runs by itself
    const w = grid.w;
    const cycles = beats !== null ? (w.from + (t - w.timeAt(w.from)) / grid.secondsPerBeat) / beats : t * m.param('rate', t);
    return lfoUnit(shape, m.points, cycles + phase);
  }
  const elapsed = t - g.on - m.param('delay', t);
  if (elapsed < 0) return 0;
  let cycles = cyclesIn(elapsed);
  if (trig === LFO_TRIG.once) cycles = Math.min(cycles, 1 - 1e-9);
  const rise = m.param('rise', t);
  const fade = rise > 0.002 ? Math.min(1, elapsed / rise) : 1;
  return fade * lfoUnit(shape, m.points, cycles + phase, g.seed);
}

/** An LFO's grid in [t0, t1]: a point every 1/48 of a cycle (between 3 and 30 ms). */
function lfoGrid(m: Modulator, grid: Grid, t0: number, t1: number): number[] {
  const beats = lfoBeats(m);
  const period = beats !== null ? beats * grid.secondsPerBeat : 1 / Math.max(1e-3, m.param('rate', t0));
  const step = Math.max(LFO_STEP_MIN, Math.min(LFO_STEP_MAX, period / LFO_STEPS_PER_CYCLE));
  const out: number[] = [];
  for (let t = t0; t < t1 - EPS; t += step) out.push(t);
  out.push(t1);
  return out;
}

/** An envelope's grid in [t0, t1]: a point every 4 ms, plus the corners of each start
 *  (start, end of the attack and of the hold, release), so nothing gets smoothed. */
function envGrid(m: Modulator, t0: number, t1: number): number[] {
  const out: number[] = [];
  for (let t = t0; t < t1 - EPS; t += ENV_STEP) out.push(t);
  out.push(t1);
  for (const g of m.triggers) {
    if (!g.env) continue;
    const e = g.env.times;
    for (const c of [g.on, g.on + e.attack, g.on + e.attack + e.hold, g.off]) if (c > t0 + EPS && c < t1 - EPS) out.push(c);
  }
  return out.sort((a, b) => a - b);
}

/** The values `values` at the instants `times` on the target: a step at the first, then ramps;
 *  the still stretches send nothing (only the point where they end). */
function emit(sink: ModSink, times: readonly number[], values: readonly number[]): void {
  sink.set(values[0], times[0]);
  let prevT = times[0], prevV = values[0], held = false;
  for (let i = 1; i < times.length; i++) {
    const v = values[i], t = times[i];
    if (Math.abs(v - prevV) < FLAT) held = true;
    else {
      if (held) sink.ramp(prevV, prevT);
      sink.ramp(v, t);
      held = false;
    }
    prevT = t;
    prevV = v;
  }
  if (held) sink.ramp(prevV, prevT);
}
