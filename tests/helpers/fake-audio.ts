import type { Instrument, InstrumentHost } from '../../src/engine/players/instrument';
import type { Effect, EffectHost } from '../../src/engine/effect-chain';
import type { Meter, MeterHost, MeterReading } from '../../src/engine/meters';
import type { EffectSettings, InstrumentSettings } from '../../src/model/device';
import type {
  AudioBufferLike, AudioGraph, AudioNodeLike, AudioParamLike, BufferSourceNodeLike, GainNodeLike,
  OscillatorNodeLike, PannerNodeLike,
} from '../../src/engine/audio-graph';

/** Grafo audio finto: non suona, registra cosa viene creato, collegato e programmato. */

export class FakeParam implements AudioParamLike {
  readonly events: { type: string; value: number; time: number }[] = [];
  constructor(public value: number) {}
  setValueAtTime(value: number, time: number) { this.events.push({ type: 'set', value, time }); this.value = value; }
  linearRampToValueAtTime(value: number, time: number) { this.events.push({ type: 'ramp', value, time }); this.value = value; }
  setTargetAtTime(value: number, time: number) { this.events.push({ type: 'target', value, time }); this.value = value; }
  cancelScheduledValues() { /* niente */ }
}

export class FakeNode implements AudioNodeLike {
  readonly outputs: AudioNodeLike[] = [];
  connected = true;
  constructor(readonly kind: string) {}
  connect(d: AudioNodeLike) { this.outputs.push(d); return d; }
  disconnect() { this.connected = false; this.outputs.length = 0; }
}

export class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam(1);
  constructor() { super('gain'); }
}

export class FakePanner extends FakeNode implements PannerNodeLike {
  readonly pan = new FakeParam(0);
  constructor() { super('panner'); }
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
  /** Simula la fine naturale del nodo. */
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

  constructor(readonly sampleRate = 44100) {}

  createGain() { const g = new FakeGain(); this.gains.push(g); return g; }
  createStereoPanner() { const p = new FakePanner(); this.panners.push(p); return p; }
  createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s; }
  createOscillator() { const o = new FakeOscillator(); this.oscillators.push(o); return o; }
  createBuffer(c: number, l: number, sr: number) { return new FakeBuffer(c, l, sr); }

  /** Sorgenti avviate e non fermate prima di partire. */
  started() {
    return this.sources.filter(s => s.started && !(s.stoppedAt === -1));
  }
}

/** Strumento finto: registra note, parametri e stop. */
export class FakeInstrument implements Instrument {
  readonly output = new FakeGain();
  readonly notes: { pitch: number; velocity: number; when: number; duration: number }[] = [];
  readonly updates: InstrumentSettings[] = [];
  stops = 0;
  readonly cuts: number[] = [];
  disposed = false;
  constructor(readonly type: string) {}
  cut(at: number) { this.cuts.push(at); }
  play(pitch: number, velocity: number, when: number, duration: number) { this.notes.push({ pitch, velocity, when, duration }); }
  update(s: InstrumentSettings) { this.updates.push(s); }
  stopAll() { this.stops++; }
  dispose() { this.disposed = true; }
}

export class FakeInstruments implements InstrumentHost {
  readonly created: FakeInstrument[] = [];
  async prepare() {}
  async settle() {}
  create(_g: AudioGraph, s: InstrumentSettings) {
    const i = new FakeInstrument(s.type);
    this.created.push(i);
    return i;
  }
}

/** Effetto finto: registra aggiornamenti e tempo; ingresso e uscita sono nodi finti. */
export class FakeEffect implements Effect {
  readonly input = new FakeGain();
  readonly output = new FakeGain();
  readonly updates: EffectSettings[] = [];
  readonly tempos: number[] = [];
  disposed = false;
  constructor(readonly type: string, readonly settings: EffectSettings, readonly bpm: number) {}
  update(s: EffectSettings) { this.updates.push(s); }
  setTempo(bpm: number) { this.tempos.push(bpm); }
  dispose() { this.disposed = true; this.input.disconnect(); this.output.disconnect(); }
}

export class FakeEffects implements EffectHost {
  readonly created: FakeEffect[] = [];
  create(_g: AudioGraph, s: EffectSettings, bpm: number) {
    const e = new FakeEffect(s.type, s, bpm);
    this.created.push(e);
    return e;
  }
}

/** Misuratore finto: legge i livelli che il test gli dà. */
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
