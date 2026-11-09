/* The Sampler's engine (see sampler.ts). A note starts a voice for each zone that
 * contains it (keys and velocity), and each voice reads its zone's sample at a speed giving
 * the pitch (Hermite interpolation, also when the file has another sample
 * rate), inside the Start…End region or its slice; in Classic the loop holds it
 * while the note is held, forward (with the constant-power crossfade between the end of the loop
 * and the piece before the start) or back and forth. The sound goes through Prisma's filter and
 * the volume envelope, sample by sample; pitch, filter, LFO and gains are computed
 * every CONTROL_RATE samples. Loop, pitch, filter, envelopes and LFO are those of the
 * voice's zone. A voice restarting while it plays (mono, stolen voice) fades its last
 * value instead of jumping: no clicks. */
import { clamp01 } from '../../../core/math';
import { dbToGain, type InstrumentCore, type SampleData, type SamplePlayer } from '../../dsp/core';
import { MonoPlayer, type MonoVoice } from '../../dsp/mono-player';
import { VoicePool, type PolyVoice } from '../../dsp/voice-pool';
import { TEMPO_RATES } from '../../rates';
import { CurvedEnv, type EnvShape } from '../prisma/curved-env';
import { PrismaFilter } from '../prisma/prisma-filter';
import { LFO_SHAPE as PRISMA_SHAPE, randomValue, shapeValue } from '../prisma/shapes';
import {
  ENV, FILTER_ENV_OCTAVES, FILTER_VEL_OCTAVES, FIRST_SLICE_NOTE, LFO_CUTOFF_OCTAVES, LFO_SYNC, LFO_TRIG, LOOP,
  LOOP_RELEASE, MAX_ZONES, MODE, sliceStarts, TRIGGER, VOICE_MODE, zoneOfSlot, zoneSource, type ZoneKey,
} from './sampler';

const CONTROL_RATE = 32;
export const SAMPLER_VOICES = 16;
/** The shortest loop, in samples of the sample (below it, there's no loop). */
const MIN_LOOP = 16;
/** The last samples before the end of the region fade (in samples of the sample). */
const END_FADE = 64;
/** The highest reading speed (four octaves up, at equal rates, and a bit more). */
const MAX_SPEED = 64;
/** How long the fade of the value left by a restarting voice lasts. */
const DECLICK_TIME = 0.004;

/** The Sampler's LFO shapes among Prisma's (the random ones have their own computation). */
const SHAPES: readonly number[] = [
  PRISMA_SHAPE.sine, PRISMA_SHAPE.triangle, PRISMA_SHAPE.sawUp, PRISMA_SHAPE.sawDown, PRISMA_SHAPE.square,
  PRISMA_SHAPE.sampleHold, PRISMA_SHAPE.smoothRandom,
];


const envShape = (v: (id: string) => number, n: number): EnvShape => ({
  attack: v(`e${n}A`), hold: v(`e${n}H`), decay: v(`e${n}D`), sustain: v(`e${n}S`) / 100, release: v(`e${n}R`),
  attackCurve: v(`e${n}Ac`), decayCurve: v(`e${n}Dc`), releaseCurve: v(`e${n}Rc`),
});

/** A zone: its sample and its values, already in the engine's units (the sound, if the zone
 *  follows the first, is the first's). They stay the same objects (they're updated), so a
 *  playing voice follows its zone's changes. */
