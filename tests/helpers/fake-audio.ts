import { effectType } from '../../src/devices/registry';
import type { Instrument, InstrumentHost } from '../../src/engine/players/instrument';
import type { TransportAnchor } from '../../src/devices/worklet/transport-clock';
import type { Effect, EffectHost } from '../../src/engine/effect-chain';
import type { Meter, MeterHost, MeterReading } from '../../src/engine/meters';
import type { DeviceModulation, ModSink } from '../../src/engine/modulation';
import type { EffectSettings, InstrumentSettings } from '../../src/model/device';
import type {
  AudioBufferLike, AudioGraph, AudioNodeLike, AudioParamLike, BufferSourceNodeLike, ConstantSourceNodeLike, GainNodeLike,
  OscillatorNodeLike, PannerNodeLike,
} from '../../src/engine/audio-graph';

/** Fake audio graph: it doesn't play, it records what's created, connected and scheduled. */

export class FakeParam implements AudioParamLike {
  readonly events: { type: string; value: number; time: number }[] = [];
  constructor(public value: number) {}
  setValueAtTime(value: number, time: number) { this.events.push({ type: 'set', value, time }); this.value = value; }
  linearRampToValueAtTime(value: number, time: number) { this.events.push({ type: 'ramp', value, time }); this.value = value; }
  setTargetAtTime(value: number, time: number) { this.events.push({ type: 'target', value, time }); this.value = value; }
  cancelScheduledValues(time: number) { this.events.push({ type: 'cancel', value: NaN, time }); }
  cancelAndHoldAtTime(time: number) { this.events.push({ type: 'hold', value: NaN, time }); }
}

/** Fake modulations of a device: they record the events per parameter. */
export class FakeModulation implements DeviceModulation {
  readonly events: { param: string; type: string; value: number; time: number; channel?: string }[] = [];
  sink(param: string, channel?: string): ModSink {
    const c = channel ? { channel } : {};
    return {
      set: (value, time) => { this.events.push({ param, type: 'set', value, time, ...c }); },
      ramp: (value, time) => { this.events.push({ param, type: 'ramp', value, time, ...c }); },
      hold: time => { this.events.push({ param, type: 'hold', value: NaN, time, ...c }); },
    };
  }
}

export class FakeNode implements AudioNodeLike {
  readonly outputs: AudioNodeLike[] = [];
  connected = true;
  constructor(readonly kind: string) {}
  connect(d: AudioNodeLike) { this.outputs.push(d); return d; }
  /** Like Web Audio: with a destination it disconnects only that, and it's an error if it isn't connected. */
  disconnect(d?: AudioNodeLike) {
    if (!d) {
      this.connected = false;
      this.outputs.length = 0;
      return;
    }
    const i = this.outputs.indexOf(d);
    if (i < 0) throw new Error('InvalidAccessError: not connected');
    this.outputs.splice(i, 1);
  }
}

export class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam(1);
  constructor() { super('gain'); }
}

export class FakePanner extends FakeNode implements PannerNodeLike {
  readonly pan = new FakeParam(0);
  constructor() { super('panner'); }
}

export class FakeConstantSource implements ConstantSourceNodeLike {
  readonly offset = new FakeParam(1);
  readonly outputs: (AudioNodeLike | AudioParamLike)[] = [];
  started = false;
  connect(d: AudioNodeLike | AudioParamLike) { this.outputs.push(d); return d; }
  disconnect() { this.outputs.length = 0; }
  start() { this.started = true; }
}

export class FakeBuffer implements AudioBufferLike {
  readonly channels: Float32Array[];
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() { return this.length / this.sampleRate; }
  copyToChannel(source: Float32Array, channel: number) { this.channels[channel].set(source); }
}

abstract class FakeScheduled extends FakeNode {
  started: { when: number; offset?: number; duration?: number } | null = null;
  stoppedAt: number | null = null;
  onended: ((this: never, ev: Event) => unknown) | null = null;
  start(when = 0, offset?: number, duration?: number) { this.started = { when, offset, duration }; }
  stop(when?: number) { this.stoppedAt = when ?? -1; }
  /** Simulates the node's natural end. */
  end() { (this.onended as (() => void) | null)?.(); }
}

export class FakeSource extends FakeScheduled implements BufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  readonly playbackRate = new FakeParam(1);
  constructor() { super('source'); }
}

export class FakeOscillator extends FakeScheduled implements OscillatorNodeLike {
  type: OscillatorType = 'sine';
  readonly frequency = new FakeParam(440);
  constructor() { super('oscillator'); }
}

export class FakeGraph implements AudioGraph {
  currentTime = 0;
  readonly destination = new FakeNode('destination');
  readonly sources: FakeSource[] = [];
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  readonly panners: FakePanner[] = [];
  readonly constants: FakeConstantSource[] = [];

