/* I modulatori della catena (LFO e Inviluppo, vedi devices/modulators) nel motore. Per ogni
 * traccia (e per il master) un ChainModulators calcola, finestra per finestra come le curve delle
 * clip, il valore di ogni modulatore su una griglia fitta e lo programma in anticipo con scalini
 * e rampe sulle destinazioni: parametri dei dispositivi, macro, volume e pan. Ogni destinazione
 * ha il suo canale, così le modulazioni si sommano a quelle delle curve invece di prenderne il
 * posto. Gli inviluppi (e gli LFO che ripartono) sentono le note delle clip della traccia, che
 * qui si leggono come le legge il player. I parametri dei modulatori stessi si possono muovere
 * con le curve e con altri modulatori: arrivano qui e se ne tiene conto punto per punto. */
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

/** Dove va la destinazione di un modulatore, nel suo canale. */
export type ModSinkOf = (target: ModTarget, channel: string) => ModSink | null;

/** Il canale della destinazione `slot` (da 0) del modulatore `id`. */
export const modChannel = (id: DeviceId, slot: number): string => `${id}/${slot}`;

/** La griglia: un punto ogni tanto (secondi), fitta per gli LFO veloci, rada per quelli lenti. */
const LFO_STEP_MIN = 0.003, LFO_STEP_MAX = 0.03, LFO_STEPS_PER_CYCLE = 48;
const ENV_STEP = 0.004;
/** Sotto questa differenza due punti di fila valgono uguali (un tratto fermo: niente messaggi). */
const FLAT = 1e-5;
const EPS = 1e-9;
/** Le partenze passate che si tengono (per i livelli da cui ripartono le successive). */
const KEEP_TRIGGERS = 8;

/** Il valore che arriva alla destinazione per uno spostamento `x` della manopola: il volume è un
 *  guadagno (al quadrato, come il fader si sente) che non supera quello del fader. */
function sinkValue(target: ModTarget, x: number): number {
  if (target.kind === 'mixer' && target.param === 'volume') {
    const g = Math.max(0, Math.min(1, 1 + x));
    return g * g;
  }
  return x;
}

const neutralOf = (target: ModTarget) => (target.kind === 'mixer' && target.param === 'volume' ? 1 : 0);

/** Una nota della traccia, in secondi del contesto. */
interface Hit {
  readonly on: number;
  readonly off: number;
  readonly velocity: number;
}

/** Una partenza: quando, quanto forte e, per gli inviluppi, la sua curva. */
interface Trigger extends Hit {
  readonly env: EnvTrigger | null;
  /** Per le forme casuali degli LFO che ripartono: ogni partenza ha i suoi valori. */
  readonly seed: number;
}

/** Un modulatore della catena, con le modulazioni che arrivano ai suoi parametri. */
class Modulator {
  settings: EffectSettings;
  values: Record<string, number>;
  points: LfoPoint[];
  readonly type: DeviceType;
  triggers: Trigger[] = [];
  /** Le modulazioni dei suoi parametri (curve, macro, altri modulatori), per canale. */
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

  /** Il parametro all'istante `t`: la manopola più le modulazioni che gli arrivano. */
  param(id: string, t: number): number {
    const base = this.values[id];
    if (!this.lines.size) return base;
    let offset = 0;
    for (const { param, line } of this.lines.values()) if (param === id) offset += line.peek(t);
    if (Math.abs(offset) < EPS) return base;
    const spec = paramSpec(this.type, id)!;
    return paramFromUnit(spec, paramToUnit(spec, base) + offset);
  }

  /** Ciò che è passato si dimentica (le modulazioni dei parametri, le partenze vecchie). */
  forget(now: number): void {
    for (const [key, { line }] of this.lines) {
      const v = line.valueAt(now);
      if (!line.pending && v === 0) this.lines.delete(key);
    }
    const past = this.triggers.filter(g => g.on < now).length;
    if (past > KEEP_TRIGGERS) this.triggers.splice(0, past - KEEP_TRIGGERS);
  }

  /** L'ultima partenza entro `t`. */
  triggerAt(t: number): Trigger | null {
    for (let i = this.triggers.length - 1; i >= 0; i--) if (this.triggers[i].on <= t) return this.triggers[i];
    return null;
  }

  /** Le partenze di ciò che suona da `at` in poi si dimenticano (riprogrammazione). */
  dropFrom(at: number): void {
    this.triggers = this.triggers.filter(g => g.on < at);
  }

  /** I tempi dell'inviluppo all'istante `t`. */
  envTimes(t: number): EnvTimes {
    const p = (id: string) => this.param(id, t);
    return {
      attack: p('e1A'), hold: p('e1H'), decay: p('e1D'), sustain: p('e1S') / 100, release: p('e1R'),
      attackCurve: p('e1Ac'), decayCurve: p('e1Dc'), releaseCurve: p('e1Rc'),
    };
  }

