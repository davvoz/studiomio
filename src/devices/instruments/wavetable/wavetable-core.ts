/* Il suono di Wavetable: 16 voci (o una, con il glide), ognuna con due oscillatori a tabella,
 * il sub, l'unison, due filtri SVF (uno per canale), l'inviluppo del volume, l'inviluppo di
 * modulazione e due LFO. Un oscillatore legge la sua tabella alla posizione data, sfumando fra
 * le due forme vicine e fra due campioni vicini; la versione della tabella (vedi tables.ts) è
 * quella con le armoniche che stanno sotto Nyquist per la nota più acuta dell'unison. Le
 * modulazioni si calcolano ogni CONTROL_RATE campioni; le posizioni, il livello di B e il
 * volume ci arrivano in rampa, campione per campione, così muoverle in fretta non graffia.
 * Gira nell'AudioWorklet; qui niente Web Audio, così si prova anche in Node. */
import { dbToGain, midiToHz, type InstrumentCore } from '../../dsp/core';
import { Adsr, type AdsrTimes } from '../../dsp/envelope';
import { MonoPlayer, type MonoVoice } from '../../dsp/mono-player';
import { Svf } from '../../dsp/svf';
import { VoicePool, type PolyVoice } from '../../dsp/voice-pool';
import { TEMPO_RATES } from '../../rates';
import { MAX_UNISON } from '../analog/analog';
import { FRAMES, LEVELS, levelFor, STRIDE, TABLE_SIZE, wavetable, type Wavetable } from './tables';
import { LFO_SHAPE, LFO_SYNC, MOD_DEST, MOD_DESTINATIONS, VOICE_MODE } from './wavetable';

export const WAVETABLE_VOICES = 16;
/** Ogni quanti campioni si ricalcolano modulazioni, intonazione e filtro. */
const CONTROL_RATE = 16;
const LFOS = 2;
const LAST_FRAME = FRAMES - 1;
/** Dalla forma alla stessa forma della tabella dopo (stessa versione). */
const FRAME_STRIDE = LEVELS * STRIDE;

const lfoWave = (shape: number, phase: number): number => {
  switch (shape) {
    case LFO_SHAPE.triangle: return phase < 0.25 ? 4 * phase : phase < 0.75 ? 2 - 4 * phase : 4 * phase - 4;
    case LFO_SHAPE.sawDown: return 1 - 2 * phase;
    case LFO_SHAPE.sawUp: return 2 * phase - 1;
    case LFO_SHAPE.square: return phase < 0.5 ? 1 : -1;
    default: return Math.sin(2 * Math.PI * phase);
  }
};

/** Un numero a caso in −1…1 fisso per ogni intero (il S&H: lo stesso giro dà lo stesso valore). */
const hash = (n: number): number => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 0x7fffffff - 1;
};

/** Una modulazione: da dove (non serve), verso quale destinazione, di quanto (già nell'unità
 *  della destinazione, vedi MOD_DESTINATIONS). */
interface Route {
  dest: number;
  amount: number;
}

const route = (dest: number, amount: number): Route => {
  const d = MOD_DESTINATIONS[dest] ?? MOD_DESTINATIONS[0];
  return { dest: d.key ? dest : 0, amount: d.key ? (amount / 100) * d.range : 0 };
};

class Lfo {
  shape = 0;
  tempo = true;
  beats = 4;
  rate = 2;
  free = false;
  route: Route = { dest: 0, amount: 0 };
}

