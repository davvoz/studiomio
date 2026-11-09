/* Analog's sound: 16 voices, each with two PolyBLEP oscillators, SVF filter with its own
 * envelope, volume envelope and LFO. With unison each voice plays up to 7 copies of the
 * oscillators, fanned out in detune and spread in stereo (the "supersaw"): then the voice has
 * two filters, one per channel. Monophonic (Mono, Legato) the notes go through a
 * stack as in monophonic synths, with glide; the accent opens the filter with its own short
 * envelope that accumulates on nearby accents (the 303's "wow"). Runs in the AudioWorklet;
 * no Web Audio here, so it's also tested in Node. */
import { dbToGain, midiToHz, type InstrumentCore } from '../../dsp/core';
import { Adsr } from '../../dsp/envelope';
import { MonoPlayer, type MonoVoice } from '../../dsp/mono-player';
import { LFO_TABLE, WAVE_TABLE, type Wave } from '../../dsp/oscillators';
import { Svf } from '../../dsp/svf';
import { VoicePool, type PolyVoice } from '../../dsp/voice-pool';
import { TEMPO_RATES } from '../../rates';
import { ACCENT_VELOCITY, LFO_SYNC, MAX_UNISON, VOICE_MODE } from './analog';

export const ANALOG_VOICES = 16;
/** Every how many samples LFO, pitch and cutoff are recomputed. */
const CONTROL_RATE = 16;
/** Cutoff octaves with envelope and LFO at maximum. */
const ENV_OCTAVES = 6, LFO_OCTAVES = 2;
/** The accent at maximum: extra filter octaves, extra volume, length of its envelope. */
const ACCENT_OCTAVES = 2.5, ACCENT_GAIN = 0.7, ACCENT_TIME = 0.2;
/** How far accents in a row accumulate. */
const ACCENT_MAX = 1.6;

/** The parameters already converted into what the voices need. */
class Settings {
  waveA: Wave = WAVE_TABLE[0];
  waveB: Wave = WAVE_TABLE[1];
  ratioB = 1;
  mix = 0.5;
  voiceMode = 0;
  /** Copies per voice, how far the outermost ones deviate (cents, ±) and how much they spread (0..1). */
  unison = 1;
  detune = 25;
  spread = 0.8;
  /** Seconds. */
  glide = 0;
  accent = 0;
  filterType = 0;
  cutoff = 2400;
  resonance = 0.2;
  envOctaves = 0;
  keyTrack = 0.5;
  lfoWave: Wave = LFO_TABLE[0];
  /** Synced (`lfoBeats` beats per cycle) or free (`lfoRate` Hz). */
  lfoTempo = false;
  lfoBeats = 1;
  lfoRate = 5;
  /** The project's tempo, for the synced LFO. */
  bpm = 120;
  lfoCents = 0;
  lfoOctaves = 0;
  velocity = 0.6;
  gain = 1;
  filterEnv = { attack: 0.003, decay: 0.35, sustain: 0.25, release: 0.25 };
  ampEnv = { attack: 0.003, decay: 0.4, sustain: 0.8, release: 0.2 };

