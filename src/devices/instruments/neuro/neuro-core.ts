/* Il suono di Neuro: una voce sola, calcolata al doppio della frequenza di campionamento (le
 * non linearità — FM, fold, drive, distorsione — creano armoniche che altrimenti si
 * ripiegherebbero in sporcizia stonata) e riportata giù con il filtro a mezza banda.
 *
 *   oscillatori (unison, FM) → fold → drive → filtro → formante → distorsione → × inviluppo
 *   → passa-alto al taglio ─┐
 *   sub (seno, centrato) ───┴→ somma → giù a 1× → volume
 *
 * Le modulazioni (due LFO a tempo e un inviluppo, due destinazioni ciascuno) si ricalcolano
 * ogni CONTROL_RATE campioni e si sommano ai valori delle manopole. Gira nell'AudioWorklet;
 * qui niente Web Audio, così si prova anche in Node. */
import { dbToGain, midiToHz, type InstrumentCore } from '../../dsp/core';
import { Adsr } from '../../dsp/envelope';
import { Noise } from '../../dsp/noise';
import { WAVE_TABLE, type Wave } from '../../dsp/oscillators';
import { Oversampler } from '../../dsp/oversampler';
import { Tpt } from '../../dsp/tpt';
import { MAX_UNISON } from '../analog/analog';
import { FM_RATIOS, LFO_RATES, MOD_DEST, MOD_DESTINATIONS, NEURO_MODE, SUB_OCTAVES } from './neuro';

const OVERSAMPLE = 2;
/** Ogni quanti campioni (alla frequenza alta) si ricalcolano modulazioni e filtri. */
const CONTROL_RATE = 16;
/** La FM al massimo sposta la fase di un giro intero (indice 2π). */
const FM_DEPTH = 1;
const SUB_GAIN = 0.7;
const HALF_PI = Math.PI / 2;
/** Il guadagno che rimette il formante al livello del suono che entra. */
const FORMANT_MAKEUP = 2.2;
/** Le vocali (A E I O U): tre formanti, frequenza (Hz) e livello (dB), da una voce maschile. */
const VOWELS: readonly (readonly (readonly [hz: number, db: number])[])[] = [
  [[780, 0], [1150, -4], [2800, -14]],
  [[420, 0], [1650, -9], [2650, -13]],
  [[290, 0], [2050, -12], [2950, -17]],
  [[460, 0], [820, -5], [2800, -20]],
  [[330, 0], [700, -10], [2500, -24]],
];
/** Larghezza di banda dei tre formanti (Hz): stretti abbastanza da sentire la vocale. */
const FORMANT_BANDWIDTH = [90, 110, 170];

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** La posizione della copia `k` di `n` nel ventaglio: da −1 a +1 (0 se è sola). */
const fan = (k: number, n: number) => (n > 1 ? (2 * k) / (n - 1) - 1 : 0);

/** I parametri già convertiti in quello che serve alla voce. */
class Settings {
  waveA: Wave = WAVE_TABLE[0];
  waveB: Wave = WAVE_TABLE[0];
  ratioB = 1;
  mix = 0.5;
  unison = 3;
  detune = 18;
  spread = 0.7;
  fm = 0;
  fmRatio = 1;
  fold = 0;
  filterType = 0;
  cutoff = 1200;
  resonance = 0.25;
  drive = 0.2;
  keyTrack = 0.3;
  formant = 0;
  vowel = 0;
  formantShift = 1;
  dist = 0;
  sub = 0.7;
  subRatio = 1;
  crossover = 110;
  voiceMode: number = NEURO_MODE.legato;
  glide = 0.04;
  transpose = 0;
  velocity = 0.3;
  gain = 1;
  ampEnv = { attack: 0.002, decay: 0.4, sustain: 1, release: 0.06 };
  modEnv = { attack: 0.001, decay: 0.25, sustain: 0, release: 0.1 };
  /** Le tre fonti di modulazione (LFO 1, LFO 2, inviluppo), due destinazioni ciascuna. */
  readonly lfos = [new LfoSettings(), new LfoSettings()];
  envRoutes: readonly Route[] = [];

