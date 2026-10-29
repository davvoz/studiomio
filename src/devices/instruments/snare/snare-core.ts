/* Il suono dello Snare (vedi snare.ts). Ogni colpo è una voce con i suoi strati: il colpo (un
 * seno acuto che cade, rumore filtrato o il sample del colpo), la pelle (i due modi della
 * membrana, la nota e 1,59 volte la nota, con una piccola caduta d'intonazione e il secondo che
 * si spegne prima, piegati dalla Forma; o il sample della pelle) e la cordiera (rumore, tenuto
 * fermo qualche campione quanto dice la Grana, tra un passa-alto e un passa-basso, che parte dopo
 * il Ritardo). Un colpo nuovo fa sfumare in pochi millisecondi quello prima. I colpi piano sono
 * più deboli e, quanto dice "Vel → tono", più scuri: meno colpo e una cordiera meno brillante.
 * Dopo la saturazione la stanza: per canale quattro filtri a pettine e due passa-tutto (un
 * piccolo riverbero alla Schroeder), con i ritardi un po' diversi a sinistra e a destra. In fondo
 * il taglio dei bassi e il volume. Gira nell'AudioWorklet; qui niente Web Audio, così si prova (e
 * si disegna) anche fuori. */
import { dbToGain, type InstrumentCore, type SampleData, type SamplePlayer } from '../../dsp/core';
import { decayCoef } from '../../dsp/envelope';
import { Noise } from '../../dsp/noise';
import { driveSample, softClip } from '../../dsp/saturate';
import { Svf } from '../../dsp/svf';
import { BODY_SLOT, FOLLOW, noteHz, OVERTONE, ROOT_NOTE, SNAP_SLOT, SNAP_SOURCE, snareNote, SOURCE } from './snare';

const FLOOR = 1e-5;
const CHOKE_TIME = 0.004;
/** L'attacco della pelle e della cordiera: abbastanza per non fare click. */
const ATTACK_TIME = 0.0003;
const TWO_PI = 2 * Math.PI;
const LP = 0, BP = 1, HP = 2;
/** I ritardi dei pettini e dei passa-tutto della stanza, in secondi (a destra un po' più lunghi). */
const COMBS = [0.0113, 0.0137, 0.0161, 0.0187];
const ALLPASSES = [0.0051, 0.0017];
const SPREAD = 0.0007;

interface MonoSample {
  readonly data: Float32Array;
  readonly rate: number;
}

function mono(d: SampleData | null): MonoSample | null {
  if (!d || !d.channels.length || d.channels[0].length < 4) return null;
  const [l, r] = d.channels;
  if (!r || r === l) return { data: l, rate: d.sampleRate };
  const data = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) data[i] = (l[i] + r[i]) * 0.5;
  return { data, rate: d.sampleRate };
}

function hermite(x: Float32Array, k: number, f: number): number {
  const n = x.length - 1;
  const y0 = x[k > 0 ? k - 1 : 0], y1 = x[k], y2 = x[k + 1 > n ? n : k + 1], y3 = x[k + 2 > n ? n : k + 2];
  const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * f + c2) * f + c1) * f + y1;
}

/** I parametri del motore, già nelle sue unità. */
interface Settings {
  note: number;
  follow: boolean;
  snapSource: number;
  snapLevel: number;
  snapTone: number;
  snapDecay: number;
  snapTune: number;
  bodySynth: boolean;
  bodyLevel: number;
  pitch: number;
  pitchTime: number;
  overtone: number;
  shape: number;
  sampleTune: number;
  sampleStart: number;
  decay: number;
  wiresLevel: number;
  wiresTone: number;
  wiresDecay: number;
  wiresDelay: number;
  grain: number;
  velocity: number;
  velTone: number;
}

/** Un colpo. Dopo `step`, `out` è il suo valore in questo campione. */
class SnareVoice {
  out = 0;
  active = false;
  private fade = 1;
  private choking = false;
  private readonly chokeK: number;
  private gain = 1;
  private t = 0;
  private attackN = 1;
  // la pelle
  private synth = true;
  private base = 200;
  private semis = 0;
  private pitchEnv = 1;
  private pitchK = 0;
  private phase1 = 0;
  private phase2 = 0;
  private amp1 = 1;
  private amp2 = 1;
  private k1 = 0;
  private k2 = 0;
  private overtone = 0;
  private shape = 0;
  private bodyGain = 0;
  private bodySample: MonoSample | null = null;
  private bodyPos = 0;
  private bodyStep = 1;
  // il colpo
  private snapSource = 0;
  private snapAmp = 0;
  private snapK = 0;
  private snapGain = 0;
  private clickPhase = 0;
  private clickHz = 4000;
  private snapSample: MonoSample | null = null;
  private snapPos = 0;
  private snapStep = 1;
  private readonly noise = new Noise(0x1b873593);
  private readonly snapFilter: Svf;
  // la cordiera
  private wiresGain = 0;
  private wiresAmp = 1;
  private wiresK = 0;
  private wiresStart = 0;
  private holdEvery = 1;
  private held = 0;
  private heldFor = 0;
  private readonly wiresNoise = new Noise(0x85ebca6b);
  private readonly wiresHp: Svf;
  private readonly wiresLp: Svf;

