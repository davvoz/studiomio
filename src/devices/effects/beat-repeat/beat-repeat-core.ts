/* The Beat Repeat's sound. Each repetition is a "voice": at the attack it copies the last
 * milliseconds of the input (the crossfade needs them), then records the piece while it's
 * heard passing live and reads it back from there, one round after another, until the end of the Gate.
 * One round fades into the next in a few milliseconds (no clicks), and so do the start and the end;
 * a new repetition lets the old one fade out, that's why there are two voices.
 * The attacks fall on the transport's bar, sample-accurate. With "Repeat Only" no
 * timed repetitions, and in Gate the sound passes as in Insert: with the button off, the effect
 * isn't heard. Runs in the AudioWorklet; no Web Audio here. */
import { MIN_BPM } from '../../../core/music-time';
import { dbToGain, type EffectCore, type TransportFollower, type TransportPosition } from '../../dsp/core';
import { Noise } from '../../dsp/noise';
import { Svf } from '../../dsp/svf';
import { GRIDS, INTERVALS, MAX_VARIATION_HALVINGS, MIN_REPEAT_PITCH, REPEAT_MODE } from './beat-repeat';

/** The fades between one round and the next, at the start and at the end, in seconds. */
const FADE = 0.003;
/** Tolerance on the grid lines, in fractions of the grid (rounding errors). */
const EPS = 1e-9;
/** The longest piece captured, in quarters. */
const MAX_GRID_BEATS = Math.max(...GRIDS.map(([, b]) => b));

/** Svf types used for the band-pass. */
const LOW_PASS = 0, HIGH_PASS = 2;

const HALF_PI = Math.PI / 2;

/** The state of the Repeat button. */
const MANUAL = { off: 0, waiting: 1, playing: 2 } as const;
type Manual = (typeof MANUAL)[keyof typeof MANUAL];

/** What a voice wants to know about the parameters, read at every sample. */
interface Shape {
  pitch: number;
  pitchDecay: number;
  /** How much volume is left at each round (1 = no decay). */
  keep: number;
  volume: number;
}

/** A repetition: the captured piece (preceded by `fade` samples from before) and where it is. */
class Voice {
  readonly left: Float32Array;
  readonly right: Float32Array;
  active = false;
  /** Samples since the attack. */
  private t = 0;
  private len = 0;
  private gate = 0;
  private fade = 0;
  /** Speed and volume of rounds `turn` and `turn + 1`, recomputed when the round changes. */
  private turn = -1;
  private speed0 = 1;
  private level0 = 0;
  private speed1 = 1;
  private level1 = 0;
  /** How much direct sound it lets through (Insert), after the last `render`. */
  dry = 1;

  constructor(size: number) {
    this.left = new Float32Array(size);
    this.right = new Float32Array(size);
  }

  /** Starts now: `ring` holds the last input samples, the most recent before `pos`. */
  start(ringL: Float32Array, ringR: Float32Array, pos: number, fade: number, len: number, gate: number): void {
    const mask = ringL.length - 1;
    for (let j = 0; j < fade; j++) {
      const k = (pos - fade + j) & mask;
      this.left[j] = ringL[k];
      this.right[j] = ringR[k];
    }
    this.active = true;
    this.t = 0;
    this.fade = fade;
    this.len = len;
    this.gate = gate;
    this.turn = -1;
  }

  /** Stops fading (right away, if it isn't heard yet). */
  release(): void {
    if (this.active) this.gate = Math.min(this.gate, this.t + this.fade);
  }

  /** The parameters changed: speeds and volumes are recomputed. */
  touch(): void {
    this.turn = -1;
  }

  /** One sample: records the input if it's still capturing and adds the repetitions into `out`. */
  render(xL: number, xR: number, s: Shape, out: Float32Array): void {
    const { t, len, fade } = this;
    if (t < len) {
      this.left[fade + t] = xL;
      this.right[fade + t] = xR;
    }
    const turn = Math.floor(t / len), ph = t - turn * len;
    if (turn !== this.turn) this.prepare(turn, s);
    // in the last `fade` samples of a round it fades into the next (at constant power)
    let old = 1, next = 0;
    if (ph >= len - fade) {
      const a = (ph - (len - fade)) / fade;
      old = Math.cos(a * HALF_PI);
      next = Math.sin(a * HALF_PI);
    }
    let wL = 0, wR = 0;
    // round 0 is the piece passing live: it's the direct sound, not a repetition
    if (turn > 0) {
      const g = old * this.level0;
      wL += this.read(this.left, ph, this.speed0) * g;
      wR += this.read(this.right, ph, this.speed0) * g;
    }
    if (next > 0) {
      const g = next * this.level1;
      wL += this.read(this.left, ph - len, this.speed1) * g;
      wR += this.read(this.right, ph - len, this.speed1) * g;
    }
    let dry = turn === 0 ? old : 0;
    if (t >= this.gate - fade) {
      const e = Math.max(0, Math.min(1, (this.gate - t) / fade));
      const fadeOut = Math.sin(e * HALF_PI);
      wL *= fadeOut;
      wR *= fadeOut;
      dry = Math.max(dry, Math.cos(e * HALF_PI));
    }
    out[0] += wL;
    out[1] += wR;
    this.dry = dry;
    if (++this.t >= this.gate) this.active = false;
  }

