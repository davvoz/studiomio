/* Il suono del Kick (vedi kick.ts). Ogni colpo è una voce con i suoi strati: lo snap (un seno
 * acuto che cade, rumore filtrato o il sample dello snap), il corpo (un seno che cade di
 * `pitch` semitoni fino alla nota, piegato dalla Forma, o il sample del corpo) con l'inviluppo
 * attacco · hold · decay, e la coda (lo stesso seno, pulito, che resta sulla nota). Un colpo
 * nuovo fa sfumare in pochi millisecondi quello prima: la cassa è a una voce, senza click. Il
 * rumble è uno solo per tutti i colpi: quattro filtri a pettine (un piccolo riverbero) sul corpo
 * e sulla coda, scuriti, saturati e abbassati finché il corpo suona, così cresce tra un colpo e
 * l'altro. In fondo la saturazione, il taglio dei bassi e il volume. Gira nell'AudioWorklet;
 * qui niente Web Audio, così si prova (e si disegna) anche fuori. */
import { dbToGain, type InstrumentCore, type SampleData, type SamplePlayer } from '../../dsp/core';
import { decayCoef } from '../../dsp/envelope';
import { Noise } from '../../dsp/noise';
import { driveSample, softClip as soft } from '../../dsp/saturate';
import { Svf } from '../../dsp/svf';
import { BODY_SLOT, FOLLOW, kickNote, noteHz, ROOT_NOTE, SNAP_SLOT, SNAP_SOURCE, SOURCE } from './kick';

/** Sotto questo livello uno strato è finito (−100 dB). */
const FLOOR = 1e-5;
/** Quanto dura la sfumatura di un colpo interrotto (colpo nuovo, stop). */
const CHOKE_TIME = 0.004;
const TWO_PI = 2 * Math.PI;
const LP = 0, BP = 1, HP = 2;
/** I ritardi dei pettini del rumble, in secondi (tra loro primi, per non rinforzare le stesse note). */
const COMBS = [0.0233, 0.0317, 0.0379, 0.0431];

/** Un sample in mono (la cassa sta al centro) e la sua frequenza di campionamento. */
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

/** Lettura tra i campioni (Hermite a 4 punti). */
function hermite(x: Float32Array, k: number, f: number): number {
  const n = x.length - 1;
  const y0 = x[k > 0 ? k - 1 : 0], y1 = x[k], y2 = x[k + 1 > n ? n : k + 1], y3 = x[k + 2 > n ? n : k + 2];
  const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * f + c2) * f + c1) * f + y1;
}

export { driveSample } from '../../dsp/saturate';

/** I parametri del motore, già nelle sue unità. */
interface Settings {
  note: number;
  fine: number;
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
  curve: number;
  shape: number;
  sampleTune: number;
  sampleStart: number;
  attack: number;
  hold: number;
  decay: number;
  tailLevel: number;
  tailDecay: number;
  tailDrive: number;
  rumbleOn: boolean;
  rumble: number;
  rumbleTime: number;
  rumbleTone: number;
  rumbleDrive: number;
  rumbleDuck: number;
  drive: number;
  driveType: number;
  lowCut: number;
  velocity: number;
  volume: number;
}

/** Un colpo. Dopo `step`, `kick` (corpo e coda), `snap` e `body` (l'inviluppo del corpo, per
 *  abbassare il rumble) sono i valori di questo campione. */
class KickVoice {
  kick = 0;
  snap = 0;
  body = 0;
  active = false;
  private fade = 1;
  private choking = false;
  private readonly chokeK: number;
  private gain = 1;
  // il seno del corpo e della coda
  private phase = 0;
  private base = 50;
  private semis = 0;
  private curve = 1;
  private pitchEnv = 1;
  private pitchK = 0;
  private shape = 0;
  private bodyGain = 0;
  private tailGain = 0;
  private tailDrive = 0;
  private synth = true;
  // inviluppi: campioni dall'inizio, attacco e hold in campioni, livelli in decadimento
  private t = 0;
  private attackN = 1;
  private holdEnd = 1;
  private bodyAmp = 1;
  private bodyK = 0;
  private tailAmp = 1;
  private tailK = 0;
  // i sample
  private bodySample: MonoSample | null = null;
  private bodyPos = 0;
  private bodyStep = 1;
  private snapSample: MonoSample | null = null;
  private snapPos = 0;
  private snapStep = 1;
  // lo snap
  private snapSource = 0;
  private snapAmp = 0;
  private snapK = 0;
  private snapGain = 0;
  private clickPhase = 0;
  private clickHz = 3000;
  private readonly noise = new Noise(0x2545f491);
  private readonly snapFilter: Svf;

  constructor(private readonly sampleRate: number) {
    this.chokeK = decayCoef(CHOKE_TIME, sampleRate);
    this.snapFilter = new Svf(sampleRate);
  }