/** I parametri già convertiti in quello che serve alle voci. */
class Settings {
  readonly tables: [Wavetable, Wavetable] = [wavetable(0), wavetable(0)];
  /** Posizioni 0..1, rapporti di frequenza, livelli 0..1 dei due oscillatori. */
  readonly pos = [0, 0];
  readonly ratio = [1, 1];
  readonly level = [1, 0];
  sub = 0;
  subRatio = 0.5;
  unison = 1;
  detune = 20;
  spread = 0.7;
  posSpread = 0;
  filterType = 0;
  cutoff = 20000;
  resonance = 0;
  keyTrack = 0;
  voiceMode = 0;
  glide = 0;
  velocity = 0.5;
  gain = 1;
  bpm = 120;
  ampEnv: AdsrTimes = { attack: 0.003, decay: 0.5, sustain: 0.8, release: 0.25 };
  modEnv: AdsrTimes = { attack: 0.003, decay: 0.6, sustain: 0, release: 0.3 };
  envRoutes: [Route, Route] = [route(0, 0), route(0, 0)];
  readonly lfos = [new Lfo(), new Lfo()];
  /** Il giro comune degli LFO liberi: fase e giri compiuti (per il S&H). */
  readonly freePhase = [0, 0];
  readonly freeCycle = [0, 0];

  read(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    (['A', 'B'] as const).forEach((o, i) => {
      this.tables[i] = wavetable(v(`table${o}`, 0));
      this.pos[i] = v(`pos${o}`, 0) / 100;
      this.ratio[i] = Math.pow(2, (v(`semi${o}`, 0) + v(`fine${o}`, 0) / 100) / 12);
      this.level[i] = v(`level${o}`, i ? 0 : 100) / 100;
    });
    this.sub = v('sub', 0) / 100;
    this.subRatio = v('subOctave', 0) ? 0.25 : 0.5;
    this.unison = Math.max(1, Math.min(MAX_UNISON, Math.round(v('unison', 1))));
    this.detune = v('detune', 20);
    this.spread = v('spread', 70) / 100;
    this.posSpread = v('posSpread', 0) / 100;
    this.filterType = v('filterType', 0);
    this.cutoff = v('cutoff', 20000);
    this.resonance = v('resonance', 0) / 100;
    this.keyTrack = v('keyTrack', 0) / 100;
    this.voiceMode = v('voiceMode', 0);
    this.glide = v('glide', 0) / 1000;
    this.velocity = v('velocity', 50) / 100;
    this.gain = dbToGain(v('volume', -10));
    this.ampEnv = { attack: v('attack', 0.003), decay: v('decay', 0.5), sustain: v('sustain', 80) / 100, release: v('release', 0.25) };
    this.modEnv = { attack: v('mAttack', 0.003), decay: v('mDecay', 0.6), sustain: v('mSustain', 0) / 100, release: v('mRelease', 0.3) };
    this.envRoutes = [route(v('envDest', 0), v('envAmount', 0)), route(v('envDest2', 0), v('envAmount2', 0))];
    this.lfos.forEach((l, i) => {
      const n = i + 1;
      l.shape = v(`lfo${n}Shape`, 0);
      l.tempo = v(`lfo${n}Sync`, LFO_SYNC.tempo) === LFO_SYNC.tempo;
      l.beats = (TEMPO_RATES[v(`lfo${n}Division`, 3)] ?? TEMPO_RATES[3])[1];
      l.rate = v(`lfo${n}Rate`, 2);
      l.free = v(`lfo${n}Retrig`, 0) === 1;
      l.route = route(v(`lfo${n}Dest`, 0), v(`lfo${n}Amount`, 0));
    });
  }

  /** A una voce, se le note sovrapposte scivolano (per MonoPlayer). */
  get legato(): boolean {
    return this.voiceMode === VOICE_MODE.legato;
  }

  lfoHz(i: number): number {
    const l = this.lfos[i];
    return l.tempo ? this.bpm / 60 / l.beats : l.rate;
  }

  /** Il giro comune degli LFO liberi va avanti di `frames` campioni. */
  advance(frames: number, sampleRate: number): void {
    for (let i = 0; i < LFOS; i++) {
      const p = this.freePhase[i] + (this.lfoHz(i) * frames) / sampleRate;
      this.freeCycle[i] += Math.floor(p);
      this.freePhase[i] = p % 1;
    }
  }
}

