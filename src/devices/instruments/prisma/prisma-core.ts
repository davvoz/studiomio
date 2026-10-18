/* Il suono di Prisma: 16 voci (o una, con il glide). Ogni voce ha due oscillatori a tabella
 * (fino a 16 copie di unison ciascuno, con i warp), il sub, il rumore, due filtri stereo con i
 * percorsi scelti per ogni sorgente, quattro inviluppi e quattro LFO.
 *
 * Le modulazioni si calcolano ogni CONTROL_RATE campioni: le fonti (inviluppi, LFO, velocity…)
 * passano dalla matrice, che sposta le destinazioni in frazioni della corsa delle loro manopole
 * (come in Serum: +50 % su un cutoff lo porta a metà strada verso il massimo, in ottave); il
 * risultato va agli oscillatori, ai filtri e agli inviluppi. Livelli, fase e volume ci arrivano in
 * rampa, così muoverli in fretta non graffia.
 *
 * L'oscillatore legge la tabella alla posizione data sfumando fra due forme vicine e fra due
 * campioni; la versione della tabella è quella con le armoniche sotto Nyquist per la copia più
 * acuta, tenendo conto di quanto il warp accelera la lettura (un sync a 4× legge quattro volte
 * più in fretta: serve la versione di due ottave sopra). Gira nell'AudioWorklet; qui niente Web
 * Audio, così si prova anche in Node. */
import { paramSpec } from '../../device-type';
import { dbToGain, midiToHz, type InstrumentCore, type SampleData, type SamplePlayer } from '../../dsp/core';
import { MonoPlayer, type MonoVoice } from '../../dsp/mono-player';
import { Noise } from '../../dsp/noise';
import { polyBlep } from '../../dsp/oscillators';
import { VoicePool, type PolyVoice } from '../../dsp/voice-pool';
import { paramToUnit, type NumberParam } from '../../params';
import { TEMPO_RATES } from '../../rates';
import { cyclesOf, FRAMES, LEVELS, levelFor, STRIDE, TABLE_SIZE, tableFromCycles, wavetable } from '../wavetable/tables';
import { CurvedEnv } from './curved-env';
import {
  CROSS_WARPS, DESTINATIONS, ENVS, FILTER_MODE, LFO_SYNC, LFO_TRIG, LFOS, MACROS, MAX_UNISON, MOD_SLOTS, NOISE, OSCS, PRISMA,
  ROUTE, slotParam, SOURCES, SRC, tableSlot, USER_TABLE, VOICE_MODE, WARP,
} from './prisma';
import { PrismaFilter } from './prisma-filter';
import {
  fillShape, hash01, isRandomShape, LFO_POINTS, LFO_SHAPE, LFO_TABLE_SIZE, pointCountParam, pointParam, pointsOf, randomValue,
} from './shapes';

export const PRISMA_VOICES = 16;
/** Ogni quanti campioni si ricalcolano modulazioni, intonazione e filtri. */
const CONTROL_RATE = 16;
const FRAME_STRIDE = LEVELS * STRIDE;
const DEST_COUNT = DESTINATIONS.length;
const SOURCE_COUNT = SOURCES.length;

/** L'indice di ogni destinazione, per parametro (es. D.aPos). */
const D = Object.fromEntries(DESTINATIONS.map((d, i) => [d.param, i])) as Readonly<Record<string, number>>;
const DEST_SPECS = DESTINATIONS.map(d => paramSpec(PRISMA, d.param) as NumberParam);
const DEST_LOG = DEST_SPECS.map(s => s.scale === 'log');

/** Dalla posizione della manopola (0…1, anche fuori: si ferma ai bordi) al valore, senza
 *  arrotondare al passo: i semitoni modulati scivolano. */
function fromUnit(d: number, u: number): number {
  const s = DEST_SPECS[d], x = u < 0 ? 0 : u > 1 ? 1 : u;
  return DEST_LOG[d] ? s.min * Math.pow(s.max / s.min, x) : s.min + x * (s.max - s.min);
}

/** Le destinazioni di un oscillatore, per indice. */
const oscDest = (o: string) => ({
  pos: D[`${o}Pos`], warp: D[`${o}WarpAmt`], semi: D[`${o}Semi`], fine: D[`${o}Fine`], detune: D[`${o}Detune`], blend: D[`${o}Blend`],
  width: D[`${o}Width`], spread: D[`${o}Spread`], phase: D[`${o}Phase`], level: D[`${o}Level`], pan: D[`${o}Pan`],
});
const OSC_DEST = OSCS.map(oscDest);
const FILTER_DEST = [1, 2].map(f => ({ cutoff: D[`f${f}Cutoff`], res: D[`f${f}Res`], drive: D[`f${f}Drive`], variation: D[`f${f}Var`], mix: D[`f${f}Mix`] }));
const ENV_DEST = [1, 2, 3, 4].map(n => ({ attack: D[`e${n}A`], decay: D[`e${n}D`], sustain: D[`e${n}S`], release: D[`e${n}R`] }));
const LFO_RATE_DEST = [1, 2, 3, 4].map(n => D[`l${n}Rate`]);

/** Una tabella d'onda con il numero delle sue forme. */
interface Table {
  readonly data: Float32Array;
  readonly frames: number;
}

const builtIn = new Map<number, Table>();
const builtInTable = (i: number): Table => {
  let t = builtIn.get(i);
  if (!t) builtIn.set(i, (t = { data: wavetable(i), frames: FRAMES }));
  return t;
};

/** Il campione della tabella (forma `base` e quella dopo, a `next`; `fx` fra le due) a `p`. */
function lookup(data: Float32Array, base: number, next: number, fx: number, p: number): number {
  const idx = p * TABLE_SIZE, i = idx | 0, t = idx - i;
  const a = base + i, b = a + next;
  const a0 = data[a], b0 = data[b];
  const av = a0 + (data[a + 1] - a0) * t, bv = b0 + (data[b + 1] - b0) * t;
  return av + (bv - av) * fx;
}