  trigger(s: Settings, pitch: number, velocity: number, body: MonoSample | null, snap: MonoSample | null): void {
    const sr = this.sampleRate, shift = s.follow ? pitch - ROOT_NOTE : 0;
    this.active = true;
    this.fade = 1;
    this.choking = false;
    this.gain = 1 - s.velocity * (1 - velocity / 127);
    this.t = 0;
    this.phase = 0;
    this.base = noteHz(s.note + s.fine / 100 + shift);
    this.semis = s.pitch;
    this.curve = s.curve;
    this.pitchEnv = 1;
    this.pitchK = decayCoef(s.pitchTime, sr);
    this.shape = s.shape;
    this.synth = s.bodySynth;
    this.bodyGain = s.bodyLevel;
    this.tailGain = s.tailLevel;
    this.tailDrive = s.tailDrive;
    this.attackN = Math.max(1, Math.round(s.attack * sr));
    this.holdEnd = this.attackN + Math.round(s.hold * sr);
    this.bodyAmp = 1;
    this.bodyK = decayCoef(s.decay, sr);
    this.tailAmp = 1;
    this.tailK = decayCoef(s.tailDecay, sr);
    this.bodySample = this.synth ? null : body;
    if (body && !this.synth) {
      this.bodyPos = Math.min(body.data.length - 2, Math.floor(s.sampleStart * body.data.length));
      this.bodyStep = Math.pow(2, (s.sampleTune + shift) / 12) * body.rate / sr;
    }
    this.snapSource = s.snapSource;
    this.snapGain = s.snapLevel;
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
  }

  /** Sfuma in pochi millisecondi. */
  choke(): void {
    if (this.active) this.choking = true;
  }