  private prepare(turn: number, s: Shape): void {
    this.turn = turn;
    const speed = (k: number) => Math.pow(2, Math.max(MIN_REPEAT_PITCH, s.pitch - s.pitchDecay * (k - 1)) / 12);
    const level = (k: number) => s.volume * Math.pow(s.keep, k - 1);
    this.speed0 = speed(turn);
    this.level0 = level(turn);
    this.speed1 = speed(turn + 1);
    this.level1 = level(turn + 1);
  }

  /** The piece `ph` samples from its start (negative: in the samples before), read at `speed`. */
  private read(buf: Float32Array, ph: number, speed: number): number {
    const pos = this.fade + ph * speed;
    const i = Math.floor(pos), frac = pos - i;
    const last = this.fade + this.len - 1;
    const a = buf[Math.min(i, last)];
    return frac === 0 ? a : a + (buf[Math.min(i + 1, last)] - a) * frac;
  }
}

export class BeatRepeatCore implements EffectCore, TransportFollower {
  private readonly voices: [Voice, Voice];
  private current = 0;
  /** The last input samples (for the attack crossfade). */
  private readonly ringL: Float32Array;
  private readonly ringR: Float32Array;
  private ringPos = 0;
  private readonly maxFade: number;
  private readonly hp: [Svf, Svf];
  private readonly lp: [Svf, Svf];
  private readonly random = new Noise(0x2545f491);
  private readonly wet = new Float32Array(2);
  private readonly shape: Shape = { pitch: 0, pitchDecay: 0, keep: 1, volume: 1 };

  private bpm = 120;
  private transport: TransportPosition | null = null;
  /** The beat expected at the start of the next block: if it doesn't match, the transport jumped. */
  private expected = NaN;
  /** The last interval and the last grid line passed (to recognize the new ones). */
  private lastInterval = 0;
  private lastGrid = 0;
  private manual: Manual = MANUAL.off;

  private intervalBeats = 4;
  private intervalBars = 1;
  private offsetBeats = 2;
  private chance = 1;
  private gateBeats = 2;
  private repeat = false;
  private only = false;
  private gridBeats = 0.25;
  private variation = 0;
  private filter = false;
  private mode: number = REPEAT_MODE.mix;

  constructor(private readonly sampleRate: number) {
    this.maxFade = Math.ceil(FADE * sampleRate);
    const size = this.maxFade + Math.ceil((MAX_GRID_BEATS * 60 * sampleRate) / MIN_BPM) + 1;
    this.voices = [new Voice(size), new Voice(size)];
    let ring = 1;
    while (ring <= this.maxFade) ring *= 2;
    this.ringL = new Float32Array(ring);
    this.ringR = new Float32Array(ring);
    this.hp = [new Svf(sampleRate), new Svf(sampleRate)];
    this.lp = [new Svf(sampleRate), new Svf(sampleRate)];
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    const [, beats, bars] = INTERVALS[v('interval', 5)] ?? INTERVALS[5];
    this.intervalBeats = beats;
    this.intervalBars = bars;
    this.offsetBeats = v('offset', 8) / 4;
    this.chance = v('chance', 100) / 100;
    this.gateBeats = v('gate', 8) / 4;
    this.repeat = v('repeat', 0) === 1;
    const only = v('only', 0) === 1;
    // with "Repeat Only" on, the timed repetition that was playing stops
    if (only && !this.only && this.manual === MANUAL.off) this.voices[this.current].release();
    this.only = only;
    this.gridBeats = (GRIDS[v('grid', 3)] ?? GRIDS[3])[1];
    this.variation = v('variation', 0) / 100;
    this.mode = v('mode', REPEAT_MODE.mix);
    const s = this.shape;
    s.pitch = v('pitch', 0);
    s.pitchDecay = v('pitchDecay', 0);
    s.keep = 1 - v('decay', 0) / 100;
    s.volume = dbToGain(v('volume', 0));
    this.filter = v('filter', 0) === 1;
    const freq = v('freq', 1000), half = Math.pow(2, v('width', 3) / 2);
    for (const f of this.hp) f.set(freq / half, 0, HIGH_PASS);
    for (const f of this.lp) f.set(freq * half, 0, LOW_PASS);
    for (const voice of this.voices) voice.touch();
  }