/** La posizione della copia `k` di `n` nel ventaglio: da −1 a +1 (0 se è sola). */
const fan = (k: number, n: number) => (n > 1 ? (2 * k) / (n - 1) - 1 : 0);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp11 = (x: number) => (x < -1 ? -1 : x > 1 ? 1 : x);

class OscSettings {
  on = false;
  table = builtInTable(0);
  tableIndex = 0;
  warp = 0;
  octave = 0;
  unison = 1;
  rand = 1;
  route = 0;
}

class LfoSettings {
  shape = 0;
  tempo = true;
  beats = 1;
  trig = 0;
  delay = 0;
  rise = 0;
  smooth = 0;
  phase = 0;
  readonly table = new Float32Array(LFO_TABLE_SIZE);
  /** Come era fatta la forma l'ultima volta che si è riempita la tabella. */
  signature = '';
}

/** Un posto della matrice in uso. */
interface Slot {
  readonly src: number;
  readonly dst: number;
  /** −1…1 della corsa della manopola. */
  readonly amount: number;
  readonly bipolar: boolean;
  /** La curva come esponente sulla fonte (1: diritta). */
  readonly exponent: number;
  readonly aux: number;
}

/** I parametri già convertiti in quello che serve alle voci. */
class Settings {
  /** Il valore e la posizione della manopola di ogni destinazione. */
  readonly base = new Float64Array(DEST_COUNT);
  readonly unit = new Float64Array(DEST_COUNT);
  readonly osc = [new OscSettings(), new OscSettings()];
  readonly userTables: (Table | null)[] = [null, null];
  subOn = false;
  subShape = 0;
  subOctave = -1;
  subRoute = 0;
  noiseOn = false;
  noiseType = 0;
  noiseRoute = 0;
  readonly filterOn = [true, false];
  readonly filterType = [0, 0];
  readonly filterKey = [0, 0];
  filterMode = 0;
  /** Le curve degli inviluppi (attacco, decadimento, rilascio), per inviluppo. */
  readonly curves = Array.from({ length: ENVS }, () => [0, 0, 0]);
  readonly holds = new Float64Array(ENVS);
  readonly lfos = Array.from({ length: LFOS }, () => new LfoSettings());
  readonly macros = new Float64Array(MACROS);
  slots: Slot[] = [];
  /** Le destinazioni toccate da almeno un posto, e le fonti che servono (le altre non si
   *  calcolano: un LFO che non va da nessuna parte non costa nulla). */
  touched: number[] = [];
  readonly used = new Uint8Array(SOURCE_COUNT);
  voiceMode = 0;
  glide = 0;
  bpm = 120;
  /** Il giro comune degli LFO liberi: fase e giri compiuti (per il S&H). */
  readonly freePhase = new Float64Array(LFOS);
  readonly freeCycle = new Float64Array(LFOS);

  read(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    DEST_SPECS.forEach((spec, i) => {
      const x = v(spec.id, spec.default);
      this.base[i] = x;
      this.unit[i] = paramToUnit(spec, x);
    });
    OSCS.forEach((o, i) => {
      const s = this.osc[i];
      s.on = v(`${o}On`, i ? 0 : 1) === 1;
      s.tableIndex = v(`${o}Table`, 0);
      s.warp = v(`${o}Warp`, 0);
      s.octave = v(`${o}Oct`, 0);
      s.unison = Math.max(1, Math.min(MAX_UNISON, Math.round(v(`${o}Unison`, 1))));
      s.rand = v(`${o}Rand`, 100) / 100;
      s.route = v(`${o}Route`, 0);
    });
    this.resolveTables();
    this.subOn = v('subOn', 0) === 1;
    this.subShape = v('subShape', 0);
    this.subOctave = v('subOct', -1);
    this.subRoute = v('subRoute', 0);
    this.noiseOn = v('nOn', 0) === 1;
    this.noiseType = v('nType', 0);
    this.noiseRoute = v('nRoute', 0);
    for (let f = 0; f < 2; f++) {
      this.filterOn[f] = v(`f${f + 1}On`, f ? 0 : 1) === 1;
      this.filterType[f] = v(`f${f + 1}Type`, 0);
      this.filterKey[f] = v(`f${f + 1}Key`, 0) / 100;
    }
    this.filterMode = v('fMode', 0);
    for (let n = 0; n < ENVS; n++) {
      const e = `e${n + 1}`;
      this.curves[n] = [v(`${e}Ac`, 0), v(`${e}Dc`, 60), v(`${e}Rc`, 60)];
      this.holds[n] = v(`${e}H`, 0.001);
    }
    this.lfos.forEach((l, i) => this.readLfo(p, l, i + 1));
    for (let m = 0; m < MACROS; m++) this.macros[m] = v(`macro${m + 1}`, 0) / 100;
    const slots: Slot[] = [];
    for (let n = 1; n <= MOD_SLOTS; n++) {
      const src = Math.round(v(slotParam(n, 'Src'), 0)), dst = Math.round(v(slotParam(n, 'Dst'), 0)), amount = v(slotParam(n, 'Amt'), 0) / 100;
      if (src <= 0 || src >= SOURCE_COUNT || dst <= 0 || dst > DEST_COUNT || amount === 0) continue;
      const aux = Math.round(v(slotParam(n, 'Aux'), 0));
      slots.push({
        src, dst: dst - 1, amount, bipolar: v(slotParam(n, 'Pol'), 0) === 1,
        // curva positiva: la fonte sale subito (esponente sotto 1), negativa: tardi
        exponent: Math.pow(2, -v(slotParam(n, 'Curve'), 0) / 33),
        aux: aux > 0 && aux < SOURCE_COUNT ? aux : 0,
      });
    }
    this.slots = slots;
    this.touched = [...new Set(slots.map(s => s.dst))];
    this.used.fill(0);
    for (const s of slots) this.used[s.src] = this.used[s.aux] = 1;
    this.voiceMode = v('voiceMode', 0);
    this.glide = v('glide', 0) / 1000;
  }

