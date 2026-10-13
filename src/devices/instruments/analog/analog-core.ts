/* Il suono di Analog: 16 voci, ognuna con due oscillatori PolyBLEP, filtro SVF con il suo
 * inviluppo, inviluppo del volume e LFO. Gira nell'AudioWorklet; qui niente Web Audio, così
 * si prova anche in Node. */
import { dbToGain, midiToHz, type InstrumentCore } from '../../dsp/core';
import { Adsr } from '../../dsp/envelope';
import { LFO_TABLE, WAVE_TABLE, type Wave } from '../../dsp/oscillators';
import { Svf } from '../../dsp/svf';
import { VoicePool, type PolyVoice } from '../../dsp/voice-pool';

export const ANALOG_VOICES = 16;
/** Ogni quanti campioni si ricalcolano LFO, intonazione e cutoff. */
const CONTROL_RATE = 16;
/** Ottave di cutoff con inviluppo e LFO al massimo. */
const ENV_OCTAVES = 6, LFO_OCTAVES = 2;

/** I parametri già convertiti in quello che serve alle voci. */
class Settings {
  waveA: Wave = WAVE_TABLE[0];
  waveB: Wave = WAVE_TABLE[1];
  ratioB = 1;
  mix = 0.5;
  filterType = 0;
  cutoff = 2400;
  resonance = 0.2;
  envOctaves = 0;
  keyTrack = 0.5;
  lfoWave: Wave = LFO_TABLE[0];
  lfoRate = 5;
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
    this.filterType = v('filterType', 0);
    this.cutoff = v('cutoff', 2400);
    this.resonance = v('resonance', 20) / 100;
    this.envOctaves = (v('filterEnv', 0) / 100) * ENV_OCTAVES;
    this.keyTrack = v('keyTrack', 50) / 100;
    this.lfoWave = LFO_TABLE[v('lfoWave', 0)] ?? LFO_TABLE[0];
    this.lfoRate = v('lfoRate', 5);
    this.lfoCents = v('lfoPitch', 0);
    this.lfoOctaves = (v('lfoCutoff', 0) / 100) * LFO_OCTAVES;
    this.velocity = v('velocity', 60) / 100;
    this.gain = dbToGain(v('volume', -8));
    this.filterEnv = { attack: v('fAttack', 0.003), decay: v('fDecay', 0.35), sustain: v('fSustain', 25) / 100, release: v('fRelease', 0.25) };
    this.ampEnv = { attack: v('attack', 0.003), decay: v('decay', 0.4), sustain: v('sustain', 80) / 100, release: v('release', 0.2) };
  }
}

class AnalogVoice implements PolyVoice {
  private readonly amp: Adsr;
  private readonly fenv: Adsr;
  private readonly filter: Svf;
  private pitch = 60;
  private hz = 261.6;
  private level = 1;
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
  }

  get active(): boolean {
    return this.amp.active;
  }

  get releasing(): boolean {
    return this.amp.releasing;
  }

  start(pitch: number, velocity: number): void {
    const { s } = this;
    if (!this.amp.active) {
      this.filter.reset();
      this.lfoPhase = 0;
    }
    this.pitch = pitch;
    this.hz = midiToHz(pitch);
    const v = velocity / 127;
    this.level = 1 - s.velocity + s.velocity * v * v;
    this.amp.set(s.ampEnv);
    this.fenv.set(s.filterEnv);
    this.amp.trigger();
    this.fenv.trigger();
    this.countdown = 0;
  }

  release(): void {
    this.amp.release();
    this.fenv.release();
  }

  kill(): void {
    this.amp.kill();
    this.fenv.kill();
  }

  /** I tempi degli inviluppi cambiano anche per le note che suonano già. */
  refresh(): void {
    this.amp.set(this.s.ampEnv);
    this.fenv.set(this.s.filterEnv);
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
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

  /** Modulazioni a frequenza ridotta: LFO, intonazione, cutoff. */
  private control(): void {
    const { s, sampleRate } = this;
    this.countdown = CONTROL_RATE;
    const lfo = s.lfoWave(this.lfoPhase, 0);
    this.lfoPhase = (this.lfoPhase + (s.lfoRate * CONTROL_RATE) / sampleRate) % 1;
    const hz = this.hz * Math.pow(2, (lfo * s.lfoCents) / 1200);
    this.dtA = Math.min(0.49, hz / sampleRate);
    this.dtB = Math.min(0.49, this.dtA * s.ratioB);
    const octaves = s.envOctaves * this.fenv.value + s.keyTrack * (this.pitch - 60) / 12 + lfo * s.lfoOctaves;
    this.filter.set(s.cutoff * Math.pow(2, octaves), s.resonance, s.filterType);
  }
}

export class AnalogCore implements InstrumentCore {
  private readonly settings = new Settings();
  private readonly pool: VoicePool<AnalogVoice>;
  private scratchL = new Float32Array(128);
  private scratchR = new Float32Array(128);
  /** Guadagno d'uscita attuale: segue `settings.gain` senza scalini. */
  private gain = -1;
  private readonly gainK: number;

  constructor(sampleRate: number, voices = ANALOG_VOICES) {
    this.pool = new VoicePool(Array.from({ length: voices }, () => new AnalogVoice(this.settings, sampleRate)));
    this.gainK = 1 - Math.exp(-1 / (0.01 * sampleRate));
  }

  setParams(params: Readonly<Record<string, number>>): void {
    this.settings.read(params);
    for (const v of this.pool.voices) v.refresh();
  }

  noteOn(id: number, pitch: number, velocity: number): void {
    this.pool.noteOn(id, pitch, velocity);
  }

  noteOff(id: number): void {
    this.pool.noteOff(id);
  }

  silence(): void {
    this.pool.silence();
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