class Zone {
  sample: SampleData | null = null;
  lo = 0;
  hi = 127;
  vlo = 1;
  vhi = 127;
  root = 60;
  /** In semitones, with the cents: the Transpose and the Detune of the zone's sound. */
  tune = 0;
  gain = 1;
  pan = 0;
  start = 0;
  end = 1;
  loopStart = 0;
  loopEnd = 1;
  loop = LOOP.off as number;
  loopExit = false;
  xfade = 0;
  reverse = false;
  keyTrack = 1;
  pitchEnv = 0;
  filterOn = false;
  fType = 0;
  fCutoff = 6000;
  fRes = 0;
  fDrive = 0;
  fVar = 0.5;
  fKey = 0;
  fEnv = 0;
  fVel = 0;
  /** The volume, filter and pitch envelopes. */
  readonly envs: EnvShape[] = [ENV.amp, ENV.filter, ENV.pitch].map(() => envShape(() => 0, 0));
  lfoShape = 0;
  lfoRate = 4;
  lfoFree = false;
  lfoFade = 0;
  lfoPitch = 0;
  lfoCutoff = 0;
  lfoVolume = 0;
  lfoPan = 0;
  /** The free LFO: the cycle shared by all the zone's voices. */
  freePhase = 0;
  freeCycle = 0;
  private lfoSync = LFO_SYNC.hz as number;
  private lfoDiv = 0;
  private lfoHz = 4;

  constructor(readonly index: number) {}

  read(params: Readonly<Record<string, number>>, bpm: number): void {
    const v = (key: ZoneKey, def: number) => params[zoneSource(params, this.index, key)] ?? def;
    const lo = v('lo', 0), hi = v('hi', 127), vlo = v('vlo', 1), vhi = v('vhi', 127);
    this.lo = Math.min(lo, hi);
    this.hi = Math.max(lo, hi);
    this.vlo = Math.min(vlo, vhi);
    this.vhi = Math.max(vlo, vhi);
    this.root = v('root', 60);
    this.tune = v('transpose', 0) + v('detune', 0) / 100;
    this.gain = dbToGain(v('gain', 0));
    this.pan = v('pan', 0) / 100;
    this.start = clamp01(v('start', 0) / 100);
    this.end = Math.max(this.start, clamp01(v('end', 100) / 100));
    this.loopStart = clamp01(v('loopStart', 0) / 100);
    this.loopEnd = clamp01(v('loopEnd', 100) / 100);
    this.loop = v('loop', LOOP.off);
    this.loopExit = v('loopRelease', 0) === LOOP_RELEASE.exit;
    this.xfade = v('xfade', 0) / 100;
    this.reverse = v('reverse', 0) === 1;
    this.keyTrack = v('keyTrack', 100) / 100;
    this.pitchEnv = v('pitchEnv', 0);
    this.filterOn = v('fOn', 0) === 1;
    this.fType = v('fType', 0);
    this.fCutoff = v('fCutoff', 6000);
    this.fRes = v('fRes', 0) / 100;
    this.fDrive = v('fDrive', 0) / 100;
    this.fVar = v('fVar', 50) / 100;
    this.fKey = v('fKey', 0) / 100;
    this.fEnv = v('fEnv', 0) / 100;
    this.fVel = v('fVel', 0) / 100;
    for (const n of [ENV.amp, ENV.filter, ENV.pitch]) this.envs[n - 1] = envShape(id => v(id as ZoneKey, 0), n);
    this.lfoShape = SHAPES[v('lfoShape', 0)] ?? PRISMA_SHAPE.sine;
    this.lfoFree = v('lfoTrig', 0) === LFO_TRIG.free;
    this.lfoFade = v('lfoFade', 0);
    this.lfoPitch = v('lfoPitch', 0);
    this.lfoCutoff = v('lfoCutoff', 0) / 100;
    this.lfoVolume = v('lfoVolume', 0) / 100;
    this.lfoPan = v('lfoPan', 0) / 100;
    this.lfoSync = v('lfoSync', LFO_SYNC.hz);
    this.lfoDiv = v('lfoDiv', 0);
    this.lfoHz = v('lfoRate', 4);
    this.setTempo(bpm);
  }

  setTempo(bpm: number): void {
    const beats = TEMPO_RATES[this.lfoDiv]?.[1] ?? 1;
    this.lfoRate = this.lfoSync === LFO_SYNC.tempo ? bpm / 60 / beats : this.lfoHz;
  }