  private readLfo(p: Readonly<Record<string, number>>, l: LfoSettings, n: number): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    l.shape = v(`l${n}Shape`, 0);
    l.tempo = v(`l${n}Sync`, LFO_SYNC.tempo) === LFO_SYNC.tempo;
    l.beats = (TEMPO_RATES[v(`l${n}Div`, 6)] ?? TEMPO_RATES[6])[1];
    l.trig = v(`l${n}Trig`, 0);
    l.phase = v(`l${n}Phase`, 0) / 360;
    l.delay = v(`l${n}Delay`, 0.001);
    l.rise = v(`l${n}Rise`, 0.001);
    l.smooth = v(`l${n}Smooth`, 0) / 100;
    // la tabella si riempie solo se la forma è cambiata (le modulazioni delle clip rimandano
    // i parametri a ogni blocco)
    let signature = String(l.shape);
    if (l.shape === LFO_SHAPE.drawn) {
      const count = v(pointCountParam(n), 3);
      signature += `|${count}`;
      for (let k = 1; k <= Math.min(LFO_POINTS, count); k++) {
        signature += `|${v(pointParam(n, 'X', k), 0)},${v(pointParam(n, 'Y', k), 0)},${v(pointParam(n, 'C', k), 0)}`;
      }
    }
    if (signature !== l.signature && !isRandomShape(l.shape)) fillShape(l.table, l.shape, pointsOf(p, n));
    l.signature = signature;
  }

  /** La tabella che legge ogni oscillatore: quella importata se c'è (altrimenti la prima). */
  resolveTables(): void {
    this.osc.forEach((s, i) => {
      s.table = s.tableIndex === USER_TABLE ? this.userTables[i] ?? builtInTable(0) : builtInTable(s.tableIndex);
    });
  }

  /** A una voce, se le note sovrapposte scivolano (per MonoPlayer). */
  get legato(): boolean {
    return this.voiceMode === VOICE_MODE.legato;
  }

  /** La velocità dell'LFO `i` con la sua manopola (`rate`: il valore, magari modulato). */
  lfoHz(i: number, rate: number): number {
    const l = this.lfos[i];
    return l.tempo ? (this.bpm / 60 / l.beats) * (rate / this.base[LFO_RATE_DEST[i]]) : rate;
  }

  /** Il giro comune degli LFO liberi va avanti di `frames` campioni. */
  advance(frames: number, sampleRate: number): void {
    for (let i = 0; i < LFOS; i++) {
      const p = this.freePhase[i] + (this.lfoHz(i, this.base[LFO_RATE_DEST[i]]) * frames) / sampleRate;
      this.freeCycle[i] += Math.floor(p);
      this.freePhase[i] = p % 1;
    }
  }
}

/** Le grandezze di un oscillatore in una voce, copia per copia. */
class OscState {
  readonly phases = new Float64Array(MAX_UNISON);
  readonly dts = new Float64Array(MAX_UNISON);
  /** La posizione nella tabella in forme e quanto si muove a ogni campione. */
  readonly frames = new Float64Array(MAX_UNISON);
  readonly steps = new Float64Array(MAX_UNISON);
  readonly panL = new Float64Array(MAX_UNISON);
  readonly panR = new Float64Array(MAX_UNISON);
  /** Le copie che suonano e quella di mezzo (fa da modulante per l'altro oscillatore). */
  copies = 1;
  center = 0;
  /** La versione della tabella che si legge. */
  level = 0;
  /** Livello e fase in rampa. */
  gain = 0;
  gainStep = 0;
  phaseOff = 0;
  phaseStep = 0;
  /** Il warp in uso (senza modulante, quelli incrociati non fanno nulla), quanto, e la sua
   *  costante (il rapporto del sync, la piega del bend…). */
  warp = 0;
  warpAmt = 0;
  warpK = 1;
}

/** Pan a potenza costante (−1…1): al centro i due canali a 1. */
const panLeft = (p: number) => Math.sqrt(1 - p);
const panRight = (p: number) => Math.sqrt(1 + p);

/** Le sorgenti si sommano in tre posti: il primo filtro, il secondo, diretto all'uscita. */
type RouteGains = readonly [number, number, number];
const TO_F1: RouteGains = [1, 0, 0], TO_F2: RouteGains = [0, 1, 0], TO_BOTH: RouteGains = [1, 1, 0], DIRECT: RouteGains = [0, 0, 1];
const routeGains = (route: number, parallel: boolean): RouteGains => {
  switch (route) {
    case ROUTE.f2: return TO_F2;
    case ROUTE.both: return parallel ? TO_BOTH : TO_F1;
    case ROUTE.direct: return DIRECT;
    default: return TO_F1;
  }
};

/** Le copie di mezzo di `n` (una se sono dispari, due se pari) suonano a pieno livello. */
const isMiddle = (k: number, n: number) => (n % 2 ? k === (n - 1) >> 1 : k === n / 2 - 1 || k === n / 2);

/** Un pezzo di buffer stereo della voce. */
const buffer = () => new Float64Array(CONTROL_RATE);

/** Gli inviluppi ricevono la forma da un oggetto riusato (niente allocazioni a ogni controllo). */
interface MutableShape {
  attack: number; hold: number; decay: number; sustain: number; release: number;
  attackCurve: number; decayCurve: number; releaseCurve: number;
}

