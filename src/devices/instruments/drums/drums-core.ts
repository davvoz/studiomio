/* The Drum Machine's sound: each pad has two voices of its model (a new hit fades the previous one
 * out in a few milliseconds, without clicks) and the models are small classic
 * syntheses: sines with a pitch drop for kicks and toms, filtered noise for snare, clap
 * and shaker, six squares detuned from each other for hi-hats and cymbals (like the 808). The Sample model
 * plays the file loaded on the pad. A pad with an instrument (Kick, Snare, Hat and Cymbals) has
 * that instrument's engine inside, which receives the pad's parameters without the prefix. Runs
 * in the AudioWorklet; no Web Audio here, so it's also tested in Node. */
import { dbToGain, type InstrumentCore, type SampleData, type SamplePlayer } from '../../dsp/core';
import { decayCoef } from '../../dsp/envelope';
import { Noise } from '../../dsp/noise';
import { WAVE_TABLE } from '../../dsp/oscillators';
import { Svf } from '../../dsp/svf';
import { paramsOf, type DeviceType } from '../../device-type';
import { CymbalsCore } from '../cymbals/cymbals-core';
import { KickCore } from '../kick/kick-core';
import { SnareCore } from '../snare/snare-core';
import { DRUM_MODELS, DRUM_PADS, innerPrefix, padInstrument, padOfNote, padOfSlot, padsOf, splitInner, type DrumPad } from './drums';

/** Below this level a voice is finished (−100 dB). */
const FLOOR = 1e-5;
/** How long the fade of an interrupted hit lasts (new hit, choke, stop). */
const CHOKE_TIME = 0.004;
const LP = 0, BP = 1, HP = 2;
const TWO_PI = 2 * Math.PI;

/** What a hit must know about its pad, already converted. */
interface Hit {
  /** Frequency ratio from the pitch (1 = like the model). */
  readonly ratio: number;
  readonly decay: number;
  /** Tone and snap in 0..1. */
  readonly tone: number;
  readonly snap: number;
  /** The pad's sample (only the Sample model uses it), where it starts (0..1) and whether reversed. */
  readonly sample: SampleData | null;
  readonly start: number;
  readonly reverse: boolean;
}

/** Soft saturation keeping the peak at 1: `drive` 0 = clean. */
const saturate = (x: number, drive: number): number => {
  if (drive < 0.01) return x;
  const d = 1 + drive * 4;
  return Math.tanh(x * d) / Math.tanh(d);
};

/** A voice: the model gives one sample at a time (`next`) and keeps in `amp` the level of its
 *  main envelope; the base class does gain, pan and the fade when it's stopped. */
export abstract class DrumVoice {
  /** Level of the main envelope: below FLOOR the voice is finished. */
  protected amp = 0;
  protected gainL = 0;
  protected gainR = 0;
  private fade = 1;
  private choking = false;
  private readonly chokeK: number;

  constructor(protected readonly sampleRate: number) {
    this.chokeK = decayCoef(CHOKE_TIME, sampleRate);
  }

  get active(): boolean {
    return this.amp >= FLOOR && this.fade >= FLOOR;
  }

  trigger(hit: Hit, gainL: number, gainR: number): void {
    this.gainL = gainL;
    this.gainR = gainR;
    this.fade = 1;
    this.choking = false;
    this.start(hit);
  }

  /** Fades out in a few milliseconds. */
  choke(): void {
    if (this.active) this.choking = true;
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const { gainL, gainR } = this;
    for (let i = from; i < to; i++) {
      const v = this.next() * this.chokeGain();
      left[i] += v * gainL;
      right[i] += v * gainR;
      if (!this.active) break;
    }
  }

  /** The fade's gain, one sample at a time (1 if the voice isn't stopped). */
  protected chokeGain(): number {
    if (this.choking) this.fade *= this.chokeK;
    return this.fade;
  }

  protected abstract start(hit: Hit): void;
  protected abstract next(): number;
}

/** A sine with the pitch falling from `sweep` times the base frequency: kicks and toms. */
abstract class PitchedDrum extends DrumVoice {
  protected phase = 0;
  protected base = 50;
  protected sweep = 1;
  protected pitchEnv = 1;
  protected pitchK = 0;
  protected ampK = 0;

