/* Il suono di Hat e Piatti (vedi cymbals.ts). Di ogni pezzo suonano al massimo due colpi: il
 * terzo fa sfumare in pochi millisecondi il più vecchio (niente click), e il chiuso e il pedale
 * sfumano l'aperto. Una voce synth somma sei quadre stonate tra loro (senza aliasing, PolyBLEP)
 * o, nel metallo "Anello", i loro prodotti a coppie; ci mescola il rumore (diverso a sinistra e
 * a destra quanto è larga) e passa per un passa-banda e un passa-alto che si alzano con la
 * brillantezza; sopra suonano i parziali della campana, con un decadimento più breve. Una voce
 * sample legge il file del pezzo (in stereo), con il filtro della brillantezza. Ogni colpo varia
 * un poco intonazione, livello e brillantezza, quanto dice la Variazione. In fondo la
 * saturazione e il volume. Gira nell'AudioWorklet; qui niente Web Audio, così si prova anche
 * fuori. */
import { dbToGain, type InstrumentCore, type SampleData, type SamplePlayer } from '../../dsp/core';
import { decayCoef } from '../../dsp/envelope';
import { Noise } from '../../dsp/noise';
import { polyBlep } from '../../dsp/oscillators';
import { Svf } from '../../dsp/svf';
import { PIECES, pieceOfNote, pieceOfSlot, pieceParam, SOURCE } from './cymbals';

const FLOOR = 1e-5;
const CHOKE_TIME = 0.004;
/** L'attacco di ogni colpo: abbastanza per non fare click. */
const ATTACK_TIME = 0.0004;
const TWO_PI = 2 * Math.PI;
const LP = 0, BP = 1, HP = 2;
/** Due colpi di un pezzo suonano insieme; il terzo posto è per quello che sfuma. */
const VOICES_PER_PIECE = 3;

/** Le frequenze delle sei quadre, per metallo (l'Anello usa quelle della 808). */
const METAL_HZ: readonly (readonly number[])[] = [
  [205.3, 304.4, 369.6, 522.7, 540, 800],
  [263, 400, 421, 474, 587, 845],
  [205.3, 304.4, 369.6, 522.7, 540, 800],
];
const RING = 2;
/** I parziali della campana (rapporti stonati come in una campana vera) e la sua nota. */
const BELL_RATIOS = [1, 1.51, 2.76, 4.07];
const BELL_HZ = 560;
/** Quanto pesa ciascun parziale della campana. */
const BELL_WEIGHTS = [0.5, 0.3, 0.22, 0.14];

/** Ciò che un colpo deve sapere del suo pezzo, già convertito. */
interface Hit {
  readonly synth: boolean;
  /** Rapporto di frequenza dall'intonazione (con la variazione). */
  readonly ratio: number;
  readonly decay: number;
  /** 0..1. */
  readonly tone: number;
  readonly noise: number;
  readonly bell: number;
  readonly gainL: number;
  readonly gainR: number;
  readonly metal: number;
  readonly width: number;
  readonly sample: SampleData | null;
}

const hermite = (x: Float32Array, k: number, f: number): number => {
  const n = x.length - 1;
  const y0 = x[k > 0 ? k - 1 : 0], y1 = x[k], y2 = x[k + 1 > n ? n : k + 1], y3 = x[k + 2 > n ? n : k + 2];
  const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * f + c2) * f + c1) * f + y1;
};

class CymbalVoice {
  active = false;
  /** Quando è partita (in colpi): la voce più vecchia di un pezzo è quella da riusare. */
  age = 0;
  private fade = 1;
  private choking = false;
  private readonly chokeK: number;
  private gainL = 0;
  private gainR = 0;
  private amp = 0;
  private ampK = 0;
  private rise = 0;
  private riseStep = 1;
  private synth = true;
  private ring = false;
  private noiseMix = 0;
  private width = 0;
  private readonly phases = new Float64Array(6);
  private readonly steps = new Float64Array(6);
  private bellAmp = 0;
  private bellK = 0;
  private readonly bellPhases = new Float64Array(BELL_RATIOS.length);
  private readonly bellSteps = new Float64Array(BELL_RATIOS.length);
  private readonly noiseA: Noise;
  private readonly noiseB: Noise;
  private readonly bpL: Svf;
  private readonly bpR: Svf;
  private readonly hpL: Svf;
  private readonly hpR: Svf;
  // il sample
  private data: SampleData | null = null;
  private pos = 0;
  private step = 1;
  private filtered = false;

  constructor(private readonly sampleRate: number, seed: number) {
    this.chokeK = decayCoef(CHOKE_TIME, sampleRate);
    this.noiseA = new Noise(seed);
    this.noiseB = new Noise(seed * 7 + 3);
    [this.bpL, this.bpR, this.hpL, this.hpR] = [0, 1, 2, 3].map(() => new Svf(sampleRate));
  }