/** La posizione della copia `k` di `n` nel ventaglio: da −1 a +1 (0 se è sola). */
const fan = (k: number, n: number) => (n > 1 ? (2 * k) / (n - 1) - 1 : 0);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Le grandezze delle due voci per oscillatore, copia per copia. */
class Osc {
  readonly phases = new Float64Array(MAX_UNISON);
  readonly dts = new Float64Array(MAX_UNISON);
  /** La posizione nella tabella in forme (0…FRAMES−1) e quanto si muove a ogni campione. */
  readonly frames = new Float64Array(MAX_UNISON);
  readonly steps = new Float64Array(MAX_UNISON);
  /** La versione della tabella che si legge (vedi tables.ts). */
  level = 0;
}

class WavetableVoice implements PolyVoice, MonoVoice {
  private readonly amp: Adsr;
  /** L'inviluppo di modulazione va alla frequenza di controllo. */
  private readonly menv: Adsr;
  private readonly filterL: Svf;
  private readonly filterR: Svf;
  private readonly osc = [new Osc(), new Osc()];
  private readonly panL = new Float64Array(MAX_UNISON);
  private readonly panR = new Float64Array(MAX_UNISON);
  private readonly mods = new Float64Array(MOD_DESTINATIONS.length);
  /** Il pezzo che si sta calcolando, prima di filtri e inviluppo. */
  private readonly bufL = new Float64Array(CONTROL_RATE);
  private readonly bufR = new Float64Array(CONTROL_RATE);
  private readonly lfoPhase = [0, 0];
  private readonly lfoCycle = [0, 0];
  private subPhase = 0;
  private subDt = 0;
  private pitch = 60;
  private target = 60;
  private level = 1;
  /** Livello di B e guadagno delle modulazioni del volume, in rampa. */
  private levelB = 0;
  private levelBStep = 0;
  private modGain = 1;
  private modGainStep = 0;
  /** Appena partita da ferma: le rampe saltano subito al valore. */
  private fresh = true;
  private countdown = 0;

  constructor(private readonly s: Settings, private readonly sampleRate: number, private readonly seed: () => number) {
    this.amp = new Adsr(sampleRate);
    this.menv = new Adsr(sampleRate / CONTROL_RATE);
    this.filterL = new Svf(sampleRate);
    this.filterR = new Svf(sampleRate);
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

  start(pitch: number, velocity: number, from: number | null = null): void {
    const { s } = this;
    if (!this.amp.active) {
      this.filterL.reset();
      this.filterR.reset();
      this.subPhase = 0;
      // le copie partono da fasi diverse (fisse: lo stesso suono ogni volta)
      this.osc.forEach((o, i) => {
        for (let k = 0; k < MAX_UNISON; k++) o.phases[k] = k ? (k * (i ? 0.381966 : 0.618034)) % 1 : 0;
      });
      this.fresh = true;
    }
    for (let i = 0; i < LFOS; i++) {
      const l = s.lfos[i];
      if (l.free) {
        this.lfoPhase[i] = s.freePhase[i];
        this.lfoCycle[i] = s.freeCycle[i];
      } else {
        this.lfoPhase[i] = 0;
        this.lfoCycle[i] = this.seed();
      }
    }
    this.target = pitch;
    this.pitch = from ?? pitch;
    const v = velocity / 127;
    this.level = 1 - s.velocity + s.velocity * v * v;
    this.amp.set(s.ampEnv);
    this.menv.set(s.modEnv);
    this.amp.trigger();
    this.menv.trigger();
    this.countdown = 0;
  }

  slide(pitch: number): void {
    this.target = pitch;
  }

  release(): void {
    this.amp.release();
    this.menv.release();
  }

  kill(): void {
    this.amp.kill();
    this.menv.kill();
  }

  /** I tempi degli inviluppi cambiano anche per le note che suonano già. */
  refresh(): void {
    this.amp.set(this.s.ampEnv);
    this.menv.set(this.s.modEnv);
  }

  /** A pezzi fra un calcolo delle modulazioni e l'altro: prima gli oscillatori, copia per
   *  copia, nei buffer della voce; poi sub, filtri e inviluppo campione per campione. */
  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const { s, amp, filterL, filterR, bufL, bufR } = this;
    const [a, b] = this.osc, [tableA, tableB] = s.tables;
    for (let i = from; i < to;) {
      if (this.countdown <= 0) this.control();
      const len = Math.min(this.countdown, to - i);
      this.countdown -= len;
      bufL.fill(0, 0, len);
      bufR.fill(0, 0, len);
      this.oscillate(tableA, a, len, s.level[0], 0);
      this.oscillate(tableB, b, len, this.levelB, this.levelBStep);
      this.levelB += this.levelBStep * len;
      if (s.sub > 0) {
        let ph = this.subPhase;
        for (let j = 0; j < len; j++) {
          const v = Math.sin(2 * Math.PI * ph) * s.sub;
          bufL[j] += v;
          bufR[j] += v;
          ph += this.subDt;
          if (ph >= 1) ph -= 1;
        }
        this.subPhase = ph;
      }
      for (let j = 0; j < len; j++, i++) {
        this.modGain += this.modGainStep;
        const g = amp.next() * this.level * this.modGain;
        left[i] += filterL.process(bufL[j]) * g;
        right[i] += filterR.process(bufR[j]) * g;
        if (!amp.active) return;
      }
    }
  }