  read(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    this.waveA = WAVE_TABLE[v('oscA', 0)] ?? WAVE_TABLE[0];
    this.waveB = WAVE_TABLE[v('oscB', 0)] ?? WAVE_TABLE[0];
    this.ratioB = Math.pow(2, (v('oscBSemi', 0) + v('oscBFine', -12) / 100) / 12);
    this.mix = v('mix', 50) / 100;
    this.unison = Math.max(1, Math.min(MAX_UNISON, Math.round(v('unison', 3))));
    this.detune = v('detune', 18);
    this.spread = v('spread', 70) / 100;
    this.fm = v('fm', 0) / 100;
    this.fmRatio = FM_RATIOS[v('fmRatio', 1)] ?? 1;
    this.fold = v('fold', 0) / 100;
    this.filterType = v('filterType', 0);
    this.cutoff = v('cutoff', 1200);
    this.resonance = v('resonance', 25) / 100;
    this.drive = v('drive', 20) / 100;
    this.keyTrack = v('keyTrack', 30) / 100;
    this.formant = v('formant', 0) / 100;
    this.vowel = v('vowel', 0);
    this.formantShift = Math.pow(2, v('formantShift', 0) / 12);
    this.dist = v('dist', 0) / 100;
    this.sub = v('sub', 70) / 100;
    this.subRatio = Math.pow(2, SUB_OCTAVES[v('subOctave', 0)] ?? 0);
    this.crossover = v('crossover', 110);
    this.voiceMode = v('voiceMode', NEURO_MODE.legato);
    this.glide = v('glide', 40) / 1000;
    this.transpose = v('transpose', 0);
    this.velocity = v('velocity', 30) / 100;
    this.gain = dbToGain(v('volume', -8));
    this.ampEnv = { attack: v('attack', 0.002), decay: v('decay', 0.4), sustain: v('sustain', 100) / 100, release: v('release', 0.06) };
    this.modEnv = { attack: v('mAttack', 0.001), decay: v('mDecay', 0.25), sustain: v('mSustain', 0) / 100, release: v('mRelease', 0.1) };
    this.lfos.forEach((l, i) => l.read(p, i + 1));
    this.envRoutes = routes(p, 'envDest', 'envAmount', 'envDest2', 'envAmount2');
  }
}

/** Una destinazione di modulazione con la sua quantità (−1..1). */
interface Route {
  readonly dest: number;
  readonly amount: number;
}

const routes = (p: Readonly<Record<string, number>>, ...ids: [string, string, string, string]): Route[] =>
  [[ids[0], ids[1]], [ids[2], ids[3]]].flatMap(([d, a]) => {
    const dest = p[d] ?? 0, amount = (p[a] ?? 0) / 100;
    return dest > 0 && dest < MOD_DESTINATIONS.length && amount !== 0 ? [{ dest, amount }] : [];
  });

class LfoSettings {
  shape = 0;
  beats = 1;
  retrig = true;
  phase = 0;
  routes: readonly Route[] = [];

  read(p: Readonly<Record<string, number>>, n: number): void {
    this.shape = p[`lfo${n}Shape`] ?? 0;
    this.beats = (LFO_RATES[p[`lfo${n}Rate`] ?? 6] ?? LFO_RATES[6])[1];
    this.retrig = (p[`lfo${n}Retrig`] ?? 0) === 0;
    this.phase = (p[`lfo${n}Phase`] ?? 0) / 100;
    this.routes = routes(p, `lfo${n}Dest`, `lfo${n}Amount`, `lfo${n}Dest2`, `lfo${n}Amount2`);
  }
}

/** Le onde dell'LFO, da −1 a 1; il triangolo parte da 0 e sale, i dente di sega dagli estremi. */
const LFO_WAVES: readonly ((phase: number, lfo: Lfo) => number)[] = [
  p => Math.sin(2 * Math.PI * p),
  p => (p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4),
  p => 1 - 2 * p,
  p => 2 * p - 1,
  p => (p < 0.5 ? 1 : -1),
  (_p, l) => l.next,
  (p, l) => l.prev + (l.next - l.prev) * (0.5 - 0.5 * Math.cos(Math.PI * p)),
];

/** Un LFO: la fase che gira e, per le onde casuali, il valore di adesso e quello prima. */
class Lfo {
  phase = 0;
  value = 0;
  prev = 0;
  next = 0;

  constructor(private readonly noise: Noise) {}

  restart(phase: number): void {
    this.phase = phase;
  }

  advance(step: number, shape: number): number {
    this.phase += step;
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase);
      this.prev = this.next;
      this.next = this.noise.next();
    }
    return (this.value = (LFO_WAVES[shape] ?? LFO_WAVES[0])(this.phase, this));
  }
}