  trigger(hit: Hit, age: number): void {
    const sr = this.sampleRate;
    this.active = true;
    this.age = age;
    this.fade = 1;
    this.choking = false;
    this.gainL = hit.gainL;
    this.gainR = hit.gainR;
    this.amp = 1;
    this.ampK = decayCoef(hit.decay, sr);
    this.rise = 0;
    this.riseStep = 1 / Math.max(1, ATTACK_TIME * sr);
    this.synth = hit.synth;
    for (const f of [this.bpL, this.bpR, this.hpL, this.hpR]) f.reset();
    if (hit.synth) {
      this.ring = hit.metal === RING;
      this.noiseMix = hit.noise;
      this.width = hit.width;
      METAL_HZ[hit.metal].forEach((hz, i) => {
        this.phases[i] = (i * 0.37) % 1;
        this.steps[i] = Math.min(0.45, (hz * hit.ratio * 1.2) / sr);
      });
      BELL_RATIOS.forEach((r, i) => {
        this.bellPhases[i] = 0;
        this.bellSteps[i] = Math.min(0.45, (BELL_HZ * r * hit.ratio) / sr);
      });
      this.bellAmp = hit.bell;
      this.bellK = decayCoef(Math.min(hit.decay, 0.25 + hit.decay * 0.5), sr);
      // la brillantezza alza insieme il centro del passa-banda e il passa-alto
      const bright = Math.pow(2, (hit.tone - 0.5) * 2.4);
      for (const f of [this.bpL, this.bpR]) f.set(8000 * bright, 0.2, BP);
      for (const f of [this.hpL, this.hpR]) f.set(5500 * bright, 0.15, HP);
      this.data = null;
    } else {
      const d = hit.sample;
      this.data = d && d.channels.length && d.channels[0].length > 2 ? d : null;
      if (!this.data) {
        this.active = false;
        return;
      }
      this.pos = 0;
      this.step = (hit.ratio * this.data.sampleRate) / sr;
      // come i pad Sample della Drum Machine: sotto metà un passa-basso, sopra un passa-alto
      const tone = hit.tone - 0.5;
      this.filtered = Math.abs(tone) > 0.02;
      if (this.filtered) {
        const [cutoff, type] = tone < 0 ? [20000 * Math.pow(100 / 20000, -2 * tone), LP] : [20 * Math.pow(250, 2 * tone), HP];
        for (const f of [this.hpL, this.hpR]) f.set(cutoff, 0.15, type);
      }
    }
  }

  choke(): void {
    if (this.active) this.choking = true;
  }

  /** Suona e non sta sfumando. */
  get sounding(): boolean {
    return this.active && !this.choking;
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    if (this.synth) this.renderSynth(left, right, from, to);
    else this.renderSample(left, right, from, to);
  }

  /** L'inviluppo di questo campione (sale in un attimo, poi decade), con la sfumatura. */
  private envelope(): number {
    if (this.rise < 1) this.rise = Math.min(1, this.rise + this.riseStep);
    else this.amp *= this.ampK;
    if (this.choking) this.fade *= this.chokeK;
    if (this.amp < FLOOR || this.fade < FLOOR) this.active = false;
    return this.rise * this.amp * this.fade;
  }

  private renderSynth(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const { phases, steps, bellPhases, bellSteps } = this;
    const n = this.noiseMix, metalMix = 1 - n * 0.85, w = this.width;
    for (let i = from; i < to && this.active; i++) {
      let metal = 0;
      if (this.ring) {
        for (let k = 0; k < 6; k += 2) metal += square(phases, steps, k) * square(phases, steps, k + 1);
        metal /= 3;
      } else {
        for (let k = 0; k < 6; k++) metal += square(phases, steps, k);
        metal /= 6;
      }
      const a = this.noiseA.next(), b = this.noiseB.next();
      const noiseL = a, noiseR = a + (b - a) * w;
      const env = this.envelope();
      let l = this.hpL.process(this.bpL.process(metal * metalMix + noiseL * n));
      let r = w > 0.001 || n > 0.001 ? this.hpR.process(this.bpR.process(metal * metalMix + noiseR * n)) : l;
      l *= env * 3.5;
      r *= env * 3.5;
      if (this.bellAmp > FLOOR) {
        let bell = 0;
        for (let k = 0; k < bellPhases.length; k++) {
          bellPhases[k] += bellSteps[k];
          if (bellPhases[k] >= 1) bellPhases[k] -= 1;
          bell += Math.sin(TWO_PI * bellPhases[k]) * BELL_WEIGHTS[k];
        }
        bell *= this.bellAmp * this.fade * Math.min(1, this.rise);
        this.bellAmp *= this.bellK;
        l += bell;
        r += bell;
      }
      left[i] += l * this.gainL;
      right[i] += r * this.gainR;
    }
  }