  protected sine(): number {
    this.pitchEnv *= this.pitchK;
    this.phase += (this.base * (1 + (this.sweep - 1) * this.pitchEnv)) / this.sampleRate;
    if (this.phase >= 1) this.phase -= 1;
    const v = Math.sin(TWO_PI * this.phase) * this.amp;
    this.amp *= this.ampK;
    return v;
  }

  protected tune(base: number, sweep: number, pitchTime: number, hit: Hit): void {
    this.phase = 0;
    this.amp = 1;
    this.pitchEnv = 1;
    this.base = base * hit.ratio;
    this.sweep = sweep;
    this.pitchK = decayCoef(pitchTime, this.sampleRate);
    this.ampK = decayCoef(hit.decay, this.sampleRate);
  }
}

class Kick extends PitchedDrum {
  private readonly noise = new Noise(11);
  private readonly clickFilter = new Svf(this.sampleRate);
  private click = 0;
  private clickK = decayCoef(0.008, this.sampleRate);
  private drive = 0;

  protected start(hit: Hit): void {
    this.tune(52, 1 + 5 * hit.snap, 0.035, hit);
    this.click = hit.snap * 0.6;
    this.drive = hit.tone;
    this.clickFilter.reset();
    this.clickFilter.set(3000, 0.1, LP);
  }

  protected next(): number {
    const click = this.clickFilter.process(this.noise.next()) * this.click;
    this.click *= this.clickK;
    return saturate(this.sine() + click, this.drive) * 0.95;
  }
}

class Boom extends PitchedDrum {
  private drive = 0;

  protected start(hit: Hit): void {
    this.tune(46, 1 + 2.2 * hit.snap, 0.09, hit);
    this.drive = hit.tone;
  }

  protected next(): number {
    return saturate(this.sine(), this.drive) * 0.95;
  }
}

class Tom extends PitchedDrum {
  private readonly noise = new Noise(23);
  private readonly skin = new Svf(this.sampleRate);
  private skinLevel = 0;
  private skinK = 0;

  protected start(hit: Hit): void {
    this.tune(120, 1 + 0.8 * hit.snap, 0.08, hit);
    this.skin.reset();
    this.skin.set(this.base * 3, 0.3, BP);
    this.skinLevel = hit.tone * 0.5;
    this.skinK = decayCoef(Math.min(hit.decay, 0.12), this.sampleRate);
  }

  protected next(): number {
    const skin = this.skin.process(this.noise.next()) * this.skinLevel;
    this.skinLevel *= this.skinK;
    return (this.sine() + skin) * 0.85;
  }
}

class Snare extends DrumVoice {
  private readonly noise = new Noise(31);
  private readonly hp = new Svf(this.sampleRate);
  private readonly lp = new Svf(this.sampleRate);
  private phaseA = 0;
  private phaseB = 0;
  private dtA = 0;
  private dtB = 0;
  private body = 0;
  private bodyK = 0;
  private ampK = 0;
  private bodyMix = 0;
  private noiseMix = 0;

  protected start(hit: Hit): void {
    this.phaseA = this.phaseB = 0;
    this.dtA = (185 * hit.ratio) / this.sampleRate;
    this.dtB = (330 * hit.ratio) / this.sampleRate;
    this.body = 1;
    this.amp = 1;
    this.bodyK = decayCoef(Math.min(0.12, hit.decay * 0.6), this.sampleRate);
    this.ampK = decayCoef(hit.decay, this.sampleRate);
    this.hp.reset();
    this.lp.reset();
    this.hp.set(900 + 4000 * hit.tone * hit.ratio, 0.15, HP);
    this.lp.set(6000 + 9000 * hit.tone, 0, LP);
    this.noiseMix = 0.25 + 0.75 * hit.snap;
    this.bodyMix = 1 - 0.5 * hit.snap;
  }

  protected next(): number {
    this.phaseA = (this.phaseA + this.dtA) % 1;
    this.phaseB = (this.phaseB + this.dtB) % 1;
    const body = (Math.sin(TWO_PI * this.phaseA) + 0.6 * Math.sin(TWO_PI * this.phaseB)) * 0.6 * this.body;
    const noise = this.lp.process(this.hp.process(this.noise.next())) * this.amp;
    this.body *= this.bodyK;
    this.amp *= this.ampK;
    return (body * this.bodyMix + noise * this.noiseMix * 2.6) * 0.8;
  }
}

