/* Il suono di Analog: 16 voci, ognuna con due oscillatori PolyBLEP, filtro SVF con il suo
 * inviluppo, inviluppo del volume e LFO. A una voce (Mono, Legato) le note passano da una
 * pila come nei synth monofonici, con il glide; l'accento apre il filtro con un suo inviluppo
 * breve che si accumula sugli accenti vicini (il "wow" della 303). Gira nell'AudioWorklet;
 * qui niente Web Audio, così si prova anche in Node. */
import { dbToGain, midiToHz, type InstrumentCore } from '../../dsp/core';
import { Adsr } from '../../dsp/envelope';
import { LFO_TABLE, WAVE_TABLE, type Wave } from '../../dsp/oscillators';
import { Svf } from '../../dsp/svf';
import { VoicePool, type PolyVoice } from '../../dsp/voice-pool';
import { ACCENT_VELOCITY, VOICE_MODE } from './analog';

export const ANALOG_VOICES = 16;
/** Ogni quanti campioni si ricalcolano LFO, intonazione e cutoff. */
const CONTROL_RATE = 16;
/** Ottave di cutoff con inviluppo e LFO al massimo. */
const ENV_OCTAVES = 6, LFO_OCTAVES = 2;
/** L'accento al massimo: ottave in più di filtro, volume in più, durata del suo inviluppo. */
const ACCENT_OCTAVES = 2.5, ACCENT_GAIN = 0.7, ACCENT_TIME = 0.2;
/** Fin dove si accumulano gli accenti di fila. */
const ACCENT_MAX = 1.6;

/** I parametri già convertiti in quello che serve alle voci. */
class Settings {
  waveA: Wave = WAVE_TABLE[0];
  waveB: Wave = WAVE_TABLE[1];
  ratioB = 1;
  mix = 0.5;
  voiceMode = 0;
  /** Secondi. */
  glide = 0;
  accent = 0;
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
    this.voiceMode = v('voiceMode', 0);
    this.glide = v('glide', 0) / 1000;
    this.accent = v('accent', 0) / 100;
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

  /** Quanto è accentata una nota: 0 fino ad ACCENT_VELOCITY, poi su fino a 127. */
  accentOf(velocity: number): number {
    return this.accent * Math.max(0, (velocity - ACCENT_VELOCITY) / (127 - ACCENT_VELOCITY));
  }
}

class AnalogVoice implements PolyVoice {
  private readonly amp: Adsr;
  private readonly fenv: Adsr;
  private readonly filter: Svf;
  /** L'intonazione che suona (in semitoni MIDI, con il glide anche fra due note) e quella
   *  verso cui va. */
  private pitch = 60;
  private target = 60;
  private level = 1;
  /** L'inviluppo dell'accento: salta su a ogni nota accentata e ricade in ACCENT_TIME. */
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
    this.accentK = Math.exp(-CONTROL_RATE / (ACCENT_TIME * sampleRate));
  }

  get active(): boolean {
    return this.amp.active;
  }

  get releasing(): boolean {
    return this.amp.releasing;
  }

  /** L'intonazione che suona adesso (anche a metà di un glide). */
  get currentPitch(): number {
    return this.pitch;
  }

  /** Una nota da capo; con `from` l'intonazione parte da lì e scivola fino a `pitch`. */
  start(pitch: number, velocity: number, from: number | null = null): void {
    const { s } = this;
    if (!this.amp.active) {
      this.filter.reset();
      this.lfoPhase = 0;
      this.accentEnv = 0;
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

  /** Legato: la voce scivola verso `pitch` senza far ripartire gli inviluppi. L'accento della
   *  nota nuova si somma lo stesso. */
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

  /** Modulazioni a frequenza ridotta: glide, LFO, intonazione, accento, cutoff. */
  private control(): void {
    const { s, sampleRate } = this;
    this.countdown = CONTROL_RATE;
    if (this.pitch !== this.target) {
      // glide esponenziale in semitoni: arriva al 95 % in circa `glide` secondi
      const k = s.glide > 0 ? 1 - Math.exp((-3 * CONTROL_RATE) / (s.glide * sampleRate)) : 1;
      this.pitch += (this.target - this.pitch) * k;
      if (Math.abs(this.target - this.pitch) < 1e-3) this.pitch = this.target;
    }
    this.accentEnv *= this.accentK;
    const lfo = s.lfoWave(this.lfoPhase, 0);
    this.lfoPhase = (this.lfoPhase + (s.lfoRate * CONTROL_RATE) / sampleRate) % 1;
    const hz = midiToHz(this.pitch) * Math.pow(2, (lfo * s.lfoCents) / 1200);
    this.dtA = Math.min(0.49, hz / sampleRate);
    this.dtB = Math.min(0.49, this.dtA * s.ratioB);
    const octaves = s.envOctaves * this.fenv.value + s.keyTrack * (this.pitch - 60) / 12 + lfo * s.lfoOctaves
      + ACCENT_OCTAVES * this.accentEnv;
    this.filter.set(s.cutoff * Math.pow(2, octaves), s.resonance, s.filterType);
  }
}

interface HeldNote {
  readonly id: number;
  readonly pitch: number;
  readonly velocity: number;
}

/** Una voce sola, come un synth monofonico: le note tenute stanno in una pila e suona
 *  l'ultima; quando la si lascia torna quella sotto. In Legato una nota che arriva mentre
 *  un'altra è tenuta scivola senza ripartire; in Mono riparte sempre, con il glide dalla nota
 *  di prima. */
class MonoPlayer {
  private held: HeldNote[] = [];
  /** Se la voce ha già suonato qualcosa (da lì parte il glide in Mono). */
  private played = false;

  constructor(private readonly voice: AnalogVoice, private readonly s: Settings) {}

  noteOn(id: number, pitch: number, velocity: number): void {
    const tied = this.held.length > 0 && this.voice.active && !this.voice.releasing;
    this.held.push({ id, pitch, velocity });
    this.play(pitch, velocity, tied);
  }

  noteOff(id: number): void {
    const i = this.held.findIndex(n => n.id === id);
    if (i < 0) return;
    const wasPlaying = i === this.held.length - 1;
    this.held.splice(i, 1);
    if (!wasPlaying) return;
    const back = this.held.at(-1);
    if (back) this.play(back.pitch, back.velocity, true);
    else this.voice.release();
  }

  silence(): void {
    this.held = [];
    this.played = false;
    this.voice.kill();
  }

  private play(pitch: number, velocity: number, tied: boolean): void {
    if (tied && this.s.voiceMode === VOICE_MODE.legato) this.voice.slide(pitch, velocity);
    else {
      const glide = this.s.glide > 0 && this.played && (tied || this.s.voiceMode === VOICE_MODE.mono);
      this.voice.start(pitch, velocity, glide ? this.voice.currentPitch : null);
    }
    this.played = true;
  }
}

export class AnalogCore implements InstrumentCore {
  private readonly settings = new Settings();
  private readonly pool: VoicePool<AnalogVoice>;
  private readonly mono: MonoPlayer;
  /** A una voce (Mono o Legato)? null prima dei primi parametri. */
  private single: boolean | null = null;
  private scratchL = new Float32Array(128);
  private scratchR = new Float32Array(128);
  /** Guadagno d'uscita attuale: segue `settings.gain` senza scalini. */
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
    // passando da poli a una voce (o viceversa) si riparte puliti
    const single = this.settings.voiceMode !== VOICE_MODE.poly;
    if (this.single !== null && single !== this.single) this.silence();
    this.single = single;
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