  read(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    this.waveA = WAVE_TABLE[v('oscA', 0)] ?? WAVE_TABLE[0];
    this.waveB = WAVE_TABLE[v('oscB', 1)] ?? WAVE_TABLE[1];
    this.ratioB = Math.pow(2, (v('oscBSemi', 0) + v('oscBFine', 0) / 100) / 12);
    this.mix = v('mix', 50) / 100;
    this.voiceMode = v('voiceMode', 0);
    this.unison = Math.max(1, Math.min(MAX_UNISON, Math.round(v('unison', 1))));
    this.detune = v('detune', 25);
    this.spread = v('spread', 80) / 100;
    this.glide = v('glide', 0) / 1000;
    this.accent = v('accent', 0) / 100;
    this.filterType = v('filterType', 0);
    this.cutoff = v('cutoff', 2400);
    this.resonance = v('resonance', 20) / 100;
    this.envOctaves = (v('filterEnv', 0) / 100) * ENV_OCTAVES;
    this.keyTrack = v('keyTrack', 50) / 100;
    this.lfoWave = LFO_TABLE[v('lfoWave', 0)] ?? LFO_TABLE[0];
    this.lfoTempo = v('lfoSync', LFO_SYNC.hz) === LFO_SYNC.tempo;
    this.lfoBeats = (TEMPO_RATES[v('lfoDivision', 6)] ?? TEMPO_RATES[6])[1];
    this.lfoRate = v('lfoRate', 5);
    this.lfoCents = v('lfoPitch', 0);
    this.lfoOctaves = (v('lfoCutoff', 0) / 100) * LFO_OCTAVES;
    this.velocity = v('velocity', 60) / 100;
    this.gain = dbToGain(v('volume', -8));
    this.filterEnv = { attack: v('fAttack', 0.003), decay: v('fDecay', 0.35), sustain: v('fSustain', 25) / 100, release: v('fRelease', 0.25) };
    this.ampEnv = { attack: v('attack', 0.003), decay: v('decay', 0.4), sustain: v('sustain', 80) / 100, release: v('release', 0.2) };
  }

  /** Monophonic, whether overlapping notes slide (for MonoPlayer). */
  get legato(): boolean {
    return this.voiceMode === VOICE_MODE.legato;
  }

  /** The LFO's rate in Hz, synced or free. */
  get lfoHz(): number {
    return this.lfoTempo ? this.bpm / 60 / this.lfoBeats : this.lfoRate;
  }

  /** How accented a note is: 0 up to ACCENT_VELOCITY, then up to 127. */
  accentOf(velocity: number): number {
    return this.accent * Math.max(0, (velocity - ACCENT_VELOCITY) / (127 - ACCENT_VELOCITY));
  }
}

/** The position of copy `k` of `n` in the fan: from −1 to +1 (0 if it's alone). */
const fan = (k: number, n: number) => (n > 1 ? (2 * k) / (n - 1) - 1 : 0);

class AnalogVoice implements PolyVoice, MonoVoice {
  private readonly amp: Adsr;
  private readonly fenv: Adsr;
  private readonly filter: Svf;
  /** The right channel's filter, when unison spreads the stereo. */
  private readonly filterR: Svf;
  /** Phases and steps of the unison copies (copy 0 is the one without unison). */
  private readonly phasesA = new Float64Array(MAX_UNISON);
  private readonly phasesB = new Float64Array(MAX_UNISON);
  private readonly dtsA = new Float64Array(MAX_UNISON);
  private readonly dtsB = new Float64Array(MAX_UNISON);
  /** The pitch playing (in MIDI semitones, with the glide also between two notes) and the one
   *  it's heading for. */
  private pitch = 60;
  private target = 60;
  private level = 1;
  /** The accent's envelope: jumps up at every accented note and falls back in ACCENT_TIME. */
  private accentEnv = 0;
  private readonly accentK: number;
  private phaseA = 0;
  private phaseB = 0;
  private lfoPhase = 0;
  private dtA = 0;
  private dtB = 0;
  private countdown = 0;

  constructor(private readonly s: Settings, private readonly sampleRate: number) {
    this.amp = new Adsr(sampleRate);
    this.fenv = new Adsr(sampleRate);
    this.filter = new Svf(sampleRate);
    this.filterR = new Svf(sampleRate);
    this.accentK = Math.exp(-CONTROL_RATE / (ACCENT_TIME * sampleRate));
  }

  get active(): boolean {
    return this.amp.active;
  }

  get releasing(): boolean {
    return this.amp.releasing;
  }

  /** The pitch playing now (also halfway through a glide). */
  get currentPitch(): number {
    return this.pitch;
  }