class PrismaVoice implements PolyVoice, MonoVoice {
  /** Env 1 è il volume, a frequenza piena; gli altri vanno alla frequenza di controllo. */
  private readonly envs: CurvedEnv[];
  private readonly shapes: MutableShape[];
  private readonly filters: [PrismaFilter, PrismaFilter];
  private readonly osc = [new OscState(), new OscState()];
  private readonly noiseL: Noise;
  private readonly noiseR: Noise;
  /** Le fonti e quanto sono "aperte" (gli LFO con ritardo e salita), per indice di SOURCES. */
  private readonly src = new Float64Array(SOURCE_COUNT);
  private readonly fade = new Float64Array(SOURCE_COUNT).fill(1);
  private readonly offsets = new Float64Array(DEST_COUNT);
  /** I valori delle destinazioni, modulati. */
  readonly val = new Float64Array(DEST_COUNT);
  private readonly lfoPhase = new Float64Array(LFOS);
  private readonly lfoCycle = new Float64Array(LFOS);
  private readonly lfoSmooth = new Float64Array(LFOS);
  private readonly lfoDone = [false, false, false, false];
  // i pezzi: le sorgenti, il modulante di ogni oscillatore, poi i due filtri e il diretto
  private readonly oscL = [buffer(), buffer()];
  private readonly oscR = [buffer(), buffer()];
  private readonly raw = [buffer(), buffer()];
  private readonly subBuf = buffer();
  private readonly noiseBufL = buffer();
  private readonly noiseBufR = buffer();
  private readonly sumL = [buffer(), buffer(), buffer()];
  private readonly sumR = [buffer(), buffer(), buffer()];
  private subPhase = 0;
  private subDt = 0;
  private subGain = 0;
  private subGainStep = 0;
  private subPanL = 1;
  private subPanR = 1;
  private noiseGain = 0;
  private noiseGainStep = 0;
  private noisePanL = 1;
  private noisePanR = 1;
  /** Gli stati del rumore colorato (rosa, marrone, tono) e del digitale, per canale. */
  private readonly pink = new Float64Array(6);
  private readonly brown = new Float64Array(2);
  private readonly tone = new Float64Array(2);
  private toneK = 1;
  private digitalPhase = 0;
  private digitalDt = 0;
  private readonly digitalHeld = new Float64Array(2);
  private readonly crackle = new Float64Array(2);
  private crackleChance = 0;
  private gain = 1;
  private gainStep = 0;
  private pitch = 60;
  private target = 60;
  /** Secondi dall'inizio della nota (per ritardo e salita degli LFO). */
  private age = 0;
  /** Appena partita da ferma: le rampe saltano subito al valore. */
  private fresh = true;
  private countdown = 0;

  constructor(private readonly s: Settings, private readonly sampleRate: number, private readonly seed: () => number, index: number) {
    const control = sampleRate / CONTROL_RATE;
    this.envs = [new CurvedEnv(sampleRate), new CurvedEnv(control), new CurvedEnv(control), new CurvedEnv(control)];
    this.shapes = this.envs.map(() => ({ attack: 0.002, hold: 0, decay: 1, sustain: 1, release: 0.05, attackCurve: 0, decayCurve: 0, releaseCurve: 0 }));
    this.filters = [new PrismaFilter(sampleRate), new PrismaFilter(sampleRate)];
    this.noiseL = new Noise(0x1234567 + index * 7919);
    this.noiseR = new Noise(0x7654321 + index * 104729);
  }

  get active(): boolean {
    return this.envs[0].active;
  }

  get releasing(): boolean {
    return this.envs[0].releasing;
  }

  get currentPitch(): number {
    return this.pitch;
  }

  start(pitch: number, velocity: number, from: number | null = null): void {
    const { s } = this;
    const note = this.seed();
    if (!this.envs[0].active) {
      for (const f of this.filters) f.reset();
      this.subPhase = 0;
      // la fase di partenza delle copie: a caso quanto dice "Fase casuale" (sempre la stessa
      // sequenza, così un rendering ripetuto suona uguale)
      this.osc.forEach((o, i) => {
        const rand = s.osc[i].rand;
        for (let k = 0; k < MAX_UNISON; k++) o.phases[k] = rand > 0 ? rand * hash01(note * 31 + k * 7 + i * 131) : 0;
      });
      this.fresh = true;
    }
    for (let i = 0; i < LFOS; i++) {
      const l = s.lfos[i];
      if (l.trig === LFO_TRIG.free) {
        this.lfoPhase[i] = s.freePhase[i];
        this.lfoCycle[i] = s.freeCycle[i];
      } else {
        this.lfoPhase[i] = 0;
        this.lfoCycle[i] = note * 17 + i * 1000;
      }
      this.lfoDone[i] = false;
      this.lfoSmooth[i] = NaN;
    }
    this.target = pitch;
    this.pitch = from ?? pitch;
    this.src[SRC.velocity] = velocity / 127;
    this.src[SRC.random] = hash01(note * 7 + 3);
    this.src[SRC.gate] = 1;
    this.age = 0;
    // le fonti fanno il primo passo degli inviluppi prima che la matrice li regoli: partono dalle
    // manopole (una voce mai usata, se no, farebbe tutto l'attacco al primo passo)
    this.val.set(s.base);
    this.shapeEnvs();
    for (const e of this.envs) e.trigger();
    this.countdown = 0;
  }

  slide(pitch: number, velocity: number): void {
    this.target = pitch;
    this.src[SRC.velocity] = velocity / 127;
  }

  release(): void {
    this.src[SRC.gate] = 0;
    for (const e of this.envs) e.release();
  }

  kill(): void {
    this.src[SRC.gate] = 0;
    for (const e of this.envs) e.kill();
  }

