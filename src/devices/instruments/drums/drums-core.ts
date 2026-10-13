/* Il suono della Drum Machine: ogni pad ha due voci del suo modello (un colpo nuovo fa
 * sfumare in pochi millisecondi quello prima, senza click) e i modelli sono piccole sintesi
 * classiche: seni con caduta d'intonazione per casse e tom, rumore filtrato per rullante, clap
 * e shaker, sei quadre stonate tra loro per hi-hat e piatti (come la 808). Gira
 * nell'AudioWorklet; qui niente Web Audio, così si prova anche in Node. */
import { dbToGain, type InstrumentCore } from '../../dsp/core';
import { decayCoef } from '../../dsp/envelope';
import { Noise } from '../../dsp/noise';
import { WAVE_TABLE } from '../../dsp/oscillators';
import { Svf } from '../../dsp/svf';
import { DRUM_MODELS, DRUM_PADS, padOfNote, padsOf, type DrumPad } from './drums';

/** Sotto questo livello una voce è finita (−100 dB). */
const FLOOR = 1e-5;
/** Quanto dura la sfumatura di un colpo interrotto (nuovo colpo, choke, stop). */
const CHOKE_TIME = 0.004;
const LP = 0, BP = 1, HP = 2;
const TWO_PI = 2 * Math.PI;

/** Ciò che un colpo deve sapere del suo pad, già convertito. */
interface Hit {
  /** Rapporto di frequenza dall'intonazione (1 = come il modello). */
  readonly ratio: number;
  readonly decay: number;
  /** Tono e snap in 0..1. */
  readonly tone: number;
  readonly snap: number;
}

/** Saturazione morbida che tiene il picco a 1: `drive` 0 = pulito. */
const saturate = (x: number, drive: number): number => {
  if (drive < 0.01) return x;
  const d = 1 + drive * 4;
  return Math.tanh(x * d) / Math.tanh(d);
};

/** Una voce: il modello dà un campione alla volta (`next`) e tiene in `amp` il livello del suo
 *  inviluppo principale; la classe base fa guadagno, pan e la sfumatura quando viene fermata. */
export abstract class DrumVoice {
  /** Livello dell'inviluppo principale: sotto FLOOR la voce è finita. */
  protected amp = 0;
  private gainL = 0;
  private gainR = 0;
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

  /** Sfuma in pochi millisecondi. */
  choke(): void {
    if (this.active) this.choking = true;
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const { gainL, gainR } = this;
    for (let i = from; i < to; i++) {
      let v = this.next();
      if (this.choking) {
        this.fade *= this.chokeK;
        v *= this.fade;
      }
      left[i] += v * gainL;
      right[i] += v * gainR;
      if (!this.active) break;
    }
  }

  protected abstract start(hit: Hit): void;
  protected abstract next(): number;
}

/** Un seno con l'intonazione che cade da `sweep` volte la frequenza base: casse e tom. */
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

/** Battimani: tre colpi di rumore ravvicinati, poi la coda. */
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
    // finché non parte la coda la voce è viva
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

/** Le sei frequenze delle quadre della 808 per hi-hat e piatti. */
const METAL_HZ = [205.3, 304.4, 369.6, 522.7, 540, 800] as const;

/** Hi-hat e piatti: sei quadre stonate tra loro, passa-banda e passa-alto, più rumore. */
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

/** Campanaccio: due quadre, passa-banda, un colpo veloce sopra un decadimento più lento. */
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

/** Shaker: rumore acuto con un attacco breve (più lungo con poco snap). */
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

/** Le voci per id del modello: aggiungere un suono è una riga qui e una in DRUM_MODELS. */
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
};

/** Un pad: due voci per modello (nate quando servono) e i suoi valori. */
class Pad {
  settings: DrumPad | null = null;
  private readonly voices = new Map<number, readonly [DrumVoice, DrumVoice]>();
  private current = 0;

  constructor(private readonly sampleRate: number) {}

  /** Le voci del modello attuale (si creano qui, mai mentre si suona un blocco). */
  prepare(): void {
    const model = this.settings?.model ?? -1;
    const make = VOICES[DRUM_MODELS[model]?.id];
    if (make && !this.voices.has(model)) this.voices.set(model, [make(this.sampleRate), make(this.sampleRate)]);
  }

  hit(velocityGain: number): void {
    const s = this.settings;
    const pair = s && this.voices.get(s.model);
    if (!s || !pair) return;
    // il colpo prima sfuma, il nuovo parte sull'altra voce
    pair[this.current].choke();
    this.current ^= 1;
    const gain = dbToGain(s.level) * velocityGain, pan = s.pan / 100;
    pair[this.current].trigger(
      { ratio: Math.pow(2, s.tune / 12), decay: s.decay, tone: s.tone / 100, snap: s.snap / 100 },
      gain * Math.min(1, 1 - pan), gain * Math.min(1, 1 + pan));
  }

  choke(): void {
    for (const pair of this.voices.values()) for (const v of pair) v.choke();
  }

  get active(): boolean {
    for (const pair of this.voices.values()) if (pair[0].active || pair[1].active) return true;
    return false;
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    for (const pair of this.voices.values()) for (const v of pair) if (v.active) v.render(left, right, from, to);
  }
}

export class DrumCore implements InstrumentCore {
  private readonly pads: Pad[];
  private velocity = 0.7;
  private volume = 1;
  /** Guadagno d'uscita attuale: segue `volume` senza scalini. */
  private gain = -1;
  private readonly gainK: number;
  private scratchL = new Float32Array(128);
  private scratchR = new Float32Array(128);

  constructor(sampleRate: number) {
    this.pads = Array.from({ length: DRUM_PADS }, () => new Pad(sampleRate));
    this.gainK = 1 - Math.exp(-1 / (0.01 * sampleRate));
  }

  setParams(params: Readonly<Record<string, number>>): void {
    padsOf(params).forEach((s, i) => {
      this.pads[i].settings = s;
      this.pads[i].prepare();
    });
    this.velocity = (params.velocity ?? 70) / 100;
    this.volume = dbToGain(params.volume ?? -4);
  }

  noteOn(_id: number, pitch: number, velocity: number): void {
    const i = padOfNote(pitch);
    const pad = this.pads[i];
    if (!pad?.settings) return;
    const group = pad.settings.choke;
    if (group > 0) for (const other of this.pads) if (other !== pad && other.settings?.choke === group) other.choke();
    const v = velocity / 127;
    pad.hit(1 - this.velocity + this.velocity * v * v);
  }

  /** I colpi suonano fino in fondo: la durata della nota non conta. */
  noteOff(): void {}

  silence(): void {
    for (const p of this.pads) p.choke();
  }

  /** Quanti pad stanno suonando (per i test). */
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