  constructor(private readonly sampleRate: number) {
    this.chokeK = decayCoef(CHOKE_TIME, sampleRate);
    this.snapFilter = new Svf(sampleRate);
    this.wiresHp = new Svf(sampleRate);
    this.wiresLp = new Svf(sampleRate);
  }

  trigger(s: Settings, pitch: number, velocity: number, body: MonoSample | null, snap: MonoSample | null): void {
    const sr = this.sampleRate, shift = s.follow ? pitch - ROOT_NOTE : 0, vel = velocity / 127;
    // piano: più debole e, quanto dice "Vel → tono", più scuro
    const bright = 1 - s.velTone * (1 - vel) * 0.8;
    this.active = true;
    this.fade = 1;
    this.choking = false;
    this.gain = 1 - s.velocity * (1 - vel);
    this.t = 0;
    this.attackN = Math.max(1, Math.round(ATTACK_TIME * sr));
    this.synth = s.bodySynth;
    this.base = noteHz(s.note + shift);
    this.semis = s.pitch;
    this.pitchEnv = 1;
    this.pitchK = decayCoef(s.pitchTime, sr);
    this.phase1 = this.phase2 = 0;
    this.amp1 = this.amp2 = 1;
    this.k1 = decayCoef(s.decay, sr);
    this.k2 = decayCoef(s.decay * 0.55, sr);
    this.overtone = s.overtone;
    this.shape = s.shape;
    this.bodyGain = s.bodyLevel;
    this.bodySample = this.synth ? null : body;
    if (body && !this.synth) {
      this.bodyPos = Math.min(body.data.length - 2, Math.floor(s.sampleStart * body.data.length));
      this.bodyStep = Math.pow(2, (s.sampleTune + shift) / 12) * body.rate / sr;
    }
    this.snapSource = s.snapSource;
    this.snapGain = s.snapLevel * bright;
    this.snapAmp = 1;
    this.snapK = decayCoef(s.snapDecay, sr);
    this.clickPhase = 0;
    this.clickHz = s.snapTone;
    this.snapSample = s.snapSource === SNAP_SOURCE.sample ? snap : null;
    if (this.snapSample) {
      this.snapPos = 0;
      this.snapStep = Math.pow(2, s.snapTune / 12) * this.snapSample.rate / sr;
    }
    this.snapFilter.reset();
    this.snapFilter.set(s.snapTone, 0.3, BP);
    this.wiresGain = s.wiresLevel;
    this.wiresAmp = 1;
    this.wiresK = decayCoef(s.wiresDecay, sr);
    this.wiresStart = Math.round(s.wiresDelay * sr);
    this.holdEvery = 1 + Math.round(s.grain * s.grain * 24);
    this.heldFor = 0;
    this.wiresHp.reset();
    this.wiresLp.reset();
    this.wiresHp.set(s.wiresTone, 0.1, HP);
    this.wiresLp.set(Math.min(18000, s.wiresTone * 6 * bright * bright), 0.05, LP);
  }

  choke(): void {
    if (this.active) this.choking = true;
  }