  /** A note from the start; with `from` the pitch starts there and slides to `pitch`. */
  start(pitch: number, velocity: number, from: number | null = null): void {
    const { s } = this;
    if (!this.amp.active) {
      this.filter.reset();
      this.filterR.reset();
      this.lfoPhase = 0;
      this.accentEnv = 0;
      // the copies start from different phases (fixed: the same sound every time), so they don't
      // all add up at the same point
      for (let k = 1; k < MAX_UNISON; k++) {
        this.phasesA[k] = (k * 0.618034) % 1;
        this.phasesB[k] = (k * 0.381966) % 1;
      }
    }
    this.target = pitch;
    this.pitch = from ?? pitch;
    const v = velocity / 127, accent = s.accentOf(velocity);
    this.level = (1 - s.velocity + s.velocity * v * v) * (1 + ACCENT_GAIN * accent);
    this.accentEnv = Math.min(ACCENT_MAX, this.accentEnv + accent);
    this.amp.set(s.ampEnv);
    this.fenv.set(s.filterEnv);
    this.amp.trigger();
    this.fenv.trigger();
    this.countdown = 0;
  }

  /** Legato: the voice slides towards `pitch` without restarting the envelopes. The new note's
   *  accent is added anyway. */
  slide(pitch: number, velocity: number): void {
    this.target = pitch;
    this.accentEnv = Math.min(ACCENT_MAX, this.accentEnv + this.s.accentOf(velocity));
  }

  release(): void {
    this.amp.release();
    this.fenv.release();
  }

  kill(): void {
    this.amp.kill();
    this.fenv.kill();
  }

  /** The envelope times change also for notes already playing. */
  refresh(): void {
    this.amp.set(this.s.ampEnv);
    this.fenv.set(this.s.filterEnv);
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    if (this.s.unison > 1) return this.renderUnison(left, right, from, to);
    const { s, amp, fenv, filter } = this;
    const { waveA, waveB } = s;
    const mixB = s.mix, mixA = 1 - mixB;
    for (let i = from; i < to; i++) {
      if (--this.countdown <= 0) this.control();
      const a = waveA(this.phaseA, this.dtA), b = waveB(this.phaseB, this.dtB);
      this.phaseA += this.dtA;
      if (this.phaseA >= 1) this.phaseA -= 1;
      this.phaseB += this.dtB;
      if (this.phaseB >= 1) this.phaseB -= 1;
      fenv.next();
      const out = filter.process(a * mixA + b * mixB) * amp.next() * this.level;
      left[i] += out;
      right[i] += out;
      if (!amp.active) break;
    }
  }

  /** The unison: the fanned copies, each with its pan; two filters, one per channel.
   *  The level drops as the square root of the copies (the power stays that of one). */
  private renderUnison(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const { s, amp, fenv, filter, filterR, phasesA, phasesB, dtsA, dtsB } = this;
    const { waveA, waveB } = s;
    const n = s.unison, norm = 1 / Math.sqrt(n);
    const mixB = s.mix * norm, mixA = (1 - s.mix) * norm;
    for (let i = from; i < to; i++) {
      if (--this.countdown <= 0) this.control();
      let l = 0, r = 0;
      for (let k = 0; k < n; k++) {
        const v = waveA(phasesA[k], dtsA[k]) * mixA + waveB(phasesB[k], dtsB[k]) * mixB;
        phasesA[k] += dtsA[k];
        if (phasesA[k] >= 1) phasesA[k] -= 1;
        phasesB[k] += dtsB[k];
        if (phasesB[k] >= 1) phasesB[k] -= 1;
        // constant-power pan along the fan
        const p = fan(k, n) * s.spread;
        l += v * Math.sqrt(0.5 * (1 - p));
        r += v * Math.sqrt(0.5 * (1 + p));
      }
      fenv.next();
      const g = amp.next() * this.level * Math.SQRT2;
      left[i] += filter.process(l) * g;
      right[i] += filterR.process(r) * g;
      if (!amp.active) break;
    }
  }