/** Handclap: three closely spaced noise bursts, then the tail. */
class Clap extends DrumVoice {
  private static readonly GAP = 0.011;
  private readonly noise = new Noise(41);
  private readonly bp = new Svf(this.sampleRate);
  private n = 0;
  private gap = 0;
  private burst = 0;
  private burstK = decayCoef(0.012, this.sampleRate);
  private tail = 0;
  private tailK = 0;
  private burstMix = 0;

  protected start(hit: Hit): void {
    this.n = 0;
    this.gap = Math.round(Clap.GAP * this.sampleRate);
    this.burst = 0;
    this.tail = 0;
    this.amp = 1;
    this.tailK = decayCoef(hit.decay, this.sampleRate);
    this.bp.reset();
    this.bp.set(900 * hit.ratio * Math.pow(2, hit.tone * 1.6), 0.4, BP);
    this.burstMix = 0.4 + 0.6 * hit.snap;
  }

  protected next(): number {
    const { n, gap } = this;
    if (n < 3 * gap && n % gap === 0) this.burst = 1;
    if (n === 2 * gap) this.tail = 1;
    this.n++;
    const env = this.burst * this.burstMix + this.tail * 0.7;
    this.burst *= this.burstK;
    this.tail *= this.tailK;
    // until the tail starts the voice is alive
    this.amp = this.n <= 2 * gap ? 1 : this.tail;
    return this.bp.process(this.noise.next()) * env * 3.2;
  }
}

class Rim extends DrumVoice {
  private readonly noise = new Noise(53);
  private readonly hp = new Svf(this.sampleRate);
  private phaseA = 0;
  private phaseB = 0;
  private dtA = 0;
  private dtB = 0;
  private ampK = 0;
  private click = 0;
  private clickK = decayCoef(0.004, this.sampleRate);

  protected start(hit: Hit): void {
    this.phaseA = this.phaseB = 0;
    this.dtA = (1700 * hit.ratio) / this.sampleRate;
    this.dtB = (480 * hit.ratio) / this.sampleRate;
    this.amp = 1;
    this.ampK = decayCoef(hit.decay, this.sampleRate);
    this.click = hit.snap;
    this.hp.reset();
    this.hp.set(300 + 1500 * hit.tone, 0.1, HP);
  }

  protected next(): number {
    this.phaseA = (this.phaseA + this.dtA) % 1;
    this.phaseB = (this.phaseB + this.dtB) % 1;
    const v = (Math.sin(TWO_PI * this.phaseA) * 0.7 + Math.sin(TWO_PI * this.phaseB)) * this.amp + this.noise.next() * this.click;
    this.amp *= this.ampK;
    this.click *= this.clickK;
    return this.hp.process(v) * 0.7;
  }
}

/** The six frequencies of the 808's squares for hi-hats and cymbals. */
const METAL_HZ = [205.3, 304.4, 369.6, 522.7, 540, 800] as const;

/** Hi-hats and cymbals: six squares detuned from each other, band-pass and high-pass, plus noise. */
class Metal extends DrumVoice {
  private readonly noise = new Noise(67);
  private readonly bp = new Svf(this.sampleRate);
  private readonly hp = new Svf(this.sampleRate);
  private readonly phases = new Float64Array(METAL_HZ.length);
  private readonly steps = new Float64Array(METAL_HZ.length);
  private ampK = 0;
  private noiseMix = 0;

  constructor(sampleRate: number, private readonly center: number, private readonly cutoff: number, private readonly gain: number) {
    super(sampleRate);
  }

  protected start(hit: Hit): void {
    METAL_HZ.forEach((hz, i) => {
      this.phases[i] = (i * 0.37) % 1;
      this.steps[i] = (hz * hit.ratio * 1.2) / this.sampleRate;
    });
    this.amp = 1;
    this.ampK = decayCoef(hit.decay, this.sampleRate);
    this.noiseMix = hit.snap * 0.8;
    const bright = Math.pow(2, (hit.tone - 0.5) * 1.6);
    this.bp.reset();
    this.hp.reset();
    this.bp.set(this.center * bright, 0.25, BP);
    this.hp.set(this.cutoff * bright, 0.2, HP);
  }