  step(): void {
    const sr = this.sampleRate, t = this.t++;
    const rise = t < this.attackN ? t / this.attackN : 1;
    // la pelle
    let body = 0;
    if (this.synth) {
      this.pitchEnv *= this.pitchK;
      const hz = this.base * Math.pow(2, (this.semis * this.pitchEnv) / 12);
      this.phase1 += hz / sr;
      if (this.phase1 >= 1) this.phase1 -= 1;
      this.phase2 += (hz * OVERTONE) / sr;
      if (this.phase2 >= 1) this.phase2 -= 1;
      const v = Math.sin(TWO_PI * this.phase1) * this.amp1 + Math.sin(TWO_PI * this.phase2) * this.amp2 * this.overtone;
      body = softClip(v / (1 + this.overtone * 0.5), this.shape) * rise;
    } else if (this.bodySample) {
      const s = this.bodySample, k = Math.floor(this.bodyPos);
      if (k < s.data.length - 1) {
        body = hermite(s.data, k, this.bodyPos - k) * this.amp1 * rise;
        this.bodyPos += this.bodyStep;
      } else this.bodySample = null;
    }
    this.amp1 *= this.k1;
    this.amp2 *= this.k2;
    // il colpo
    let snap = 0;
    if (this.snapAmp >= FLOOR) {
      if (this.snapSource === SNAP_SOURCE.click) {
        this.clickPhase += (this.clickHz * (1 + this.snapAmp)) / sr;
        if (this.clickPhase >= 1) this.clickPhase -= 1;
        snap = Math.sin(TWO_PI * this.clickPhase) * this.snapAmp;
      } else if (this.snapSource === SNAP_SOURCE.noise) {
        snap = this.snapFilter.process(this.noise.next()) * this.snapAmp * 4;
      } else if (this.snapSample) {
        const s = this.snapSample, k = Math.floor(this.snapPos);
        if (k < s.data.length - 1) {
          snap = hermite(s.data, k, this.snapPos - k) * this.snapAmp;
          this.snapPos += this.snapStep;
        } else this.snapSample = null;
      }
      this.snapAmp *= this.snapK;
    }
    // la cordiera, dopo il ritardo; con la grana il rumore resta fermo qualche campione
    let wires = 0;
    if (t >= this.wiresStart) {
      if (this.heldFor-- <= 0) {
        this.held = this.wiresNoise.next();
        this.heldFor = this.holdEvery - 1;
      }
      const w = t - this.wiresStart, wRise = w < this.attackN ? w / this.attackN : 1;
      wires = this.wiresLp.process(this.wiresHp.process(this.held)) * this.wiresAmp * wRise * 1.6;
      this.wiresAmp *= this.wiresK;
    }
    if (this.choking) this.fade *= this.chokeK;
    this.out = (body * this.bodyGain + snap * this.snapGain + wires * this.wiresGain) * this.gain * this.fade;
    const silent = this.amp1 * this.bodyGain < FLOOR && this.snapAmp < FLOOR && (t < this.wiresStart || this.wiresAmp * this.wiresGain < FLOOR);
    if (this.fade < FLOOR || (silent && t > this.wiresStart)) this.active = false;
  }
}

/** Un filtro a pettine con lo smorzamento degli acuti nel giro. */
class Comb {
  private readonly buffer: Float32Array;
  private index = 0;
  private feedback = 0;
  private damp = 0;
  private low = 0;

  constructor(samples: number) {
    this.buffer = new Float32Array(Math.max(1, Math.round(samples)));
  }

  set(feedback: number, damp: number): void {
    this.feedback = feedback;
    this.damp = damp;
  }

  process(x: number): number {
    const y = this.buffer[this.index];
    this.low = y + (this.low - y) * this.damp;
    this.buffer[this.index] = x + this.low * this.feedback;
    if (++this.index >= this.buffer.length) this.index = 0;
    return y;
  }

  clear(): void {
    this.buffer.fill(0);
    this.low = 0;
  }
}

/** Un passa-tutto di Schroeder: sparpaglia gli echi dei pettini senza colorare. */
class Allpass {
  private readonly buffer: Float32Array;
  private index = 0;

  constructor(samples: number) {
    this.buffer = new Float32Array(Math.max(1, Math.round(samples)));
  }

  process(x: number): number {
    const b = this.buffer[this.index], y = b - 0.5 * x;
    this.buffer[this.index] = x + 0.5 * y;
    if (++this.index >= this.buffer.length) this.index = 0;
    return y;
  }

  clear(): void {
    this.buffer.fill(0);
  }
}

/** La stanza di un canale. */
class Room {
  private readonly combs: Comb[];
  private readonly allpasses: Allpass[];

  constructor(private readonly sampleRate: number, extra: number) {
    this.combs = COMBS.map(t => new Comb((t + extra) * sampleRate));
    this.allpasses = ALLPASSES.map(t => new Allpass((t + extra / 2) * sampleRate));
  }

  set(time: number, tone: number): void {
    const damp = Math.exp((-TWO_PI * tone) / this.sampleRate);
    COMBS.forEach((t, i) => this.combs[i].set(Math.min(0.98, Math.pow(10, (-3 * t) / time)), damp));
  }