  /** The free LFO's cycle, `seconds` later. */
  advance(seconds: number): void {
    this.freePhase += this.lfoRate * seconds;
    if (this.freePhase >= 1) {
      const turns = Math.floor(this.freePhase);
      this.freePhase -= turns;
      this.freeCycle += turns;
    }
  }

  /** The LFO's value (0…1) at cycle `cycle`, at `phase`. */
  lfoAt(cycle: number, phase: number): number {
    const shape = this.lfoShape;
    return shape === PRISMA_SHAPE.sampleHold || shape === PRISMA_SHAPE.smoothRandom ? randomValue(shape, cycle, phase) : shapeValue(shape, phase);
  }

  /** Whether the note makes it play. */
  plays(pitch: number, velocity: number): boolean {
    return !!this.sample && pitch >= this.lo && pitch <= this.hi && velocity >= this.vlo && velocity <= this.vhi;
  }
}

/** The parameter values of the whole Sampler, already in the engine's units (the sound belongs to the
 *  zones); all the voices read them. */
class Settings {
  readonly zones = Array.from({ length: MAX_ZONES }, (_, i) => new Zone(i));
  mode = MODE.classic as number;
  gate = false;
  /** The slice starts (fractions), plus the end of the region at the bottom (of the first zone). */
  slices: number[] = [];
  voiceMode = VOICE_MODE.poly as number;
  glide = 0;
  velocity = 0.5;
  pan = 0;
  gain = 1;
  bpm = 120;

  read(params: Readonly<Record<string, number>>): void {
    const v = (id: string) => params[id] ?? 0;
    this.mode = v('mode');
    this.gate = v('trigger') === TRIGGER.gate;
    for (const z of this.zones) z.read(params, this.bpm);
    this.slices = this.mode === MODE.slice ? [...sliceStarts(params), this.zones[0].end] : [];
    this.voiceMode = v('voiceMode');
    this.glide = v('glide') / 1000;
    this.velocity = (params.velocity ?? 50) / 100;
    this.pan = v('pan') / 100;
    this.gain = dbToGain(params.volume ?? -6);
  }

  setTempo(bpm: number): void {
    this.bpm = bpm;
    for (const z of this.zones) z.setTempo(bpm);
  }

  /** The first zone playing the note (in Slice the first zone, which has the slices), or null. */
  zoneFor(pitch: number, velocity: number): Zone | null {
    if (this.mode === MODE.slice) return this.zones[0].sample ? this.zones[0] : null;
    for (const z of this.zones) if (z.plays(pitch, velocity)) return z;
    return null;
  }

  /** All the zones playing the note, into `out` (which it returns). */
  zonesFor(pitch: number, velocity: number, out: Zone[]): Zone[] {
    out.length = 0;
    if (this.mode === MODE.slice) {
      if (this.zones[0].sample) out.push(this.zones[0]);
    } else for (const z of this.zones) if (z.plays(pitch, velocity)) out.push(z);
    return out;
  }

  /** For the single voice (MonoPlayer): in Legato overlapping notes slide. */
  get legato(): boolean {
    return this.voiceMode === VOICE_MODE.legato;
  }
}