  /** Modulations at reduced rate: glide, LFO, pitch, accent, cutoff. */
  private control(): void {
    const { s, sampleRate } = this;
    this.countdown = CONTROL_RATE;
    if (this.pitch !== this.target) {
      // exponential glide in semitones: it gets to 95 % in about `glide` seconds
      const k = s.glide > 0 ? 1 - Math.exp((-3 * CONTROL_RATE) / (s.glide * sampleRate)) : 1;
      this.pitch += (this.target - this.pitch) * k;
      if (Math.abs(this.target - this.pitch) < 1e-3) this.pitch = this.target;
    }
    this.accentEnv *= this.accentK;
    const lfo = s.lfoWave(this.lfoPhase, 0);
    this.lfoPhase = (this.lfoPhase + (s.lfoHz * CONTROL_RATE) / sampleRate) % 1;
    const hz = midiToHz(this.pitch) * Math.pow(2, (lfo * s.lfoCents) / 1200);
    this.dtA = Math.min(0.49, hz / sampleRate);
    this.dtB = Math.min(0.49, this.dtA * s.ratioB);
    if (s.unison > 1) {
      for (let k = 0; k < s.unison; k++) {
        const ratio = Math.pow(2, (fan(k, s.unison) * s.detune) / 1200);
        this.dtsA[k] = Math.min(0.49, this.dtA * ratio);
        this.dtsB[k] = Math.min(0.49, this.dtB * ratio);
      }
    }
    const octaves = s.envOctaves * this.fenv.value + s.keyTrack * (this.pitch - 60) / 12 + lfo * s.lfoOctaves
      + ACCENT_OCTAVES * this.accentEnv;
    this.filter.set(s.cutoff * Math.pow(2, octaves), s.resonance, s.filterType);
    if (s.unison > 1) this.filterR.set(s.cutoff * Math.pow(2, octaves), s.resonance, s.filterType);
  }
}

export class AnalogCore implements InstrumentCore {
  private readonly settings = new Settings();
  private readonly pool: VoicePool<AnalogVoice>;
  private readonly mono: MonoPlayer;
  /** Monophonic (Mono or Legato)? null before the first parameters. */
  private single: boolean | null = null;
  private scratchL = new Float32Array(128);
  private scratchR = new Float32Array(128);
  /** Current output gain: follows `settings.gain` without steps. */
  private gain = -1;
  private readonly gainK: number;

  constructor(sampleRate: number, voices = ANALOG_VOICES) {
    this.pool = new VoicePool(Array.from({ length: voices }, () => new AnalogVoice(this.settings, sampleRate)));
    this.mono = new MonoPlayer(this.pool.voices[0], this.settings);
    this.gainK = 1 - Math.exp(-1 / (0.01 * sampleRate));
  }

  setParams(params: Readonly<Record<string, number>>): void {
    this.settings.read(params);
    for (const v of this.pool.voices) v.refresh();
    // switching from poly to mono (or vice versa) restarts clean
    const single = this.settings.voiceMode !== VOICE_MODE.poly;
    if (this.single !== null && single !== this.single) this.silence();
    this.single = single;
  }

  setTempo(bpm: number): void {
    if (bpm > 0) this.settings.bpm = bpm;
  }

  noteOn(id: number, pitch: number, velocity: number): void {
    if (this.single) this.mono.noteOn(id, pitch, velocity);
    else this.pool.noteOn(id, pitch, velocity);
  }

  noteOff(id: number): void {
    if (this.single) this.mono.noteOff(id);
    else this.pool.noteOff(id);
  }

  silence(): void {
    this.pool.silence();
    this.mono.silence();
  }

  get activeVoices(): number {
    return this.pool.activeCount;
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    if (this.gain < 0) this.gain = this.settings.gain;
    if (this.pool.activeCount === 0) return;
    const n = to - from;
    if (this.scratchL.length < n) {
      this.scratchL = new Float32Array(n);
      this.scratchR = new Float32Array(n);
    }
    const l = this.scratchL.subarray(0, n), r = this.scratchR.subarray(0, n);
    l.fill(0);
    r.fill(0);
    this.pool.render(l, r, 0, n);
    const target = this.settings.gain, k = this.gainK;
    let g = this.gain;
    for (let i = 0; i < n; i++) {
      g += (target - g) * k;
      left[from + i] += l[i] * g;
      right[from + i] += r[i] * g;
    }
    this.gain = g;
  }
}