  constructor(readonly sampleRate = 44100) {}

  createGain() { const g = new FakeGain(); this.gains.push(g); return g; }
  createStereoPanner() { const p = new FakePanner(); this.panners.push(p); return p; }
  createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s; }
  createOscillator() { const o = new FakeOscillator(); this.oscillators.push(o); return o; }
  createConstantSource() { const c = new FakeConstantSource(); this.constants.push(c); return c; }
  createBuffer(c: number, l: number, sr: number) { return new FakeBuffer(c, l, sr); }

  /** Sources started and not stopped before starting. */
  started() {
    return this.sources.filter(s => s.started && !(s.stoppedAt === -1));
  }
}

/** Fake instrument: it records notes, parameters, tempo and stop. */
export class FakeInstrument implements Instrument {
  readonly output = new FakeGain();
  readonly tempos: number[] = [];
  readonly notes: { pitch: number; velocity: number; when: number; duration: number }[] = [];
  readonly updates: InstrumentSettings[] = [];
  stops = 0;
  readonly cuts: number[] = [];
  readonly modulation = new FakeModulation();
  disposed = false;
  constructor(readonly type: string, readonly bpm = 120) {}
  cut(at: number) { this.cuts.push(at); }
  readonly retakes: number[] = [];
  /** Like the real instrument: the notes from `at` on are gone. */
  retake(at: number) {
    this.retakes.push(at);
    this.notes.splice(0, this.notes.length, ...this.notes.filter(n => n.when < at));
  }
  setTempo(bpm: number) { this.tempos.push(bpm); }
  play(pitch: number, velocity: number, when: number, duration: number) { this.notes.push({ pitch, velocity, when, duration }); }
  /** The arpeggiator's latest parameters. */
  arp: Readonly<Record<string, number>> = {};
  setArp(params: Readonly<Record<string, number>>) { this.arp = params; }
  /** The notes held by hand now, by pitch, with their velocity. */
  readonly held = new Map<number, number>();
  press(pitch: number, velocity: number) { this.held.set(pitch, velocity); }
  release(pitch: number) { this.held.delete(pitch); }
  /** The instant of each update (undefined: right away). */
  readonly updateTimes: (number | undefined)[] = [];
  update(s: InstrumentSettings, at?: number) { this.updates.push(s); this.updateTimes.push(at); }
  stopAll() { this.stops++; }
  dispose() { this.disposed = true; }
}

export class FakeInstruments implements InstrumentHost {
  readonly created: FakeInstrument[] = [];
  async prepare() {}
  async settle() {}
  create(_g: AudioGraph, s: InstrumentSettings, bpm: number) {
    const i = new FakeInstrument(s.type, bpm);
    this.created.push(i);
    return i;
  }
}

/** Fake effect: it records updates and tempo; input and output are fake nodes (and the
 *  sidechain, for the types accepting it). */
export class FakeEffect implements Effect {
  readonly input = new FakeGain();
  readonly output = new FakeGain();
  readonly sidechain: FakeGain | undefined;
  readonly updates: EffectSettings[] = [];
  readonly tempos: number[] = [];
  readonly modulation = new FakeModulation();
  disposed = false;
  constructor(readonly type: string, readonly settings: EffectSettings, readonly bpm: number) {
    this.sidechain = effectType(type)?.sidechain ? new FakeGain() : undefined;
  }
  update(s: EffectSettings) { this.updates.push(s); }
  setTempo(bpm: number) { this.tempos.push(bpm); }
  dispose() { this.disposed = true; this.input.disconnect(); this.output.disconnect(); this.sidechain?.disconnect(); }
}

export class FakeEffects implements EffectHost {
  readonly created: FakeEffect[] = [];
  /** The transport anchors received (null: stopped). */
  readonly anchors: (TransportAnchor | null)[] = [];
  transport(_g: AudioGraph, anchor: TransportAnchor | null) { this.anchors.push(anchor); }
  create(_g: AudioGraph, s: EffectSettings, bpm: number) {
    const e = new FakeEffect(s.type, s, bpm);
    this.created.push(e);
    return e;
  }
}

/** Fake meter: it reads the levels the test gives it. */
export class FakeMeter implements Meter {
  readonly input = new FakeGain();
  readonly output = new FakeGain();
  next: MeterReading = { peak: [0, 0], rms: [0, 0] };
  disposed = false;
  read() { return this.next; }
  dispose() { this.disposed = true; this.input.disconnect(); this.output.disconnect(); }
}

export class FakeMeters implements MeterHost {
  readonly created: FakeMeter[] = [];
  create() {
    const m = new FakeMeter();
    this.created.push(m);
    return m;
  }
}