class SamplerVoice implements PolyVoice, MonoVoice {
  private readonly amp: CurvedEnv;
  private readonly filterEnv: CurvedEnv;
  private readonly pitchEnv: CurvedEnv;
  private readonly filter: PrismaFilter;
  private readonly bufL = new Float64Array(CONTROL_RATE);
  private readonly bufR = new Float64Array(CONTROL_RATE);
  /** The zone the voice plays, and its sample: it keeps it even if another one arrives in the zone. */
  private zone: Zone;
  private data: SampleData | null = null;
  /** The position in the sample as it's seen (with Reverse, in the reversed sample), in samples. */
  pos = 0;
  private dir = 1;
  private speed = 1;
  /** The voice's slice (Slice), in samples; −1: the Start…End region. */
  private sliceA = -1;
  private sliceB = -1;
  private pitch = 60;
  private target = 60;
  private velocity = 1;
  private released = false;
  /** The region is over: the voice is silent. */
  private done = false;
  private gainL = 0;
  private gainR = 0;
  private stepL = 0;
  private stepR = 0;
  private lfoPhase = 0;
  private lfoCycle = 0;
  private age = 0;
  private fresh = true;
  private countdown = 0;
  /** The last value sent to the output, and the one fading after a restart. */
  private lastL = 0;
  private lastR = 0;
  private tailL = 0;
  private tailR = 0;
  private readonly tailK: number;

  constructor(private readonly s: Settings, private readonly sampleRate: number, private readonly seed: () => number) {
    const control = sampleRate / CONTROL_RATE;
    this.amp = new CurvedEnv(sampleRate);
    this.filterEnv = new CurvedEnv(control);
    this.pitchEnv = new CurvedEnv(control);
    this.filter = new PrismaFilter(sampleRate);
    this.tailK = Math.exp(-1 / (DECLICK_TIME * sampleRate));
    this.zone = s.zones[0];
  }

  get active(): boolean {
    return (this.amp.active && !this.done) || this.tailL !== 0 || this.tailR !== 0;
  }

  get releasing(): boolean {
    return this.amp.releasing || this.done;
  }

  get currentPitch(): number {
    return this.pitch;
  }

  /** Where the voice reads, as a fraction of the sample (−1 if it isn't playing). */
  get position(): number {
    const n = this.data?.channels[0].length ?? 0;
    return this.amp.active && !this.done && n > 0 ? this.pos / n : -1;
  }

  /** The playing zone (from 0). */
  get zoneIndex(): number {
    return this.zone.index;
  }

  /** A note from the start: zone `zone`, or the first that plays it. */
  start(pitch: number, velocity: number, from: number | null = null, zone: Zone | null = null): void {
    const { s } = this;
    const z = zone ?? s.zoneFor(pitch, velocity);
    const data = z?.sample;
    if (!z || !data || data.channels[0].length < 2) return;
    const n = data.channels[0].length;
    if (s.mode === MODE.slice) {
      const i = pitch - FIRST_SLICE_NOTE;
      if (i < 0 || i >= s.slices.length - 1) return;
      this.sliceA = Math.floor(s.slices[i] * n);
      this.sliceB = Math.max(this.sliceA + 2, Math.min(n, Math.round(s.slices[i + 1] * n)));
    } else this.sliceA = this.sliceB = -1;
    if (this.amp.active && !this.done) {
      // restarting halfway, the current value fades by itself instead of jumping
      this.tailL += this.lastL;
      this.tailR += this.lastR;
    } else {
      this.filter.reset();
      this.fresh = true;
    }
    this.zone = z;
    this.data = data;
    this.lastL = this.lastR = 0;
    this.pos = this.sliceA >= 0 ? this.sliceA : Math.floor(z.start * n);
    this.dir = 1;
    this.done = false;
    this.released = false;
    this.target = pitch;
    this.pitch = from ?? pitch;
    this.velocity = velocity / 127;
    const note = this.seed();
    this.lfoPhase = z.lfoFree ? z.freePhase : 0;
    this.lfoCycle = z.lfoFree ? z.freeCycle : note * 17;
    this.age = 0;
    this.amp.set(z.envs[0]);
    this.filterEnv.set(z.envs[1]);
    this.pitchEnv.set(z.envs[2]);
    this.amp.trigger();
    this.filterEnv.trigger();
    this.pitchEnv.trigger();
    this.countdown = 0;
  }