/** Un filtro a variabili di stato (TPT) con tutte le uscite. */
class StateVariable {
  low = 0;
  band = 0;
  high = 0;
  k = 2;
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 1;
  private a2 = 0;
  private a3 = 0;

  /** `g` = tan(π·fc/fs), `k` = 1/Q. */
  set(g: number, k: number): void {
    this.k = k;
    this.a1 = 1 / (1 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  tick(v0: number): void {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
    this.high = v0 - this.k * v1 - v2;
  }

  reset(): void {
    this.ic1 = this.ic2 = 0;
  }
}

/** I tipi del filtro, nell'ordine delle opzioni: se c'è il primo stadio (LP 24 = due in fila)
 *  e quale uscita del secondo. La banda è normalizzata (1 al centro). */
const FILTER_MODES: readonly { readonly cascade: boolean; readonly out: (s: StateVariable) => number }[] = [
  { cascade: true, out: s => s.low },
  { cascade: false, out: s => s.low },
  { cascade: false, out: s => s.band * s.k },
  { cascade: false, out: s => s.high },
  { cascade: false, out: s => s.low + s.high },
];

/** Il filtro di un canale. */
class ChannelFilter {
  readonly first = new StateVariable();
  readonly second = new StateVariable();

  process(x: number, mode: (typeof FILTER_MODES)[number]): number {
    if (mode.cascade) {
      this.first.tick(x);
      x = this.first.low;
    }
    this.second.tick(x);
    return mode.out(this.second);
  }

  reset(): void {
    this.first.reset();
    this.second.reset();
  }
}

/** I tre formanti di un canale: passa-banda in parallelo, ognuno al suo livello. */
class FormantBank {
  readonly bands = [new StateVariable(), new StateVariable(), new StateVariable()];

  process(x: number, gains: Float64Array): number {
    let y = 0;
    for (let i = 0; i < 3; i++) {
      const b = this.bands[i];
      b.tick(x);
      y += b.band * b.k * gains[i];
    }
    return y;
  }

  reset(): void {
    for (const b of this.bands) b.reset();
  }
}

/** Un crossover passa-alto Linkwitz-Riley (due Butterworth in fila): toglie dal corpo quello
 *  che spetta al sub. */
class HighCut {
  private readonly a = new Tpt();
  private readonly b = new Tpt();

  set(freq: number, sampleRate: number): void {
    this.a.set(freq, Math.SQRT1_2, sampleRate);
    this.b.set(freq, Math.SQRT1_2, sampleRate);
  }

  process(x: number): number {
    this.a.tick(x);
    this.b.tick(this.a.high);
    return this.b.high;
  }
}

const fold = (x: number, amount: number): number => {
  if (amount <= 0) return x;
  const y = Math.sin((1 + 6 * amount) * x * HALF_PI);
  return x + (y - x) * Math.min(1, 3 * amount);
};

/** La saturazione davanti al filtro: lineare a 0, poi sempre più tanh (con il livello tenuto). */
const drive = (x: number, amount: number): number => (amount <= 0 ? x : Math.tanh(x * (1 + 8 * amount)) / (1 + 1.2 * amount));

/** La distorsione finale: tanh asimmetrico (armoniche pari e dispari); la continua che nasce
 *  la toglie il passa-alto del taglio. */
const distort = (x: number, amount: number): number => {
  if (amount <= 0) return x;
  const bias = 0.3 * amount;
  return (Math.tanh(x * (1 + 20 * amount) + bias) - Math.tanh(bias)) / (1 + 0.8 * amount);
};

/** Le modulazioni di adesso, sommate per destinazione (vedi MOD_DESTINATIONS). */
class ModSum {
  readonly values = new Float64Array(MOD_DESTINATIONS.length);
  /** Il volume si moltiplica: ogni fonte lo può solo abbassare. */
  volume = 1;

  clear(): void {
    this.values.fill(0);
    this.volume = 1;
  }

  /** `bipolar` −1..1 per gli LFO; `unipolar` 0..1 (per il volume). */
  add(routes: readonly Route[], bipolar: number, unipolar: number): void {
    for (const { dest, amount } of routes) {
      if (dest === MOD_DEST.volume) {
        const u = amount >= 0 ? unipolar : 1 - unipolar;
        this.volume *= 1 - Math.abs(amount) * (1 - u);
      } else this.values[dest] += amount * MOD_DESTINATIONS[dest].range * bipolar;
    }
  }

  get(key: keyof typeof MOD_DEST): number {
    return this.values[MOD_DEST[key]];
  }
}

class NeuroVoice {
  private readonly amp: Adsr;
  private readonly modEnv: Adsr;
  private readonly lfos: Lfo[];
  private readonly mods = new ModSum();
  private readonly filters = [new ChannelFilter(), new ChannelFilter()];
  private readonly formants = [new FormantBank(), new FormantBank()];
  private readonly highCuts = [new HighCut(), new HighCut()];
  private readonly formantGains = new Float64Array(3);
  private readonly phasesA = new Float64Array(MAX_UNISON);
  private readonly phasesB = new Float64Array(MAX_UNISON);
  private readonly dtsA = new Float64Array(MAX_UNISON);
  private readonly dtsB = new Float64Array(MAX_UNISON);
  /** Il guadagno sinistro e destro di ogni copia (pan a potenza costante). */
  private readonly panL = new Float64Array(MAX_UNISON);
  private readonly panR = new Float64Array(MAX_UNISON);
  private fmPhase = 0;
  private fmDt = 0;
  private subPhase = 0;
  private subDt = 0;
  private pitch = 36;
  private target = 36;
  private level = 1;
  private countdown = 0;
  /** I valori modulati di adesso. */
  private fm = 0;
  private foldAmount = 0;
  private driveAmount = 0;
  private distAmount = 0;
  private formantAmount = 0;
  private volume = 1;
  private stereo = false;
  private mode = FILTER_MODES[0];
  private lastCrossover = 0;

  constructor(private readonly s: Settings, private readonly sampleRate: number, noise: Noise) {
    this.amp = new Adsr(sampleRate);
    this.modEnv = new Adsr(sampleRate / CONTROL_RATE);
    this.lfos = [new Lfo(noise), new Lfo(noise)];
    for (const l of this.lfos) l.restart(0);
  }

  get active(): boolean {
    return this.amp.active;
  }

  get releasing(): boolean {
    return this.amp.releasing;
  }

  get currentPitch(): number {
    return this.pitch;
  }

  /** Una nota da capo; con `from` l'intonazione parte da lì e scivola fino a `pitch`. */
  start(pitch: number, velocity: number, from: number | null): void {
    const { s } = this;
    if (!this.amp.active) {
      for (const f of this.filters) f.reset();
      for (const f of this.formants) f.reset();
      // fasi fisse: ogni nota attacca uguale (il colpo resta lo stesso), le copie sfasate
      for (let k = 0; k < MAX_UNISON; k++) {
        this.phasesA[k] = (k * 0.618034) % 1;
        this.phasesB[k] = (k * 0.381966 + 0.5) % 1;
      }
      this.fmPhase = 0;
      this.subPhase = 0;
    }
    s.lfos.forEach((l, i) => { if (l.retrig) this.lfos[i].restart(l.phase); });
    this.target = pitch;
    this.pitch = from ?? pitch;
    const v = velocity / 127;
    this.level = 1 - s.velocity + s.velocity * v * v;
    this.amp.set(s.ampEnv);
    this.modEnv.set(s.modEnv);
    this.amp.trigger();
    this.modEnv.trigger();
    this.countdown = 0;
  }

  /** Legato: scivola verso `pitch` senza far ripartire inviluppi e LFO. */
  slide(pitch: number): void {
    this.target = pitch;
  }

  release(): void {
    this.amp.release();
    this.modEnv.release();
  }

  kill(): void {
    this.amp.kill();
    this.modEnv.kill();
  }

  refresh(): void {
    this.amp.set(this.s.ampEnv);
    this.modEnv.set(this.s.modEnv);
  }

  /** Riempie `left` e `right` (alla frequenza alta) da `from` a `to`. */
  render(left: Float32Array, right: Float32Array, from: number, to: number, bpm: number): void {
    const { s, amp, phasesA, phasesB, dtsA, dtsB, panL, panR, filters, formants, highCuts, formantGains } = this;
    const { waveA, waveB } = s;
    const [fl, fr] = filters, [ml, mr] = formants, [hl, hr] = highCuts;
    for (let i = from; i < to; i++) {
      if (--this.countdown <= 0) this.control(bpm);
      const n = s.unison, mixB = s.mix, mixA = 1 - mixB;
      const pm = this.fm > 0 ? FM_DEPTH * this.fm * Math.sin(2 * Math.PI * this.fmPhase) : 0;
      this.fmPhase += this.fmDt;
      if (this.fmPhase >= 1) this.fmPhase -= 1;
      let l = 0, r = 0;
      for (let k = 0; k < n; k++) {
        let pa = phasesA[k] + pm, pb = phasesB[k] + pm;
        pa -= Math.floor(pa);
        pb -= Math.floor(pb);
        const x = waveA(pa, dtsA[k]) * mixA + waveB(pb, dtsB[k]) * mixB;
        phasesA[k] += dtsA[k];
        if (phasesA[k] >= 1) phasesA[k] -= 1;
        phasesB[k] += dtsB[k];
        if (phasesB[k] >= 1) phasesB[k] -= 1;
        l += x * panL[k];
        r += x * panR[k];
      }
      const env = amp.next() * this.level * this.volume;
      const sub = Math.sin(2 * Math.PI * this.subPhase) * s.sub * SUB_GAIN * env;
      this.subPhase += this.subDt;
      if (this.subPhase >= 1) this.subPhase -= 1;
      const yl = hl.process(this.body(l, fl, ml, formantGains) * env);
      left[i] = yl + sub;
      right[i] = (this.stereo ? hr.process(this.body(r, fr, mr, formantGains) * env) : yl) + sub;
      if (!amp.active) {
        left.fill(0, i + 1, to);
        right.fill(0, i + 1, to);
        break;
      }
    }
  }

  /** Il corpo di un canale: fold, drive, filtro, formante, distorsione. */
  private body(x: number, filter: ChannelFilter, formant: FormantBank, gains: Float64Array): number {
    let y = filter.process(drive(fold(x, this.foldAmount), this.driveAmount), this.mode);
    if (this.formantAmount > 0) y += (formant.process(y, gains) * FORMANT_MAKEUP - y) * this.formantAmount;
    return distort(y, this.distAmount);
  }

  /** Modulazioni, glide, intonazioni, filtri e formanti, a frequenza ridotta. */
  private control(bpm: number): void {
    const { s, sampleRate, mods, dtsA, dtsB } = this;
    this.countdown = CONTROL_RATE;
    if (this.pitch !== this.target) {
      const k = s.glide > 0 ? 1 - Math.exp((-3 * CONTROL_RATE) / (s.glide * sampleRate)) : 1;
      this.pitch += (this.target - this.pitch) * k;
      if (Math.abs(this.target - this.pitch) < 1e-3) this.pitch = this.target;
    }
    mods.clear();
    s.lfos.forEach((l, i) => {
      const hz = bpm / 60 / l.beats;
      const v = this.lfos[i].advance((hz * CONTROL_RATE) / sampleRate, l.shape);
      mods.add(l.routes, v, (v + 1) / 2);
    });
    const e = this.modEnv.next();
    mods.add(s.envRoutes, e, e);

    const pitch = this.pitch + s.transpose + mods.get('pitch');
    const hz = midiToHz(pitch);
    const n = s.unison, detune = Math.max(0, s.detune + mods.get('detune'));
    const dtA = Math.min(0.45, hz / sampleRate), dtB = Math.min(0.45, dtA * s.ratioB);
    this.stereo = n > 1 && s.spread > 0;
    const norm = 1 / Math.sqrt(n);
    for (let k = 0; k < n; k++) {
      const ratio = Math.pow(2, (fan(k, n) * detune) / 1200);
      dtsA[k] = Math.min(0.45, dtA * ratio);
      dtsB[k] = Math.min(0.45, dtB * ratio);
      const p = this.stereo ? fan(k, n) * s.spread : 0;
      this.panL[k] = Math.sqrt(1 - p) * norm;
      this.panR[k] = Math.sqrt(1 + p) * norm;
    }
    this.fmDt = Math.min(0.45, dtA * s.fmRatio);
    this.subDt = Math.min(0.45, (hz * s.subRatio) / sampleRate);

    this.fm = clamp01(s.fm + mods.get('fm') / 100);
    this.foldAmount = clamp01(s.fold + mods.get('fold') / 100);
    this.driveAmount = clamp01(s.drive + mods.get('drive') / 100);
    this.distAmount = clamp01(s.dist + mods.get('dist') / 100);
    this.formantAmount = clamp01(s.formant + mods.get('formant') / 100);
    this.volume = mods.volume;

    // il filtro
    this.mode = FILTER_MODES[s.filterType] ?? FILTER_MODES[0];
    const octaves = mods.get('cutoff') + (s.keyTrack * (pitch - 60)) / 12;
    const fc = Math.max(20, Math.min(20000, s.cutoff * Math.pow(2, octaves)));
    const g = Math.tan((Math.PI * fc) / sampleRate);
    const k = 2 - 1.96 * clamp01(s.resonance + mods.get('resonance') / 100);
    for (const f of this.filters) {
      f.first.set(g, Math.SQRT2);
      f.second.set(g, k);
    }

    // i formanti: la vocale tra le due vicine, frequenze in ottave e livelli in dB
    if (this.formantAmount > 0) {
      const pos = (Math.max(0, Math.min(100, s.vowel + mods.get('vowel'))) / 100) * (VOWELS.length - 1);
      const i0 = Math.min(VOWELS.length - 2, Math.floor(pos)), t = pos - i0;
      for (let b = 0; b < 3; b++) {
        const [f0, d0] = VOWELS[i0][b], [f1, d1] = VOWELS[i0 + 1][b];
        const f = Math.min(sampleRate * 0.45, f0 * Math.pow(f1 / f0, t) * s.formantShift);
        const gb = Math.tan((Math.PI * f) / sampleRate), kb = FORMANT_BANDWIDTH[b] / f;
        for (const bank of this.formants) bank.bands[b].set(gb, kb);
        this.formantGains[b] = dbToGain(d0 + (d1 - d0) * t);
      }
    }

    if (s.crossover !== this.lastCrossover) {
      this.lastCrossover = s.crossover;
      for (const h of this.highCuts) h.set(s.crossover, sampleRate);
    }
  }
}

interface HeldNote {
  readonly id: number;
  readonly pitch: number;
  readonly velocity: number;
}

export class NeuroCore implements InstrumentCore {
  private readonly settings = new Settings();
  private readonly voice: NeuroVoice;
  private readonly down = [new Oversampler(OVERSAMPLE), new Oversampler(OVERSAMPLE)];
  private held: HeldNote[] = [];
  private played = false;
  private bpm = 120;
  private highL = new Float32Array(128 * OVERSAMPLE);
  private highR = new Float32Array(128 * OVERSAMPLE);
  private lowL = new Float32Array(128);
  private lowR = new Float32Array(128);
  private gain = -1;
  private readonly gainK: number;

  constructor(sampleRate: number) {
    this.voice = new NeuroVoice(this.settings, sampleRate * OVERSAMPLE, new Noise(0x5eed));
    this.gainK = 1 - Math.exp(-1 / (0.01 * sampleRate));
  }

  setParams(params: Readonly<Record<string, number>>): void {
    this.settings.read(params);
    this.voice.refresh();
  }

  setTempo(bpm: number): void {
    if (bpm > 0) this.bpm = bpm;
  }

  /** Le note tenute stanno in una pila e suona l'ultima, come nei synth monofonici. */
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

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    if (this.gain < 0) this.gain = this.settings.gain;
    if (!this.voice.active) return;
    const n = to - from, hn = n * OVERSAMPLE;
    if (this.lowL.length < n) {
      this.highL = new Float32Array(hn);
      this.highR = new Float32Array(hn);
      this.lowL = new Float32Array(n);
      this.lowR = new Float32Array(n);
    }
    this.voice.render(this.highL, this.highR, 0, hn, this.bpm);
    this.down[0].down(this.highL, this.lowL, n);
    this.down[1].down(this.highR, this.lowR, n);
    const target = this.settings.gain, k = this.gainK, l = this.lowL, r = this.lowR;
    let g = this.gain;
    for (let i = 0; i < n; i++) {
      g += (target - g) * k;
      left[from + i] += l[i] * g;
      right[from + i] += r[i] * g;
    }
    this.gain = g;
  }

  private play(pitch: number, velocity: number, tied: boolean): void {
    const s = this.settings;
    if (tied && s.voiceMode === NEURO_MODE.legato) this.voice.slide(pitch);
    else {
      const glide = s.glide > 0 && this.played && (tied || s.voiceMode === NEURO_MODE.mono);
      this.voice.start(pitch, velocity, glide ? this.voice.currentPitch : null);
    }
    this.played = true;
  }
}