  /** A pezzi fra un calcolo delle modulazioni e l'altro: le sorgenti nei loro buffer, poi nei
   *  filtri secondo i percorsi, poi l'inviluppo del volume campione per campione. */
  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const { s, sumL, sumR } = this;
    const amp = this.envs[0];
    const parallel = s.filterMode === FILTER_MODE.parallel;
    for (let i = from; i < to;) {
      if (this.countdown <= 0) this.control();
      const len = Math.min(this.countdown, to - i);
      this.countdown -= len;
      for (let b = 0; b < 3; b++) {
        sumL[b].fill(0, 0, len);
        sumR[b].fill(0, 0, len);
      }
      const sub = s.subOn ? this.renderSub(len) : null;
      // il modulante prima: se A legge B, B suona per primo (e allora B non può leggere A)
      const aReadsB = CROSS_WARPS.includes(this.osc[0].warp);
      for (let step = 0; step < 2; step++) {
        const o = aReadsB ? 1 - step : step, other = 1 - o;
        const cross = this.osc[o].warp === WARP.subFm ? sub
          : CROSS_WARPS.includes(this.osc[o].warp) && s.osc[other].on && (o === 0 || !aReadsB) ? this.raw[other] : null;
        this.renderOsc(o, len, cross);
        if (s.osc[o].on) this.mix(this.oscL[o], this.oscR[o], len, routeGains(s.osc[o].route, parallel));
      }
      if (sub) this.mixSub(len, routeGains(s.subRoute, parallel));
      if (s.noiseOn) {
        this.renderNoise(len);
        this.mix(this.noiseBufL, this.noiseBufR, len, routeGains(s.noiseRoute, parallel));
      }
      // i filtri: in serie il primo va nel secondo, in parallelo si sommano; spento lascia passare
      const [f1, f2] = this.filters;
      if (s.filterOn[0]) f1.process(sumL[0], sumR[0], len);
      if (parallel) {
        if (s.filterOn[1]) f2.process(sumL[1], sumR[1], len);
        for (let j = 0; j < len; j++) {
          sumL[2][j] += sumL[0][j] + sumL[1][j];
          sumR[2][j] += sumR[0][j] + sumR[1][j];
        }
      } else {
        for (let j = 0; j < len; j++) {
          sumL[1][j] += sumL[0][j];
          sumR[1][j] += sumR[0][j];
        }
        if (s.filterOn[1]) f2.process(sumL[1], sumR[1], len);
        for (let j = 0; j < len; j++) {
          sumL[2][j] += sumL[1][j];
          sumR[2][j] += sumR[1][j];
        }
      }
      const outL = sumL[2], outR = sumR[2];
      for (let j = 0; j < len; j++, i++) {
        this.gain += this.gainStep;
        const g = amp.next() * this.gain;
        left[i] += outL[j] * g;
        right[i] += outR[j] * g;
        if (!amp.active) return;
      }
    }
  }

  private mix(l: Float64Array, r: Float64Array, len: number, gains: RouteGains): void {
    for (let b = 0; b < 3; b++) {
      const g = gains[b];
      if (!g) continue;
      const sl = this.sumL[b], sr = this.sumR[b];
      for (let j = 0; j < len; j++) {
        sl[j] += l[j] * g;
        sr[j] += r[j] * g;
      }
    }
  }

  /** Il sub con livello e pan (nei buffer del rumore, che si calcola dopo), poi nei percorsi. */
  private mixSub(len: number, gains: RouteGains): void {
    const { subBuf } = this;
    let g = this.subGain;
    for (let j = 0; j < len; j++) {
      g += this.subGainStep;
      const v = subBuf[j] * g;
      this.noiseBufL[j] = v * this.subPanL;
      this.noiseBufR[j] = v * this.subPanR;
    }
    this.subGain = g;
    this.mix(this.noiseBufL, this.noiseBufR, len, gains);
  }

  /** Il sub nel suo buffer, senza livello (fa anche da modulante per "FM dal Sub"). */
  private renderSub(len: number): Float64Array {
    const { subBuf } = this, dt = this.subDt, shape = this.s.subShape;
    let ph = this.subPhase;
    for (let j = 0; j < len; j++) {
      let v: number;
      switch (shape) {
        case 1: v = 1 - 4 * Math.abs(ph - 0.5); break;
        case 2: v = 2 * ph - 1 - polyBlep(ph, dt); break;
        case 3: v = (ph < 0.5 ? 1 : -1) + polyBlep(ph, dt) - polyBlep((ph + 0.5) % 1, dt); break;
        // un impulso al 25 %, senza la sua continua
        case 4: v = (ph < 0.25 ? 1 : -1) + polyBlep(ph, dt) - polyBlep((ph + 0.75) % 1, dt) + 0.5; break;
        default: v = Math.sin(2 * Math.PI * ph);
      }
      subBuf[j] = v;
      ph += dt;
      if (ph >= 1) ph -= 1;
    }
    this.subPhase = ph;
    return subBuf;
  }

  private renderNoise(len: number): void {
    const { noiseBufL: l, noiseBufR: r, s } = this;
    const gens = [this.noiseL, this.noiseR], bufs = [l, r];
    const type = s.noiseType;
    for (let c = 0; c < 2; c++) {
      const gen = gens[c], buf = bufs[c];
      for (let j = 0; j < len; j++) {
        const w = gen.next();
        let v: number;
        switch (type) {
          case NOISE.pink: {
            // il filtro "economico" di Paul Kellet: −3 dB per ottava
            const b = this.pink, o = c * 3;
            b[o] = 0.99765 * b[o] + w * 0.099046;
            b[o + 1] = 0.963 * b[o + 1] + w * 0.2965164;
            b[o + 2] = 0.57 * b[o + 2] + w * 1.0526913;
            v = (b[o] + b[o + 1] + b[o + 2] + w * 0.1848) * 0.3;
            break;
          }
          case NOISE.brown:
            this.brown[c] = (this.brown[c] + 0.02 * w) / 1.02;
            v = this.brown[c] * 3.5;
            break;
          case NOISE.digital:
            // tiene un valore a caso per un periodo: un rumore intonato sulla nota
            if (c === 0) {
              this.digitalPhase += this.digitalDt;
              if (this.digitalPhase >= 1) {
                this.digitalPhase -= Math.floor(this.digitalPhase);
                this.digitalHeld[0] = w;
                this.digitalHeld[1] = this.noiseR.next();
              }
            }
            v = this.digitalHeld[c];
            break;
          case NOISE.crackle:
            this.crackle[c] = this.crackle[c] * 0.6 + (Math.abs(w) < this.crackleChance ? (w > 0 ? 1 : -1) : 0);
            v = this.crackle[c];
            break;
          default:
            v = w;
        }
        // il tono: un passa-basso a un polo (il digitale e il crepitio non ne hanno)
        if (type <= NOISE.brown && this.toneK < 1) v = this.tone[c] += (v - this.tone[c]) * this.toneK;
        buf[j] = v;
      }
    }
    let g = this.noiseGain;
    for (let j = 0; j < len; j++) {
      g += this.noiseGainStep;
      l[j] *= g * this.noisePanL;
      r[j] *= g * this.noisePanR;
    }
    this.noiseGain = g;
  }

  /** Le copie dell'oscillatore `o` nei suoi buffer, con il warp; la copia di mezzo, senza
   *  livello, anche in `raw[o]` (il modulante dell'altro). Fasi e posizioni vanno avanti anche
   *  a oscillatore spento, così riaccendendolo non salta. */
  private renderOsc(oi: number, len: number, cross: Float64Array | null): void {
    const o = this.osc[oi], os = this.s.osc[oi];
    const outL = this.oscL[oi], outR = this.oscR[oi], raw = this.raw[oi];
    outL.fill(0, 0, len);
    outR.fill(0, 0, len);
    raw.fill(0, 0, len);
    const n = o.copies;
    if (!os.on) {
      for (let k = 0; k < n; k++) {
        o.phases[k] = (o.phases[k] + o.dts[k] * len) % 1;
        o.frames[k] += o.steps[k] * len;
      }
      return;
    }
    const { data, frames } = os.table;
    const next = frames > 1 ? FRAME_STRIDE : 0, maxFrame = Math.max(0, frames - 2), levelOffset = o.level * STRIDE;
    // i warp incrociati senza modulante non fanno nulla
    const warp = (CROSS_WARPS.includes(o.warp) || o.warp === WARP.subFm) && !cross ? WARP.none : o.warp;
    const a = o.warpAmt, k1 = o.warpK, gs = o.gainStep, ps = o.phaseStep, single = frames < 2;
    for (let k = 0; k < n; k++) {
      const dt = o.dts[k], st = o.steps[k], pl = o.panL[k], pr = o.panR[k], center = k === o.center;
      let ph = o.phases[k], x = o.frames[k], g = o.gain, po = o.phaseOff;
      if (warp === WARP.none) {
        // il caso più comune, senza nulla per campione oltre alla lettura
        for (let j = 0; j < len; j++) {
          x += st;
          g += gs;
          po += ps;
          let f = x | 0;
          if (f > maxFrame) f = maxFrame;
          let fx = single ? 0 : x - f;
          if (fx > 1) fx = 1;
          let p = ph + po;
          if (p >= 1) p -= 1;
          const v = lookup(data, f * FRAME_STRIDE + levelOffset, next, fx, p);
          if (center) raw[j] = v;
          outL[j] += v * g * pl;
          outR[j] += v * g * pr;
          ph += dt;
          if (ph >= 1) ph -= 1;
        }
        o.phases[k] = ph;
        o.frames[k] = x;
        continue;
      }
      for (let j = 0; j < len; j++) {
        x += st;
        g += gs;
        po += ps;
        let f = x | 0;
        if (f > maxFrame) f = maxFrame;
        let fx = single ? 0 : x - f;
        if (fx > 1) fx = 1;
        const base = f * FRAME_STRIDE + levelOffset;
        let p = ph + po;
        if (p >= 1) p -= 1;
        let v: number;
        switch (warp) {
          case WARP.sync: {
            let q = p * k1;
            q -= Math.floor(q);
            v = lookup(data, base, next, fx, q);
            // la ripartenza è uno scalino (da dove era arrivata la lettura a capo): PolyBLEP lo
            // arrotonda nei campioni attorno, come nel sync dei synth analogici virtuali
            if (p < dt || p > 1 - dt) {
              const end = Math.min(0.99999, k1 - Math.floor(k1));
              v += 0.5 * (lookup(data, base, next, fx, 0) - lookup(data, base, next, fx, end)) * polyBlep(p, dt);
            }
            break;
          }
          case WARP.softSync: {
            let q = p * k1;
            q -= Math.floor(q);
            // la finestra va a zero alla ripartenza: niente scalino
            v = lookup(data, base, next, fx, q) * 4 * p * (1 - p);
            break;
          }
          case WARP.bendUp: case WARP.bendDown:
            v = lookup(data, base, next, fx, p / (p + (1 - p) * k1));
            break;
          case WARP.bendBoth: {
            const h = p < 0.5 ? 2 * p : 2 * p - 1, e = p < 0.5 ? k1 : 1 / k1;
            v = lookup(data, base, next, fx, Math.min(0.99999, (p < 0.5 ? 0 : 0.5) + 0.5 * (h / (h + (1 - h) * e))));
            break;
          }
          case WARP.pwm:
            v = p < k1 ? lookup(data, base, next, fx, p / k1) : 0;
            break;
          case WARP.asymUp: case WARP.asymDown:
            v = lookup(data, base, next, fx, p < k1 ? (0.5 * p) / k1 : 0.5 + (0.5 * (p - k1)) / (1 - k1));
            break;
          case WARP.mirror: {
            const q = Math.min(0.99999, p < 0.5 ? 2 * p : 2 - 2 * p);
            v = lookup(data, base, next, fx, p) * (1 - a) + lookup(data, base, next, fx, q) * a;
            break;
          }
          case WARP.flip:
            v = lookup(data, base, next, fx, p);
            if (p >= 1 - a) v = -v;
            break;
          case WARP.quantize:
            v = Math.round(lookup(data, base, next, fx, p) * k1) / k1;
            break;
          case WARP.fm: case WARP.subFm: {
            let q = p + 2 * a * cross![j];
            q -= Math.floor(q);
            v = lookup(data, base, next, fx, q);
            break;
          }
          case WARP.am:
            v = lookup(data, base, next, fx, p) * (1 - a + a * (0.5 + 0.5 * cross![j]));
            break;
          case WARP.rm:
            v = lookup(data, base, next, fx, p) * (1 - a + a * cross![j]);
            break;
          default:
            v = lookup(data, base, next, fx, p);
        }
        if (center) raw[j] = v;
        v *= g;
        outL[j] += v * pl;
        outR[j] += v * pr;
        ph += dt;
        if (ph >= 1) ph -= 1;
      }
      o.phases[k] = ph;
      o.frames[k] = x;
    }
    o.gain += o.gainStep * len;
    o.phaseOff += o.phaseStep * len;
  }

  /** Modulazioni a frequenza ridotta: fonti, matrice, poi oscillatori, sub, rumore, filtri,
   *  inviluppi e volume. */
  private control(): void {
    const { s, sampleRate, val } = this;
    this.countdown = CONTROL_RATE;
    const tick = CONTROL_RATE / sampleRate;
    if (this.pitch !== this.target) {
      // glide esponenziale in semitoni: arriva al 95 % in circa `glide` secondi
      const k = s.glide > 0 ? 1 - Math.exp((-3 * CONTROL_RATE) / (s.glide * sampleRate)) : 1;
      this.pitch += (this.target - this.pitch) * k;
      if (Math.abs(this.target - this.pitch) < 1e-3) this.pitch = this.target;
    }
    this.sources(tick);
    this.modulate();
    this.age += tick;

    const fresh = this.fresh;
    const pitch = this.pitch + val[D.tune];
    for (let i = 0; i < 2; i++) this.controlOsc(i, pitch, fresh);

    const subGain = val[D.subLevel] / 100, subPan = val[D.subPan] / 100;
    if (s.subOn) {
      this.subDt = Math.min(0.49, midiToHz(pitch + s.subOctave * 12) / sampleRate);
      this.subPanL = panLeft(subPan);
      this.subPanR = panRight(subPan);
    }
    const noiseGain = val[D.nLevel] / 100, tone = val[D.nTone] / 100, noisePan = val[D.nPan] / 100;
    if (s.noiseOn) {
      this.noisePanL = panLeft(noisePan);
      this.noisePanR = panRight(noisePan);
      this.toneK = tone >= 0.999 ? 1 : 1 - Math.exp((-2 * Math.PI * 100 * Math.pow(200, tone)) / sampleRate);
      this.digitalDt = Math.min(1, (midiToHz(pitch) * Math.pow(2, (tone - 0.5) * 6)) / sampleRate);
      this.crackleChance = (10 * Math.pow(200, tone)) / sampleRate;
    }
    const gain = dbToGain(val[D.volume]);
    if (fresh) {
      this.subGain = subGain;
      this.noiseGain = noiseGain;
      this.gain = gain;
      this.subGainStep = this.noiseGainStep = this.gainStep = 0;
    } else {
      this.subGainStep = (subGain - this.subGain) / CONTROL_RATE;
      this.noiseGainStep = (noiseGain - this.noiseGain) / CONTROL_RATE;
      this.gainStep = (gain - this.gain) / CONTROL_RATE;
    }
    this.fresh = false;

    for (let f = 0; f < 2; f++) {
      if (!s.filterOn[f]) continue;
      const d = FILTER_DEST[f];
      const cutoff = val[d.cutoff] * Math.pow(2, (s.filterKey[f] * (this.pitch - 60)) / 12);
      this.filters[f].set(s.filterType[f], cutoff, val[d.res] / 100, val[d.drive] / 100, val[d.variation] / 100, val[d.mix] / 100);
    }
    this.shapeEnvs();
  }

  /** I tempi e le curve degli inviluppi dai valori (modulati) delle loro manopole. */
  private shapeEnvs(): void {
    const { s, val } = this;
    for (let n = 0; n < ENVS; n++) {
      if (n && !s.used[SRC.env1 + n]) continue;
      const d = ENV_DEST[n], shape = this.shapes[n], curves = s.curves[n];
      shape.attack = val[d.attack];
      shape.hold = s.holds[n] <= 0.0011 ? 0 : s.holds[n];
      shape.decay = val[d.decay];
      shape.sustain = val[d.sustain] / 100;
      shape.release = val[d.release];
      shape.attackCurve = curves[0];
      shape.decayCurve = curves[1];
      shape.releaseCurve = curves[2];
      this.envs[n].set(shape);
    }
  }

  /** Le fonti all'inizio di questo pezzo. */
  private sources(tick: number): void {
    const { s, src, fade, val } = this, used = s.used;
    src[SRC.env1] = this.envs[0].value;
    for (let n = 1; n < ENVS; n++) if (used[SRC.env1 + n]) src[SRC.env1 + n] = this.envs[n].next();
    src[SRC.note] = clamp01(this.pitch / 127);
    for (let m = 0; m < MACROS; m++) src[SRC.macro1 + m] = s.macros[m];
    for (let i = 0; i < LFOS; i++) {
      const l = s.lfos[i], at = SRC.lfo1 + i;
      if (!used[at]) continue;
      // durante il ritardo l'LFO è fermo e non modula; poi si apre in "salita" secondi
      const running = this.age >= l.delay - 1e-9 || l.delay <= 0.0011;
      fade[at] = !running ? 0 : l.rise <= 0.0011 ? 1 : clamp01((this.age - (l.delay <= 0.0011 ? 0 : l.delay)) / l.rise);
      const phase = (this.lfoPhase[i] + l.phase) % 1;
      let value: number;
      if (isRandomShape(l.shape)) value = randomValue(l.shape, this.lfoCycle[i] + Math.floor(this.lfoPhase[i] + l.phase), phase);
      else {
        const x = (this.lfoDone[i] ? 0.99999 : phase) * LFO_TABLE_SIZE, j = x | 0, t = x - j;
        const a = l.table[j], b = l.table[(j + 1) % LFO_TABLE_SIZE];
        value = this.lfoDone[i] ? a : a + (b - a) * t;
      }
      if (l.smooth > 0) {
        const sm = this.lfoSmooth[i];
        // fino a mezzo secondo per arrivare (al massimo)
        const k = 1 - Math.exp(-tick / (l.smooth * l.smooth * 0.5 + 1e-4));
        value = this.lfoSmooth[i] = Number.isNaN(sm) ? value : sm + (value - sm) * k;
      }
      src[at] = value;
      if (!running || this.lfoDone[i]) continue;
      const p = this.lfoPhase[i] + s.lfoHz(i, val[LFO_RATE_DEST[i]]) * tick;
      if (l.trig === LFO_TRIG.once && p >= 1) {
        this.lfoDone[i] = true;
        this.lfoPhase[i] = 1;
      } else {
        this.lfoCycle[i] += Math.floor(p);
        this.lfoPhase[i] = p % 1;
      }
    }
  }

  /** La matrice: le destinazioni toccate partono dalla loro manopola e si spostano. */
  private modulate(): void {
    const { s, src, fade, offsets, val } = this;
    val.set(s.base);
    if (!s.slots.length) return;
    for (const d of s.touched) offsets[d] = 0;
    for (const slot of s.slots) {
      let x = src[slot.src];
      if (slot.exponent !== 1) x = Math.pow(x < 0 ? 0 : x, slot.exponent);
      if (slot.bipolar) x = 2 * x - 1;
      x *= fade[slot.src];
      if (slot.aux) x *= src[slot.aux] * fade[slot.aux];
      offsets[slot.dst] += x * slot.amount;
    }
    for (const d of s.touched) val[d] = fromUnit(d, s.unit[d] + offsets[d]);
  }

  private controlOsc(i: number, pitch: number, fresh: boolean): void {
    const { s, val, sampleRate } = this;
    const o = this.osc[i], os = s.osc[i], d = OSC_DEST[i];
    // spento non serve (nemmeno come modulante: lo è solo se acceso)
    if (!os.on) return;
    const n = os.unison, last = os.table.frames - 1;
    o.copies = n;
    o.center = (n - 1) >> 1;
    const hz = midiToHz(pitch + os.octave * 12 + val[d.semi] + val[d.fine] / 100);
    const dt = hz / sampleRate, detune = n > 1 ? val[d.detune] : 0;
    const spread = val[d.spread] / 100, width = val[d.width] / 100, pan = val[d.pan] / 100, blend = val[d.blend] / 100;
    // quanto più in fretta il warp legge la tabella (per scegliere la versione senza aliasing)
    const a = val[d.warp] / 100;
    o.warp = os.warp;
    o.warpAmt = a;
    let speed = 1;
    switch (os.warp) {
      case WARP.sync: case WARP.softSync: o.warpK = speed = 1 + 15 * a; break;
      case WARP.bendUp: o.warpK = Math.pow(2, -4 * a); speed = 1 / o.warpK; break;
      case WARP.bendDown: o.warpK = Math.pow(2, 4 * a); speed = o.warpK; break;
      case WARP.bendBoth: o.warpK = Math.pow(2, -4 * a); speed = 2 / o.warpK; break;
      case WARP.pwm: o.warpK = 1 - 0.95 * a; speed = 1 / o.warpK; break;
      case WARP.asymUp: case WARP.asymDown:
        o.warpK = os.warp === WARP.asymUp ? 0.5 + 0.48 * a : 0.5 - 0.48 * a;
        speed = 0.5 / Math.min(o.warpK, 1 - o.warpK);
        break;
      case WARP.mirror: speed = a > 0 ? 2 : 1; break;
      case WARP.quantize: o.warpK = Math.pow(2, 10 - 9 * a); break;
      case WARP.fm: case WARP.subFm: speed = 1 + 6 * a; break;
      case WARP.am: case WARP.rm: speed = a > 0 ? 2 : 1; break;
    }
    o.level = levelFor(Math.min(0.49, dt * Math.pow(2, detune / 1200) * speed));
    // le copie di mezzo a pieno livello, le altre quanto dice Blend; tutte insieme come una sola
    let power = 0;
    for (let k = 0; k < n; k++) power += isMiddle(k, n) ? 1 : blend * blend;
    const norm = 1 / Math.sqrt(Math.max(1e-9, power));
    const pos = val[d.pos] / 100;
    for (let k = 0; k < n; k++) {
      const f = fan(k, n);
      o.dts[k] = Math.min(0.49, dt * Math.pow(2, (f * detune) / 1200));
      // con "Pos. ±" le copie leggono la tabella a ventaglio attorno alla posizione
      const target = clamp01(pos + f * spread * 0.5) * last;
      if (fresh) {
        o.frames[k] = target;
        o.steps[k] = 0;
      } else o.steps[k] = (target - o.frames[k]) / CONTROL_RATE;
      const g = (isMiddle(k, n) ? 1 : blend) * norm, p = clamp11(f * width + pan);
      o.panL[k] = panLeft(p) * g;
      o.panR[k] = panRight(p) * g;
    }
    const level = val[d.level] / 100, phase = val[d.phase] / 360;
    if (fresh) {
      o.gain = level;
      o.phaseOff = phase;
      o.gainStep = o.phaseStep = 0;
    } else {
      o.gainStep = (level - o.gain) / CONTROL_RATE;
      o.phaseStep = (phase - o.phaseOff) / CONTROL_RATE;
    }
  }
}