  slide(pitch: number, velocity: number): void {
    // a slice is another piece of the sample: restart from there
    if (this.s.mode === MODE.slice) return this.start(pitch, velocity, null);
    // another zone is another sample: restart, sliding from the current pitch
    const zone = this.s.zoneFor(pitch, velocity);
    if (zone && zone !== this.zone) return this.start(pitch, velocity, this.pitch, zone);
    this.target = pitch;
    this.velocity = velocity / 127;
  }

  release(): void {
    const { s } = this;
    // in Trigger the hit plays to the end, whatever the note's length
    if (s.mode !== MODE.classic && !s.gate) return;
    this.released = true;
    this.amp.release();
    this.filterEnv.release();
    this.pitchEnv.release();
  }

  kill(): void {
    this.amp.kill();
    this.filterEnv.kill();
    this.pitchEnv.kill();
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const { amp, bufL, bufR, tailK } = this;
    for (let i = from; i < to;) {
      if (this.countdown <= 0) this.control();
      const len = Math.min(this.countdown, to - i);
      this.countdown -= len;
      const playing = amp.active && !this.done;
      const got = playing ? this.read(len) : 0;
      if (got && this.zone.filterOn) this.filter.process(bufL, bufR, got);
      for (let j = 0; j < len; j++, i++) {
        let l = 0, r = 0;
        if (j < got) {
          const g = amp.next();
          this.gainL += this.stepL;
          this.gainR += this.stepR;
          l = bufL[j] * g * this.gainL;
          r = bufR[j] * g * this.gainR;
        }
        this.lastL = l;
        this.lastR = r;
        if (this.tailL !== 0 || this.tailR !== 0) {
          l += this.tailL;
          r += this.tailR;
          this.tailL *= tailK;
          this.tailR *= tailK;
          if (Math.abs(this.tailL) < 1e-6 && Math.abs(this.tailR) < 1e-6) this.tailL = this.tailR = 0;
        }
        left[i] += l;
        right[i] += r;
      }
      if (!this.active) return;
    }
  }

  /** Reads up to `len` samples into the buffers; fewer if the region ends earlier (then the voice is silent). */
  private read(len: number): number {
    const { s, bufL, bufR, zone } = this;
    const data = this.data!;
    const L = data.channels[0], R = data.channels[1] ?? L, stereo = R !== L;
    const n = L.length, last = n - 1, reverse = zone.reverse;
    let a: number, b: number;
    if (this.sliceA >= 0) {
      a = this.sliceA;
      b = this.sliceB;
    } else {
      a = Math.floor(zone.start * n);
      b = Math.max(a + 2, Math.min(n, Math.round(zone.end * n)));
    }
    // the loop (Classic only): inside the region, at least MIN_LOOP long
    let la = 0, lb = 0, xf = 0, looping = s.mode === MODE.classic && zone.loop !== LOOP.off && !(this.released && zone.loopExit);
    if (looping) {
      la = Math.max(a, Math.min(b - MIN_LOOP, Math.floor(zone.loopStart * n)));
      lb = Math.max(la + MIN_LOOP, Math.min(b, Math.round(zone.loopEnd * n)));
      // past the end of the loop (the knob moved it) it goes to the end of the region
      looping = lb - la >= MIN_LOOP && this.pos <= lb;
      if (looping && zone.loop === LOOP.forward) xf = Math.min(zone.xfade * (lb - la), la - a);
    }
    if (!looping) this.dir = 1;
    const span = lb - la, pingPong = zone.loop === LOOP.pingPong, speed = this.speed;
    let pos = this.pos, dir = this.dir;
    for (let j = 0; j < len; j++) {
      if (!looping && pos >= b) {
        this.done = true;
        this.pos = pos;
        return j;
      }
      let q = reverse ? last - pos : pos;
      if (q < 0) q = 0;
      else if (q > last) q = last;
      let k = Math.floor(q), f = q - k;
      let l = hermite(L, k, f), r = stereo ? hermite(R, k, f) : l;
      if (xf > 0 && pos > lb - xf) {
        // the end of the loop fades into the piece before its start: at the wrap it arrives there
        const t = (pos - (lb - xf)) / xf, p2 = pos - span;
        q = reverse ? last - p2 : p2;
        k = Math.floor(q);
        f = q - k;
        const gOut = Math.sqrt(1 - t), gIn = Math.sqrt(t);
        l = l * gOut + hermite(L, k, f) * gIn;
        r = stereo ? r * gOut + hermite(R, k, f) * gIn : l;
      }
      if (!looping) {
        const tail = b - pos;
        if (tail < END_FADE) {
          l *= tail / END_FADE;
          r *= tail / END_FADE;
        }
      }
      bufL[j] = l;
      bufR[j] = r;
      pos += dir * speed;
      if (looping) {
        if (pingPong) {
          if (dir > 0 && pos >= lb) {
            pos = Math.max(la, 2 * lb - pos);
            dir = -1;
          } else if (dir < 0 && pos <= la) {
            pos = Math.min(lb, 2 * la - pos);
            dir = 1;
          }
        } else if (pos >= lb) pos = Math.max(la, pos - span);
      }
    }
    this.pos = pos;
    this.dir = dir;
    return len;
  }