  protected next(): number {
    let sq = 0;
    for (let i = 0; i < 6; i++) {
      const p = this.phases[i] + this.steps[i];
      this.phases[i] = p >= 1 ? p - 1 : p;
      sq += this.phases[i] < 0.5 ? 1 : -1;
    }
    const v = this.hp.process(this.bp.process(sq / 6 + this.noise.next() * this.noiseMix)) * this.amp;
    this.amp *= this.ampK;
    return v * this.gain;
  }
}

/** Cowbell: two squares, band-pass, a fast hit over a slower decay. */
class Cowbell extends DrumVoice {
  private readonly bp = new Svf(this.sampleRate);
  private readonly square = WAVE_TABLE[1];
  private phaseA = 0;
  private phaseB = 0;
  private dtA = 0;
  private dtB = 0;
  private strike = 0;
  private strikeK = decayCoef(0.03, this.sampleRate);
  private ampK = 0;
  private strikeMix = 0;

  protected start(hit: Hit): void {
    this.phaseA = this.phaseB = 0;
    this.dtA = (587 * hit.ratio) / this.sampleRate;
    this.dtB = (845 * hit.ratio) / this.sampleRate;
    this.amp = 1;
    this.strike = 1;
    this.ampK = decayCoef(hit.decay, this.sampleRate);
    this.strikeMix = hit.snap;
    this.bp.reset();
    this.bp.set(1200 * hit.ratio * Math.pow(2, (hit.tone - 0.5) * 2), 0.45, BP);
  }

  protected next(): number {
    const v = this.square(this.phaseA, this.dtA) + this.square(this.phaseB, this.dtB);
    this.phaseA = (this.phaseA + this.dtA) % 1;
    this.phaseB = (this.phaseB + this.dtB) % 1;
    const env = this.amp * (1 - 0.5 * this.strikeMix) + this.strike * this.strikeMix;
    this.amp *= this.ampK;
    this.strike *= this.strikeK;
    return this.bp.process(v) * env * 0.55;
  }
}

/** Shaker: high noise with a short attack (longer with little snap). */
class Shaker extends DrumVoice {
  private readonly noise = new Noise(79);
  private readonly hp = new Svf(this.sampleRate);
  private attack = 0;
  private attackStep = 0;
  private ampK = 0;

  protected start(hit: Hit): void {
    this.amp = 1;
    this.attack = 0;
    this.attackStep = 1 / Math.max(1, (0.001 + 0.02 * (1 - hit.snap)) * this.sampleRate);
    this.ampK = decayCoef(hit.decay, this.sampleRate);
    this.hp.reset();
    this.hp.set(3000 * Math.pow(2, hit.tone * 1.7) * hit.ratio, 0.2, HP);
  }

  protected next(): number {
    const v = this.hp.process(this.noise.next());
    if (this.attack < 1) {
      this.attack = Math.min(1, this.attack + this.attackStep);
      return v * this.attack * 0.9;
    }
    const out = v * this.amp * 0.9;
    this.amp *= this.ampK;
    return out;
  }
}

/** 4-point Hermite interpolation between x[k] and x[k+1] (edges repeated). */
const hermite = (x: Float32Array, k: number, f: number): number => {
  const n = x.length;
  const xm = x[k > 0 ? k - 1 : 0], x0 = x[k], x1 = x[k + 1 < n ? k + 1 : n - 1], x2 = x[k + 2 < n ? k + 2 : n - 1];
  const c1 = 0.5 * (x1 - xm), c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
};

/** The last samples of a sample fade out, if the file ends abruptly. */
const END_FADE = 64;

/** The pad's sample: played from Start at the pad's pitch (Hermite interpolation,
 *  also when the file has another sample rate), with the decay shortening it
 *  (it stays full and falls towards the end), Tone as a DJ filter (below half low-pass, above
 *  high-pass) and Snap as saturation. Reversed it plays the same piece (from Start for the
 *  decay's length) from the end to the start, and the envelope flips: it rises and ends dry,
 *  like a reversed hit. It's stereo: it does the sample's round by itself. */
class SampleVoice extends DrumVoice {
  private data: SampleData | null = null;
  private pos = 0;
  private step = 1;
  /** The voice's time in units of the decay: at 1 it's finished. */
  private t = 0;
  private tStep = 0;
  private drive = 0;
  private filtered = false;
  private reverse = false;
  /** The sample where the voice stops (going forward: end of the file; reversed: Start). */
  private stop = 0;
  private readonly filterL = new Svf(this.sampleRate);
  private readonly filterR = new Svf(this.sampleRate);