export class PrismaCore implements InstrumentCore, SamplePlayer {
  private readonly settings = new Settings();
  private readonly pool: VoicePool<PrismaVoice>;
  private readonly mono: MonoPlayer;
  private single: boolean | null = null;
  private scratchL = new Float32Array(128);
  private scratchR = new Float32Array(128);
  /** Il seme delle note (fasi, S&H, Casuale: ogni nota i suoi). */
  private notes = 0;

  constructor(private readonly sampleRate: number, voices = PRISMA_VOICES) {
    const seed = () => ++this.notes;
    this.pool = new VoicePool(Array.from({ length: voices }, (_, i) => new PrismaVoice(this.settings, sampleRate, seed, i)));
    this.mono = new MonoPlayer(this.pool.voices[0], this.settings);
  }

  setParams(params: Readonly<Record<string, number>>): void {
    this.settings.read(params);
    // passando da poli a una voce (o viceversa) si riparte puliti
    const single = this.settings.voiceMode !== VOICE_MODE.poly;
    if (this.single !== null && single !== this.single) this.silence();
    this.single = single;
  }

  setTempo(bpm: number): void {
    if (bpm > 0) this.settings.bpm = bpm;
  }

  /** Un file importato come tabella di un oscillatore ("wtA", "wtB"). */
  setSample(slot: string, sample: SampleData | null): void {
    const i = OSCS.findIndex(o => tableSlot(o) === slot);
    if (i < 0) return;
    const cycles = sample ? cyclesOf(sample.channels) : [];
    this.settings.userTables[i] = cycles.length ? { data: tableFromCycles(cycles), frames: cycles.length } : null;
    this.settings.resolveTables();
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
    if (this.pool.activeCount === 0) return;
    if (this.scratchL.length < n) {
      this.scratchL = new Float32Array(n);
      this.scratchR = new Float32Array(n);
    }
    const l = this.scratchL.subarray(0, n), r = this.scratchR.subarray(0, n);
    l.fill(0);
    r.fill(0);
    this.pool.render(l, r, 0, n);
    for (let i = 0; i < n; i++) {
      left[from + i] += l[i];
      right[from + i] += r[i];
    }
  }
}