  /** Every CONTROL_RATE samples: glide, filter and pitch envelopes, LFO, reading speed,
   *  filter and gains. */
  private control(): void {
    const { s, sampleRate, zone } = this;
    this.countdown = CONTROL_RATE;
    const tick = CONTROL_RATE / sampleRate;
    if (this.pitch !== this.target) {
      // exponential glide in semitones: it gets to 95 % in about `glide` seconds
      const k = s.glide > 0 ? 1 - Math.exp((-3 * CONTROL_RATE) / (s.glide * sampleRate)) : 1;
      this.pitch += (this.target - this.pitch) * k;
      if (Math.abs(this.target - this.pitch) < 1e-3) this.pitch = this.target;
    }
    this.amp.set(zone.envs[0]);
    this.filterEnv.set(zone.envs[1]);
    this.pitchEnv.set(zone.envs[2]);
    const fenv = this.filterEnv.next(), penv = this.pitchEnv.next();

    // the LFO, bipolar, coming in over `lfoFade` seconds
    const ramp = zone.lfoFade > 0 ? Math.min(1, this.age / zone.lfoFade) : 1;
    const lfo = (2 * zone.lfoAt(this.lfoCycle, this.lfoPhase) - 1) * ramp;
    this.lfoPhase += zone.lfoRate * tick;
    if (this.lfoPhase >= 1) {
      const turns = Math.floor(this.lfoPhase);
      this.lfoPhase -= turns;
      this.lfoCycle += turns;
    }
    this.age += tick;

    const sliced = s.mode === MODE.slice;
    const semis = (sliced ? 0 : (this.pitch - zone.root) * zone.keyTrack) + zone.tune + zone.pitchEnv * penv + zone.lfoPitch * lfo;
    const rate = this.data ? this.data.sampleRate / sampleRate : 1;
    this.speed = Math.min(MAX_SPEED, rate * Math.pow(2, semis / 12));

    if (zone.filterOn) {
      const octaves = zone.fEnv * FILTER_ENV_OCTAVES * fenv + (zone.fKey * (this.pitch - 60)) / 12
        + zone.fVel * FILTER_VEL_OCTAVES * this.velocity + zone.lfoCutoff * LFO_CUTOFF_OCTAVES * lfo;
      this.filter.set(zone.fType, zone.fCutoff * Math.pow(2, octaves), zone.fRes, zone.fDrive, zone.fVar, 1);
    }

    const v = this.velocity;
    const level = (1 - s.velocity + s.velocity * v * v) * (1 - zone.lfoVolume * 0.5 * (1 - lfo)) * s.gain * zone.gain;
    const pan = Math.max(-1, Math.min(1, s.pan + zone.pan + zone.lfoPan * lfo));
    const gl = level * (pan > 0 ? 1 - pan : 1), gr = level * (pan < 0 ? 1 + pan : 1);
    if (this.fresh) {
      this.gainL = gl;
      this.gainR = gr;
      this.stepL = this.stepR = 0;
      this.fresh = false;
    } else {
      this.stepL = (gl - this.gainL) / CONTROL_RATE;
      this.stepR = (gr - this.gainR) / CONTROL_RATE;
    }
  }
}