  /** Aggiunge le partenze `hits` (in ordine). */
  addTriggers(hits: readonly Hit[]): void {
    for (const h of hits) {
      const last = this.triggers[this.triggers.length - 1];
      // dopo una riprogrammazione le partenze arrivano di nuovo: quelle già viste non si ripetono
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

/** Cosa i modulatori di una catena devono sapere della finestra: dove sono i battiti e quanto
 *  dura un battito. */
interface Grid {
  readonly w: ScheduleWindow;
  readonly secondsPerBeat: number;
}

/** I modulatori di una catena (traccia o master): una sorgente dello scheduler. */
export class ChainModulators implements ScheduledSource {
  private readonly mods = new Map<DeviceId, Modulator>();
  private order: readonly DeviceId[] = [];
  private track: Track | null = null;
  private readonly segments = new WeakMap<Placement, Segment[]>();
  /** Le destinazioni già toccate, per riportarle neutre. */
  private readonly touched = new Map<string, { readonly target: ModTarget; readonly sink: ModSink }>();
  private stale = false;

  constructor(
    private readonly sinkOf: ModSinkOf,
    private readonly now: () => number,
    private readonly programs: () => readonly Program[] = () => [],
  ) {}

  /** I modulatori della catena `effects` (la traccia, per le note); vero se è cambiato qualcosa
   *  che si sente (allora va riprogrammato). */
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

  /** Vero se nella catena c'è almeno un modulatore. */
  get active(): boolean {
    return this.order.length > 0;
  }

  /** Le modulazioni dei parametri del modulatore `id` (le curve che lo muovono), se è qui. */
  modulation(id: DeviceId): DeviceModulation | undefined {
    return this.mods.get(id)?.modulation;
  }

  schedule(w: ScheduleWindow): void {
    if (w.to - w.from <= EPS) return;
    const t0 = w.timeAt(w.from), t1 = w.timeAt(w.to);
    if (this.stale) {
      // tutti neutri dall'inizio della finestra: quelli che suonano ancora prendono subito il posto
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

  /** Riprogrammazione: ciò che era programmato si dimentica, il valore di adesso resta finché
   *  le finestre nuove non lo riprendono. */
  stopAll(): void {
    this.retake(this.now());
  }

  retake(at: number): void {
    for (const { sink } of this.touched.values()) sink.hold(at);
    for (const m of this.mods.values()) m.dropFrom(at);
    this.stale = this.touched.size > 0;
  }

  /** Trasporto fermo: tutto neutro da subito. */
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

  /** Il modulatore `m` nella finestra: i suoi valori sulla griglia, poi a ogni destinazione. */
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

  /** Le note che partono nella finestra, dalle clip della traccia (come le suona il player). */
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

/** Le partenze a tempo di un inviluppo nella finestra: una a ogni divisione della battuta,
 *  tenuta per `gate` della divisione. */
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

/** L'inviluppo all'istante `t` (0…1): l'ultima partenza, o niente. */
function envAt(m: Modulator, t: number): number {
  const g = m.triggerAt(t);
  return g?.env ? envValue(g.env, t) : 0;
}

/** Quanti battiti dura un giro dell'LFO a tempo (null se va in Hz). */
const lfoBeats = (m: Modulator): number | null =>
  (m.values.sync === SYNC.tempo ? TEMPO_RATES[m.values.division]?.[1] ?? 1 : null);

/** L'LFO all'istante `t` (0…1). Libero: a tempo si aggancia alla battuta, in Hz all'orologio del
 *  contesto. Con le note riparte a ogni nota, dopo il ritardo, e sale in `rise` secondi; "una
 *  volta" fa un giro e resta sull'ultimo valore. */
function lfoAt(m: Modulator, grid: Grid, t: number): number {
  const beats = lfoBeats(m), phase = m.param('phase', t) / 360, shape = m.values.l1Shape;
  const trig = m.values.trig;
  const cyclesIn = (seconds: number) => (beats !== null ? seconds / (beats * grid.secondsPerBeat) : seconds * m.param('rate', t));
  const g = trig === LFO_TRIG.free ? null : m.triggerAt(t);
  if (!g) {
    // libero, o prima della prima nota: gira da solo
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

/** La griglia di un LFO in [t0, t1]: un punto ogni 1/48 di giro (tra 3 e 30 ms). */
function lfoGrid(m: Modulator, grid: Grid, t0: number, t1: number): number[] {
  const beats = lfoBeats(m);
  const period = beats !== null ? beats * grid.secondsPerBeat : 1 / Math.max(1e-3, m.param('rate', t0));
  const step = Math.max(LFO_STEP_MIN, Math.min(LFO_STEP_MAX, period / LFO_STEPS_PER_CYCLE));
  const out: number[] = [];
  for (let t = t0; t < t1 - EPS; t += step) out.push(t);
  out.push(t1);
  return out;
}

/** La griglia di un inviluppo in [t0, t1]: un punto ogni 4 ms, più gli spigoli di ogni partenza
 *  (inizio, fine dell'attacco e dell'hold, rilascio), così niente si smussa. */
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

/** I valori `values` agli istanti `times` sulla destinazione: uno scalino al primo, poi rampe;
 *  i tratti fermi non mandano niente (solo il punto dove finiscono). */
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