  step(): void {
    const sr = this.sampleRate, t = this.t++;
    // l'inviluppo: sale in `attack`, resta in `hold`, poi il corpo e la coda decadono ciascuno col suo tempo
    let rise = 1;
    if (t < this.attackN) rise = t / this.attackN;
    else {
      this.tailAmp *= this.tailK;
      if (t >= this.holdEnd) this.bodyAmp *= this.bodyK;
    }
    const bodyEnv = rise * this.bodyAmp, tailEnv = rise * this.tailAmp;
    // la caduta d'intonazione, in semitoni: più curva, più cade subito
    this.pitchEnv *= this.pitchK;
    const hz = this.base * Math.pow(2, (this.semis * Math.pow(this.pitchEnv, this.curve)) / 12);
    this.phase += hz / sr;
    if (this.phase >= 1) this.phase -= 1;
    const sine = Math.sin(TWO_PI * this.phase);
    let body = 0;
    if (this.synth) body = soft(sine, this.shape) * bodyEnv;
    else if (this.bodySample) {
      const s = this.bodySample, k = Math.floor(this.bodyPos);
      if (k < s.data.length - 1) {
        body = hermite(s.data, k, this.bodyPos - k) * bodyEnv;
        this.bodyPos += this.bodyStep;
      } else this.bodySample = null;
    }
    const tail = soft(sine, this.tailDrive) * tailEnv;
    // lo snap
    let snap = 0;
    if (this.snapAmp >= FLOOR) {
      if (this.snapSource === SNAP_SOURCE.click) {
        // un seno acuto che cade di un'ottava mentre si spegne: il "tic"
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
    if (this.choking) this.fade *= this.chokeK;
    const g = this.gain * this.fade;
    this.kick = (body * this.bodyGain + tail * this.tailGain) * g;
    this.snap = snap * this.snapGain * g;
    this.body = bodyEnv * this.fade;
    if (t > this.holdEnd && this.fade < FLOOR) this.active = false;
    else if (t > this.holdEnd && this.bodyAmp * this.bodyGain < FLOOR && this.tailAmp * this.tailGain < FLOOR && this.snapAmp < FLOOR) {
      this.active = false;
    }
  }
}

/** Un filtro a pettine con lo smorzamento degli acuti nel giro: un pezzo di riverbero. */
class Comb {
  private readonly buffer: Float32Array;
  private index = 0;
  private length = 1;
  private feedback = 0;
  private damp = 0;
  private low = 0;

  constructor(maxSamples: number) {
    this.buffer = new Float32Array(maxSamples);
  }

  set(samples: number, feedback: number, damp: number): void {
    this.length = Math.max(1, Math.min(this.buffer.length, Math.round(samples)));
    if (this.index >= this.length) this.index = 0;
    this.feedback = feedback;
    this.damp = damp;
  }

  process(x: number): number {
    const y = this.buffer[this.index];
    this.low = y + (this.low - y) * this.damp;
    this.buffer[this.index] = x + this.low * this.feedback;
    if (++this.index >= this.length) this.index = 0;
    return y;
  }

  clear(): void {
    this.buffer.fill(0);
    this.low = 0;
  }
}

export class KickCore implements InstrumentCore, SamplePlayer {
  private readonly voices: [KickVoice, KickVoice];
  private current = 0;
  private s: Settings | null = null;
  private bodySample: MonoSample | null = null;
  private snapSample: MonoSample | null = null;
  private readonly combs: Comb[];
  private readonly rumbleIn: Svf;
  private readonly rumbleLow1: Svf;
  private readonly rumbleLow2: Svf;
  private readonly lowCut: Svf;
  /** Quanto il corpo suona adesso (sale subito, scende piano): abbassa il rumble. */
  private duck = 0;
  private readonly duckRelease: number;
  private rumbleWasOn = false;
  private volume = 1;

  constructor(private readonly sampleRate: number) {
    this.voices = [new KickVoice(sampleRate), new KickVoice(sampleRate)];
    this.combs = COMBS.map(t => new Comb(Math.ceil(t * sampleRate) + 2));
    this.rumbleIn = new Svf(sampleRate);
    this.rumbleLow1 = new Svf(sampleRate);
    this.rumbleLow2 = new Svf(sampleRate);
    this.lowCut = new Svf(sampleRate);
    this.duckRelease = decayCoef(0.08, sampleRate);
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const pct = (id: string) => p[id] / 100;
    const s: Settings = {
      note: kickNote(p.note), fine: p.fine, follow: p.follow === FOLLOW.notes,
      snapSource: p.snapSource, snapLevel: pct('snapLevel'), snapTone: p.snapTone, snapDecay: p.snapDecay / 1000, snapTune: p.snapTune,
      bodySynth: p.bodySource === SOURCE.synth, bodyLevel: pct('bodyLevel'), pitch: p.pitch, pitchTime: p.pitchTime / 1000,
      curve: Math.pow(2, (p.pitchCurve - 50) / 25), shape: pct('shape'), sampleTune: p.sampleTune, sampleStart: pct('sampleStart'),
      attack: p.attack / 1000, hold: p.hold / 1000, decay: p.decay,
      tailLevel: pct('tailLevel'), tailDecay: p.tailDecay, tailDrive: pct('tailDrive'),
      rumbleOn: p.rumbleOn === 1, rumble: pct('rumble'), rumbleTime: p.rumbleTime, rumbleTone: p.rumbleTone,
      rumbleDrive: pct('rumbleDrive'), rumbleDuck: pct('rumbleDuck'),
      drive: pct('drive'), driveType: p.driveType, lowCut: p.lowCut, velocity: pct('velocity'), volume: dbToGain(p.volume),
    };
    this.s = s;
    this.volume = s.volume;
    const sr = this.sampleRate, damp = Math.exp((-TWO_PI * Math.min(4000, s.rumbleTone * 4)) / sr);
    // il tempo del rumble è quanto ci mette a scendere di 60 dB
    COMBS.forEach((t, i) => this.combs[i].set(t * sr, Math.min(0.97, Math.pow(10, (-3 * t) / s.rumbleTime)), damp));
    this.rumbleIn.set(Math.min(1200, s.rumbleTone * 3), 0, LP);
    this.rumbleLow1.set(s.rumbleTone, 0.15, LP);
    this.rumbleLow2.set(s.rumbleTone * 1.5, 0, LP);
    this.lowCut.set(s.lowCut, 0.1, HP);
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
  }

  /** La cassa suona fino in fondo, come un colpo di batteria: il rilascio della nota non conta. */
  noteOff(): void {}

  silence(): void {
    for (const v of this.voices) v.choke();
    for (const c of this.combs) c.clear();
    this.duck = 0;
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const s = this.s;
    if (!s) return;
    const [a, b] = this.voices;
    const rumbleOn = s.rumbleOn && s.rumble > 0;
    // riacceso, il rumble riparte pulito
    if (rumbleOn && !this.rumbleWasOn) for (const c of this.combs) c.clear();
    this.rumbleWasOn = rumbleOn;
    if (!a.active && !b.active && !rumbleOn) return;
    const rumbleGain = s.rumble * 1.6, rumbleDrive = 1 + s.rumbleDrive * 12, rumbleNorm = 1 / Math.tanh(rumbleDrive);
    for (let i = from; i < to; i++) {
      let kick = 0, snap = 0, body = 0;
      if (a.active) { a.step(); kick += a.kick; snap += a.snap; body = a.body; }
      if (b.active) { b.step(); kick += b.kick; snap += b.snap; body = Math.max(body, b.body); }
      let x = driveSample(kick + snap, s.drive, s.driveType);
      if (rumbleOn) {
        this.duck = body > this.duck ? body : this.duck * this.duckRelease;
        const input = this.rumbleIn.process(kick) * 0.35;
        let wet = 0;
        for (const c of this.combs) wet += c.process(input);
        wet = this.rumbleLow1.process(wet);
        wet = Math.tanh(wet * rumbleDrive) * rumbleNorm * 0.5;
        wet = this.rumbleLow2.process(wet);
        x += wet * rumbleGain * (1 - s.rumbleDuck * Math.min(1, this.duck));
      }
      const y = this.lowCut.process(x) * this.volume;
      left[i] += y;
      right[i] += y;
    }
  }
}