  protected start(hit: Hit): void {
    const d = hit.sample;
    this.data = d && d.channels.length && d.channels[0].length > 1 ? d : null;
    this.amp = this.data ? 1 : 0;
    if (!this.data) return;
    const length = this.data.channels[0].length, from = Math.min(length - 2, Math.floor(hit.start * length));
    const speed = (hit.ratio * this.data.sampleRate) / this.sampleRate;
    this.reverse = hit.reverse;
    this.t = 0;
    this.tStep = 1 / (hit.decay * this.sampleRate);
    if (this.reverse) {
      // the piece the decay would let play, read from the end
      this.pos = Math.min(length - 1, from + hit.decay * this.sampleRate * speed);
      this.step = -speed;
      this.stop = from;
    } else {
      this.pos = from;
      this.step = speed;
      this.stop = length - 1;
    }
    this.drive = hit.snap;
    const tone = hit.tone - 0.5;
    this.filtered = Math.abs(tone) > 0.02;
    if (this.filtered) {
      // low-pass from 20 kHz down to 100 Hz, high-pass from 20 Hz up to 5 kHz
      const [cutoff, type] = tone < 0 ? [20000 * Math.pow(100 / 20000, -2 * tone), LP] : [20 * Math.pow(250, 2 * tone), HP];
      for (const f of [this.filterL, this.filterR]) {
        f.reset();
        f.set(cutoff, 0.15, type);
      }
    }
  }

  protected next(): number {
    return 0; // not needed: render does everything, in stereo
  }

  override render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const d = this.data;
    if (!d) return;
    const L = d.channels[0], R = d.channels[1] ?? L, stereo = R !== L;
    const { gainL, gainR, drive, filtered, reverse, stop } = this;
    for (let i = from; i < to; i++) {
      const k = Math.floor(this.pos);
      if ((reverse ? k < stop : k >= stop) || this.t >= 1) {
        this.amp = 0;
        break;
      }
      const f = this.pos - k;
      let l = hermite(L, k, f), r = stereo ? hermite(R, k, f) : l;
      if (filtered) {
        l = this.filterL.process(l);
        r = stereo ? this.filterR.process(r) : l;
      }
      if (drive > 0.01) {
        l = saturate(l, drive);
        r = stereo ? saturate(r, drive) : l;
      }
      // full at the start, then it falls towards the end of the decay (reversed: rises early and stays
      // full to the end); the last samples before the edge fade
      const u = reverse ? 1 - this.t : this.t, u2 = u * u, tail = reverse ? k - stop : stop - k;
      const env = 1 - u2 * u2;
      const g = env * this.chokeGain() * (tail < END_FADE ? tail / END_FADE : 1);
      // the envelope's level says whether the voice is alive (not the fade of the file's edges)
      this.amp = Math.max(FLOOR, env);
      left[i] += l * g * gainL;
      right[i] += r * g * gainR;
      this.pos += this.step;
      this.t += this.tStep;
      if (!this.active) break;
    }
  }
}

/** The voices by model id: adding a sound is one line here and one in DRUM_MODELS. */
const VOICES: Readonly<Record<string, (sampleRate: number) => DrumVoice>> = {
  kick: sr => new Kick(sr),
  boom: sr => new Boom(sr),
  snare: sr => new Snare(sr),
  clap: sr => new Clap(sr),
  rim: sr => new Rim(sr),
  hatClosed: sr => new Metal(sr, 10000, 7000, 4.2),
  hatOpen: sr => new Metal(sr, 10000, 7000, 4.2),
  cymbal: sr => new Metal(sr, 7000, 4000, 3),
  tom: sr => new Tom(sr),
  cowbell: sr => new Cowbell(sr),
  shaker: sr => new Shaker(sr),
  sample: sr => new SampleVoice(sr),
};

/** The engines of the instruments a pad can play, by type. */
const INNER_CORES: Readonly<Record<string, (sampleRate: number) => InstrumentCore & SamplePlayer>> = {
  kick: sr => new KickCore(sr),
  snare: sr => new SnareCore(sr),
  cymbals: sr => new CymbalsCore(sr),
};

/** After how much silence a pad's instrument stops playing (so as not to compute it for nothing). */
const INNER_QUIET = 0.5;