  setTempo(bpm: number): void {
    this.bpm = bpm;
  }

  setTransport(position: TransportPosition | null): void {
    this.transport = position;
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const pos = this.transport;
    const bps = pos ? pos.bpm / 60 / this.sampleRate : 0;
    const interval = pos ? this.intervalBeats || this.intervalBars * pos.beatsPerBar : 1;
    const offset = this.offsetBeats % interval, grid = this.gridBeats;
    if (pos) {
      // started, or jumped (loop, cursor): the lines are counted from here, and one falling
      // exactly here counts
      if (!(Math.abs(pos.beat - this.expected) <= 4 * bps)) {
        this.lastInterval = Math.floor((pos.beat - bps - offset) / interval + EPS);
        this.lastGrid = Math.floor((pos.beat - bps) / grid + EPS);
      }
      this.expected = pos.beat + n * bps;
    } else this.expected = NaN;
    if (this.repeat && this.manual === MANUAL.off) this.manual = MANUAL.waiting;
    else if (!this.repeat && this.manual !== MANUAL.off) {
      if (this.manual === MANUAL.playing) this.voices[this.current].release();
      this.manual = MANUAL.off;
    }

    const { voices, wet, shape, ringL, ringR } = this;
    const mask = ringL.length - 1;
    const auto = this.manual === MANUAL.off && !this.only;
    for (let i = 0; i < n; i++) {
      const xL = inL[i], xR = inR[i];
      if (pos) {
        const b = pos.beat + i * bps;
        const k = Math.floor((b - offset) / interval + EPS), g = Math.floor(b / grid + EPS);
        if (auto && k > this.lastInterval && this.random.next() * 0.5 + 0.5 < this.chance) this.trigger(false, pos.bpm);
        if (this.manual === MANUAL.waiting && g > this.lastGrid) this.trigger(true, pos.bpm);
        this.lastInterval = k;
        this.lastGrid = g;
      } else if (this.manual === MANUAL.waiting) this.trigger(true, this.bpm);

      wet[0] = wet[1] = 0;
      let dry = 1;
      for (const voice of voices) {
        if (!voice.active) continue;
        voice.render(xL, xR, shape, wet);
        dry *= voice.dry;
      }
      let yL = wet[0], yR = wet[1];
      if (this.filter) {
        yL = this.lp[0].process(this.hp[0].process(yL));
        yR = this.lp[1].process(this.hp[1].process(yR));
      }
      let d = 0;
      if (this.mode === REPEAT_MODE.mix) d = 1;
      else if (this.mode === REPEAT_MODE.insert || this.only) d = dry;
      outL[i] = xL * d + yL;
      outR[i] = xR * d + yR;
      ringL[this.ringPos] = xL;
      ringR[this.ringPos] = xR;
      this.ringPos = (this.ringPos + 1) & mask;
    }
  }

  /** A repetition from this sample: the one playing fades out. With Repeat it lasts while it
   *  stays on. */
  private trigger(manual: boolean, bpm: number): void {
    if (manual) this.manual = MANUAL.playing;
    const samplesPerBeat = (this.sampleRate * 60) / bpm;
    let grid = this.gridBeats;
    if (this.variation > 0) {
      const most = Math.round(this.variation * MAX_VARIATION_HALVINGS);
      grid /= 2 ** Math.min(most, Math.floor((this.random.next() * 0.5 + 0.5) * (most + 1)));
    }
    const len = Math.max(4, Math.round(grid * samplesPerBeat));
    const fade = Math.max(1, Math.min(this.maxFade, Math.floor(len / 4)));
    const gate = manual ? Infinity : Math.max(1, Math.round(this.gateBeats * samplesPerBeat));
    this.voices[this.current].release();
    this.current ^= 1;
    this.voices[this.current].start(this.ringL, this.ringR, this.ringPos, fade, len, gate);
  }
}