  /** Somma nei buffer `len` campioni dell'oscillatore, tutte le copie, con il livello che parte
   *  da `level` e si muove di `step` a campione. Ogni campione sfuma fra due forme vicine e fra
   *  due campioni vicini; posizioni e fasi vanno avanti anche quando non si sente. */
  private oscillate(table: Wavetable, o: Osc, len: number, level: number, step: number): void {
    const { bufL, bufR } = this, n = this.s.unison;
    if (level <= 0 && step <= 0) {
      for (let k = 0; k < n; k++) o.frames[k] += o.steps[k] * len;
      return;
    }
    const levelOffset = o.level * STRIDE;
    for (let k = 0; k < n; k++) {
      const dt = o.dts[k], st = o.steps[k], pl = this.panL[k], pr = this.panR[k];
      let ph = o.phases[k], x = o.frames[k], g = level;
      for (let j = 0; j < len; j++) {
        x += st;
        g += step;
        let f = x | 0;
        if (f >= LAST_FRAME) f = LAST_FRAME - 1;
        else if (f < 0) f = 0;
        const idx = ph * TABLE_SIZE, i = idx | 0, t = idx - i;
        const p = f * FRAME_STRIDE + levelOffset + i, q = p + FRAME_STRIDE;
        const a0 = table[p], b0 = table[q];
        const av = a0 + (table[p + 1] - a0) * t, bv = b0 + (table[q + 1] - b0) * t;
        const v = (av + (bv - av) * (x - f)) * g;
        bufL[j] += v * pl;
        bufR[j] += v * pr;
        ph += dt;
        if (ph >= 1) ph -= 1;
      }
      o.phases[k] = ph;
      o.frames[k] = x;
    }
  }