/** The instrument inside a pad: its engine and the parameters to read among the Drum Machine's. */
class InnerInstrument {
  readonly core: InstrumentCore & SamplePlayer;
  /** The ids of the instrument's parameters and, in the same order, those with the pad's prefix. */
  private readonly ids: readonly string[];
  private readonly keys: readonly string[];
  private quiet = Infinity;
  private notes = 0;

  constructor(type: DeviceType, prefix: string, private readonly sampleRate: number) {
    this.core = INNER_CORES[type.type](sampleRate);
    this.ids = paramsOf(type).map(p => p.id);
    this.keys = this.ids.map(id => prefix + id);
  }

  get active(): boolean {
    return this.quiet < INNER_QUIET * this.sampleRate;
  }

  setParams(params: Readonly<Record<string, number>>): void {
    const own: Record<string, number> = {};
    this.ids.forEach((id, k) => {
      const v = params[this.keys[k]];
      if (v !== undefined) own[id] = v;
    });
    this.core.setParams(own);
  }

  hit(pitch: number, velocity: number): void {
    this.core.noteOn(++this.notes, pitch, velocity);
    this.quiet = 0;
  }

  silence(): void {
    this.core.silence();
  }

  /** Plays in [from, to) and keeps count of the silence. */
  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    this.core.render(left, right, from, to);
    let loud = false;
    for (let i = from; i < to && !loud; i++) loud = Math.abs(left[i]) >= FLOOR || Math.abs(right[i]) >= FLOOR;
    this.quiet = loud ? 0 : this.quiet + (to - from);
  }
}

/** A pad: two voices per model (created when needed) and its values. */
class Pad {
  settings: DrumPad | null = null;
  /** The sample loaded on the pad (it plays if the model is Sample). */
  sample: SampleData | null = null;
  private readonly voices = new Map<number, readonly [DrumVoice, DrumVoice]>();
  private current = 0;
  /** The instruments the pad has played, by type (going back to one, it's as it was), and the current one. */
  private readonly inners = new Map<string, InnerInstrument>();
  private inner: InnerInstrument | null = null;
  /** The instruments' samples, by slot with the prefix ("p3.kick.body"). */
  private readonly innerSamples = new Map<string, SampleData | null>();
  private scratchL = new Float32Array(128);
  private scratchR = new Float32Array(128);

  constructor(private readonly index: number, private readonly sampleRate: number) {}

  /** The voices (or the instrument) of the current model: they're created here, never while playing a block. */
  prepare(params: Readonly<Record<string, number>>): void {
    const model = this.settings?.model ?? -1;
    const instrument = padInstrument(model);
    if (instrument) {
      const type = instrument.type.type;
      let inner = this.inners.get(type);
      if (!inner) {
        const prefix = innerPrefix(this.index, type);
        this.inners.set(type, (inner = new InnerInstrument(instrument.type, prefix, this.sampleRate)));
        for (const [slot, data] of this.innerSamples) if (slot.startsWith(prefix)) inner.core.setSample(slot.slice(prefix.length), data);
      }
      if (this.inner && this.inner !== inner) this.inner.silence();
      this.inner = inner;
      inner.setParams(params);
      return;
    }
    if (this.inner) this.inner.silence();
    this.inner = null;
    const make = VOICES[DRUM_MODELS[model]?.id];
    if (make && !this.voices.has(model)) this.voices.set(model, [make(this.sampleRate), make(this.sampleRate)]);
  }

  /** The sample of one of the pad's instruments (slot with the prefix). */
  setInnerSample(slot: string, type: string, inner: string, sample: SampleData | null): void {
    this.innerSamples.set(slot, sample);
    this.inners.get(type)?.core.setSample(inner, sample);
  }

  hit(velocity: number, velocityGain: number): void {
    const s = this.settings;
    if (s && this.inner) {
      this.inner.hit(padInstrument(s.model)!.note(s.piece), velocity);
      return;
    }
    const pair = s && this.voices.get(s.model);
    if (!s || !pair) return;
    // the previous hit fades, the new one starts on the other voice
    pair[this.current].choke();
    this.current ^= 1;
    const gain = dbToGain(s.level) * velocityGain, pan = s.pan / 100;
    pair[this.current].trigger(
      {
        ratio: Math.pow(2, s.tune / 12), decay: s.decay, tone: s.tone / 100, snap: s.snap / 100,
        sample: this.sample, start: s.start / 100, reverse: s.reverse === 1,
      },
      gain * Math.min(1, 1 - pan), gain * Math.min(1, 1 + pan));
  }