/** 4-point Hermite interpolation between x[k] and x[k+1] (edges repeated). */
const hermite = (x: Float32Array, k: number, f: number): number => {
  const n = x.length;
  const xm = x[k > 0 ? k - 1 : 0], x0 = x[k], x1 = x[k + 1 < n ? k + 1 : n - 1], x2 = x[k + 2 < n ? k + 2 : n - 1];
  const c1 = 0.5 * (x1 - xm), c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
};

export class SamplerCore implements InstrumentCore, SamplePlayer {
  private readonly settings = new Settings();
  private readonly pool: VoicePool<SamplerVoice>;
  private readonly mono: MonoPlayer;
  private single: boolean | null = null;
  private notes = 0;
  private readonly hits: Zone[] = [];

  constructor(private readonly sampleRate: number, voices = SAMPLER_VOICES) {
    const seed = () => ++this.notes;
    this.pool = new VoicePool(Array.from({ length: voices }, () => new SamplerVoice(this.settings, sampleRate, seed)));
    this.mono = new MonoPlayer(this.pool.voices[0], this.settings);
  }

  setParams(params: Readonly<Record<string, number>>): void {
    this.settings.read(params);
    // switching from poly to mono (or vice versa) restarts clean
    const single = this.settings.voiceMode !== VOICE_MODE.poly;
    if (this.single !== null && single !== this.single) this.silence();
    this.single = single;
  }

  setTempo(bpm: number): void {
    if (bpm > 0) this.settings.setTempo(bpm);
  }

  /** A zone's sample: the playing voices keep theirs, the following notes use this one. */
  setSample(slot: string, sample: SampleData | null): void {
    const i = zoneOfSlot(slot);
    if (i < 0) return;
    this.settings.zones[i].sample = sample && sample.channels.length && sample.channels[0].length > 1 ? sample : null;
  }

  noteOn(id: number, pitch: number, velocity: number): void {
    const s = this.settings;
    const zones = s.zonesFor(pitch, velocity, this.hits);
    if (!zones.length) return;
    // in Slice only the notes that have a slice play
    if (s.mode === MODE.slice && (pitch < FIRST_SLICE_NOTE || pitch >= FIRST_SLICE_NOTE + s.slices.length - 1)) return;
    // monophonic the first zone plays; in poly one voice per zone
    if (this.single) this.mono.noteOn(id, pitch, velocity);
    else for (const z of zones) this.pool.noteOn(id, pitch, velocity, v => v.start(pitch, velocity, null, z));
  }

  noteOff(id: number): void {
    if (this.single) this.mono.noteOff(id);
    else this.pool.noteOff(id);
  }

  silence(): void {
    this.pool.silence();
    this.mono.silence();
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    this.pool.render(left, right, from, to);
    // each zone's free LFO cycle, which the voices take when they start
    const seconds = (to - from) / this.sampleRate;
    for (const z of this.settings.zones) z.advance(seconds);
  }

  /** Where the playing voices read: the zone plus the fraction of its sample as it's seen
   *  (2.25: a quarter of the third zone's sample). It writes them into `out` and says how many there are. */
  playheads(out: Float32Array): number {
    let k = 0;
    for (const v of this.pool.voices) {
      const p = v.position;
      if (p >= 0 && k < out.length) out[k++] = v.zoneIndex + Math.min(p, 0.9999);
    }
    return k;
  }
}