  /** Modulazioni a frequenza ridotta: inviluppo, LFO, glide, intonazione, posizioni, filtro. */
  private control(): void {
    const { s, sampleRate, mods } = this;
    this.countdown = CONTROL_RATE;
    if (this.pitch !== this.target) {
      // glide esponenziale in semitoni: arriva al 95 % in circa `glide` secondi
      const k = s.glide > 0 ? 1 - Math.exp((-3 * CONTROL_RATE) / (s.glide * sampleRate)) : 1;
      this.pitch += (this.target - this.pitch) * k;
      if (Math.abs(this.target - this.pitch) < 1e-3) this.pitch = this.target;
    }
    mods.fill(0);
    const env = this.menv.next();
    for (const r of s.envRoutes) mods[r.dest] += env * r.amount;
    for (let i = 0; i < LFOS; i++) {
      const l = s.lfos[i];
      const value = l.shape === LFO_SHAPE.sampleHold ? hash(this.lfoCycle[i]) : lfoWave(l.shape, this.lfoPhase[i]);
      mods[l.route.dest] += value * l.route.amount;
      const p = this.lfoPhase[i] + (s.lfoHz(i) * CONTROL_RATE) / sampleRate;
      if (p >= 1) this.lfoCycle[i] += Math.floor(p);
      this.lfoPhase[i] = p % 1;
    }

    const pitch = this.pitch + mods[MOD_DEST.pitch];
    const hz = midiToHz(pitch), n = s.unison;
    this.subDt = Math.min(0.49, (hz * s.subRatio) / sampleRate);
    const moved = [mods[MOD_DEST.posA] + mods[MOD_DEST.pos], mods[MOD_DEST.posB] + mods[MOD_DEST.pos]];
    const norm = 1 / Math.sqrt(n), detuneTop = Math.pow(2, (n > 1 ? s.detune : 0) / 1200);
    for (let o = 0; o < 2; o++) {
      const osc = this.osc[o], dt = Math.min(0.49, (hz * s.ratio[o]) / sampleRate);
      osc.level = levelFor(Math.min(0.49, dt * detuneTop));
      for (let k = 0; k < n; k++) {
        const f = fan(k, n);
        osc.dts[k] = Math.min(0.49, dt * Math.pow(2, (f * s.detune) / 1200));
        // con "Posizioni" le copie leggono la tabella a ventaglio attorno alla posizione
        const target = clamp01(s.pos[o] + moved[o] + f * s.posSpread * 0.5) * LAST_FRAME;
        if (this.fresh) {
          osc.frames[k] = target;
          osc.steps[k] = 0;
        } else osc.steps[k] = (target - osc.frames[k]) / CONTROL_RATE;
      }
    }
    for (let k = 0; k < n; k++) {
      // pan a potenza costante lungo il ventaglio; il livello scende come la radice delle copie
      const p = fan(k, n) * s.spread;
      this.panL[k] = Math.sqrt(1 - p) * norm;
      this.panR[k] = Math.sqrt(1 + p) * norm;
    }
    const levelB = clamp01(s.level[1] + mods[MOD_DEST.levelB]);
    const gain = Math.max(0, 1 + mods[MOD_DEST.volume]);
    if (this.fresh) {
      this.levelB = levelB;
      this.modGain = gain;
      this.levelBStep = this.modGainStep = 0;
    } else {
      this.levelBStep = (levelB - this.levelB) / CONTROL_RATE;
      this.modGainStep = (gain - this.modGain) / CONTROL_RATE;
    }
    this.fresh = false;
    const octaves = s.keyTrack * (this.pitch - 60) / 12 + mods[MOD_DEST.cutoff];
    const cutoff = s.cutoff * Math.pow(2, octaves), res = clamp01(s.resonance + mods[MOD_DEST.resonance]);
    this.filterL.set(cutoff, res, s.filterType);
    this.filterR.set(cutoff, res, s.filterType);
  }
}

export class WavetableCore implements InstrumentCore {
  private readonly settings = new Settings();
  private readonly pool: VoicePool<WavetableVoice>;
  private readonly mono: MonoPlayer;
  private single: boolean | null = null;
  private scratchL = new Float32Array(128);
  private scratchR = new Float32Array(128);
  private gain = -1;
  private readonly gainK: number;
  /** Il seme del S&H delle note (ogni nota il suo giro di valori). */
  private notes = 0;

  constructor(private readonly sampleRate: number, voices = WAVETABLE_VOICES) {
    const seed = () => (this.notes += 7919);
    this.pool = new VoicePool(Array.from({ length: voices }, () => new WavetableVoice(this.settings, sampleRate, seed)));
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
    const n = to - from;
    this.settings.advance(n, this.sampleRate);
    if (this.gain < 0) this.gain = this.settings.gain;
    if (this.pool.activeCount === 0) return;
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