  private renderSample(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const d = this.data;
    if (!d) {
      this.active = false;
      return;
    }
    const L = d.channels[0], R = d.channels[1] ?? L, stereo = R !== L, end = L.length - 1;
    for (let i = from; i < to && this.active; i++) {
      const k = Math.floor(this.pos);
      if (k >= end) {
        this.active = false;
        break;
      }
      const f = this.pos - k, env = this.envelope();
      let l = hermite(L, k, f), r = stereo ? hermite(R, k, f) : l;
      if (this.filtered) {
        l = this.hpL.process(l);
        r = stereo ? this.hpR.process(r) : l;
      }
      left[i] += l * env * this.gainL;
      right[i] += r * env * this.gainR;
      this.pos += this.step;
    }
  }
}

/** La quadra `k` (senza aliasing), che avanza di un campione. */
function square(phases: Float64Array, steps: Float64Array, k: number): number {
  const dt = steps[k];
  let t = phases[k] + dt;
  if (t >= 1) t -= 1;
  phases[k] = t;
  return (t < 0.5 ? 1 : -1) + polyBlep(t, dt) - polyBlep((t + 0.5) % 1, dt);
}

export class CymbalsCore implements InstrumentCore, SamplePlayer {
  private readonly voices: CymbalVoice[][];
  private readonly samples: (SampleData | null)[] = PIECES.map(() => null);
  private values: Readonly<Record<string, number>> | null = null;
  private hits = 0;
  private readonly random = new Noise(0x51ed27);
  private scratchL = new Float32Array(128);
  private scratchR = new Float32Array(128);
  private drive = 0;
  private volume = 1;

  constructor(sampleRate: number) {
    this.voices = PIECES.map((_, p) => Array.from({ length: VOICES_PER_PIECE }, (_, v) => new CymbalVoice(sampleRate, 101 + p * 13 + v * 5)));
  }

  setParams(p: Readonly<Record<string, number>>): void {
    this.values = p;
    this.drive = p.drive / 100;
    this.volume = dbToGain(p.volume);
  }

  setSample(slot: string, sample: SampleData | null): void {
    const i = pieceOfSlot(slot);
    if (i >= 0) this.samples[i] = sample;
  }

  noteOn(_id: number, pitch: number, velocity: number): void {
    const v = this.values, i = pieceOfNote(pitch);
    if (!v || i < 0) return;
    const at = (key: Parameters<typeof pieceParam>[1]) => v[pieceParam(i, key)];
    // il chiuso e il pedale fermano l'aperto, come il charleston
    if (PIECES[i].hat === 'closes') for (const voice of this.voices[PIECES.findIndex(p => p.hat === 'open')]) voice.choke();
    const variation = v.variation / 100, rnd = () => this.random.next() * variation;
    const ratio = Math.pow(2, (at('tune') + rnd() * 0.6) / 12);
    const vel = 1 - (v.velocity / 100) * (1 - velocity / 127);
    const gain = dbToGain(at('level') + rnd() * 3) * vel;
    const pan = at('pan') / 100;
    const hit: Hit = {
      synth: at('source') === SOURCE.synth,
      ratio,
      decay: at('decay') * (1 + rnd() * 0.15),
      tone: Math.max(0, Math.min(1, at('tone') / 100 + rnd() * 0.08)),
      noise: at('noise') / 100,
      bell: (at('bell') / 100) * 0.9,
      gainL: gain * Math.min(1, 1 - pan),
      gainR: gain * Math.min(1, 1 + pan),
      metal: v.metal,
      width: v.width / 100,
      sample: this.samples[i],
    };
    // al massimo due colpi del pezzo insieme: il più vecchio sfuma, il nuovo prende una voce libera
    const voices = this.voices[i], oldest = (list: CymbalVoice[]) => list.reduce((a, b) => (a.age <= b.age ? a : b));
    const sounding = voices.filter(x => x.sounding);
    if (sounding.length >= VOICES_PER_PIECE - 1) oldest(sounding).choke();
    (voices.find(x => !x.active) ?? oldest(voices)).trigger(hit, ++this.hits);
  }

  /** I piatti suonano fino in fondo: il rilascio della nota non conta. */
  noteOff(): void {}

  silence(): void {
    for (const list of this.voices) for (const v of list) v.choke();
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const n = to - from;
    if (n <= 0 || !this.voices.some(list => list.some(v => v.active))) return;
    if (this.scratchL.length < n) [this.scratchL, this.scratchR] = [new Float32Array(n), new Float32Array(n)];
    const l = this.scratchL, r = this.scratchR;
    l.fill(0, 0, n);
    r.fill(0, 0, n);
    for (const list of this.voices) for (const v of list) if (v.active) v.render(l, r, 0, n);
    const drive = this.drive, d = 1 + drive * 8, norm = 1 / Math.tanh(d), wet = Math.min(1, drive * 4), vol = this.volume;
    for (let i = 0; i < n; i++) {
      let a = l[i], b = r[i];
      if (drive > 0.005) {
        a += (Math.tanh(a * d) * norm - a) * wet;
        b += (Math.tanh(b * d) * norm - b) * wet;
      }
      left[from + i] += a * vol;
      right[from + i] += b * vol;
    }
  }
}