  choke(): void {
    for (const pair of this.voices.values()) for (const v of pair) v.choke();
    for (const inner of this.inners.values()) inner.silence();
  }

  get active(): boolean {
    if (this.inner?.active) return true;
    for (const pair of this.voices.values()) if (pair[0].active || pair[1].active) return true;
    return false;
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    for (const pair of this.voices.values()) for (const v of pair) if (v.active) v.render(left, right, from, to);
    const inner = this.inner, s = this.settings;
    if (!inner?.active || !s) return;
    // the instrument plays separately; the pad's level and pan are applied here
    const n = to - from;
    if (this.scratchL.length < n) {
      this.scratchL = new Float32Array(n);
      this.scratchR = new Float32Array(n);
    }
    const l = this.scratchL.subarray(0, n), r = this.scratchR.subarray(0, n);
    l.fill(0);
    r.fill(0);
    inner.render(l, r, 0, n);
    const gain = dbToGain(s.level), pan = s.pan / 100;
    const gl = gain * Math.min(1, 1 - pan), gr = gain * Math.min(1, 1 + pan);
    for (let i = 0; i < n; i++) {
      left[from + i] += l[i] * gl;
      right[from + i] += r[i] * gr;
    }
  }
}

export class DrumCore implements InstrumentCore, SamplePlayer {
  private readonly pads: Pad[];
  private velocity = 0.7;
  private volume = 1;
  /** Current output gain: follows `volume` without steps. */
  private gain = -1;
  private readonly gainK: number;
  private scratchL = new Float32Array(128);
  private scratchR = new Float32Array(128);

  constructor(sampleRate: number) {
    this.pads = Array.from({ length: DRUM_PADS }, (_, i) => new Pad(i, sampleRate));
    this.gainK = 1 - Math.exp(-1 / (0.01 * sampleRate));
  }

  setParams(params: Readonly<Record<string, number>>): void {
    padsOf(params).forEach((s, i) => {
      this.pads[i].settings = s;
      this.pads[i].prepare(params);
    });
    this.velocity = (params.velocity ?? 70) / 100;
    this.volume = dbToGain(params.volume ?? -4);
  }

  /** The sample of the pad of `slot` ("p1"…), or of an instrument of a pad ("p3.kick.body"): the hit
   *  already playing keeps its own, the next uses this one. */
  setSample(slot: string, sample: SampleData | null): void {
    const inner = splitInner(slot);
    if (inner) return this.pads[inner.pad].setInnerSample(slot, inner.type, inner.inner, sample);
    const pad = this.pads[padOfSlot(slot)];
    if (pad) pad.sample = sample;
  }

  noteOn(_id: number, pitch: number, velocity: number): void {
    const i = padOfNote(pitch);
    const pad = this.pads[i];
    if (!pad?.settings) return;
    const group = pad.settings.choke;
    if (group > 0) for (const other of this.pads) if (other !== pad && other.settings?.choke === group) other.choke();
    const v = velocity / 127;
    pad.hit(velocity, 1 - this.velocity + this.velocity * v * v);
  }

  /** The hits ring to the end: the note's length doesn't count. */
  noteOff(): void {}

  silence(): void {
    for (const p of this.pads) p.choke();
  }

  /** How many pads are playing (for tests). */
  get activePads(): number {
    return this.pads.filter(p => p.active).length;
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    if (this.gain < 0) this.gain = this.volume;
    const n = to - from;
    if (n <= 0 || !this.pads.some(p => p.active)) return;
    if (this.scratchL.length < n) {
      this.scratchL = new Float32Array(n);
      this.scratchR = new Float32Array(n);
    }
    const l = this.scratchL.subarray(0, n), r = this.scratchR.subarray(0, n);
    l.fill(0);
    r.fill(0);
    for (const p of this.pads) p.render(l, r, 0, n);
    const target = this.volume, k = this.gainK;
    let g = this.gain;
    for (let i = 0; i < n; i++) {
      g += (target - g) * k;
      left[from + i] += l[i] * g;
      right[from + i] += r[i] * g;
    }
    this.gain = g;
  }
}