  process(x: number): number {
    let y = 0;
    for (const c of this.combs) y += c.process(x);
    y *= 0.5;
    for (const a of this.allpasses) y = a.process(y);
    return y;
  }

  clear(): void {
    for (const c of this.combs) c.clear();
    for (const a of this.allpasses) a.clear();
  }
}

export class SnareCore implements InstrumentCore, SamplePlayer {
  private readonly voices: [SnareVoice, SnareVoice];
  private current = 0;
  private s: Settings | null = null;
  private bodySample: MonoSample | null = null;
  private snapSample: MonoSample | null = null;
  private readonly roomL: Room;
  private readonly roomR: Room;
  private readonly lowCutL: Svf;
  private readonly lowCutR: Svf;
  private roomOn = false;
  private roomWasOn = false;
  private room = 0;
  private drive = 0;
  private driveType = 0;
  private volume = 1;
  /** Campioni da quando l'ultimo colpo si è spento: la stanza suona ancora un po'. */
  private quiet = 0;
  private readonly roomTail: number;

  constructor(sampleRate: number) {
    this.voices = [new SnareVoice(sampleRate), new SnareVoice(sampleRate)];
    this.roomL = new Room(sampleRate, 0);
    this.roomR = new Room(sampleRate, SPREAD);
    this.lowCutL = new Svf(sampleRate);
    this.lowCutR = new Svf(sampleRate);
    this.roomTail = sampleRate * 4;
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const pct = (id: string) => p[id] / 100;
    this.s = {
      note: snareNote(p.note) + p.fine / 100, follow: p.follow === FOLLOW.notes,
      snapSource: p.snapSource, snapLevel: pct('snapLevel'), snapTone: p.snapTone, snapDecay: p.snapDecay / 1000, snapTune: p.snapTune,
      bodySynth: p.bodySource === SOURCE.synth, bodyLevel: pct('bodyLevel'), pitch: p.pitch, pitchTime: p.pitchTime / 1000,
      overtone: pct('overtone'), shape: pct('shape'), sampleTune: p.sampleTune, sampleStart: pct('sampleStart'), decay: p.decay,
      wiresLevel: pct('wiresLevel'), wiresTone: p.wiresTone, wiresDecay: p.wiresDecay, wiresDelay: p.wiresDelay / 1000, grain: pct('grain'),
      velocity: pct('velocity'), velTone: pct('velTone'),
    };
    this.roomOn = p.roomOn === 1 && p.room > 0;
    this.room = pct('room');
    this.roomL.set(p.roomTime, p.roomTone);
    this.roomR.set(p.roomTime, p.roomTone);
    this.drive = pct('drive');
    this.driveType = p.driveType;
    this.lowCutL.set(p.lowCut, 0.1, HP);
    this.lowCutR.set(p.lowCut, 0.1, HP);
    this.volume = dbToGain(p.volume);
  }

  setSample(slot: string, sample: SampleData | null): void {
    if (slot === BODY_SLOT) this.bodySample = mono(sample);
    else if (slot === SNAP_SLOT) this.snapSample = mono(sample);
  }

  noteOn(_id: number, pitch: number, velocity: number): void {
    if (!this.s) return;
    this.voices[this.current].choke();
    this.current = 1 - this.current;
    this.voices[this.current].trigger(this.s, pitch, velocity, this.bodySample, this.snapSample);
    this.quiet = 0;
  }

  /** Il rullante suona fino in fondo: il rilascio della nota non conta. */
  noteOff(): void {}

  silence(): void {
    for (const v of this.voices) v.choke();
    this.roomL.clear();
    this.roomR.clear();
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const [a, b] = this.voices;
    const room = this.roomOn;
    // riaccesa, la stanza riparte pulita
    if (room && !this.roomWasOn) { this.roomL.clear(); this.roomR.clear(); }
    this.roomWasOn = room;
    if (!a.active && !b.active && (!room || this.quiet > this.roomTail)) return;
    const wet = this.room * 1.5, vol = this.volume;
    for (let i = from; i < to; i++) {
      let x = 0;
      if (a.active) { a.step(); x += a.out; }
      if (b.active) { b.step(); x += b.out; }
      if (!a.active && !b.active) this.quiet++;
      x = driveSample(x, this.drive, this.driveType);
      let l = x, r = x;
      if (room) {
        l += this.roomL.process(x) * wet;
        r += this.roomR.process(x) * wet;
      }
      left[i] += this.lowCutL.process(l) * vol;
      right[i] += this.lowCutR.process(r) * vol;
    }
  }
}
