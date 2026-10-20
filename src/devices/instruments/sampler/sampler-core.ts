/* Il motore del Sampler (vedi sampler.ts). Una nota fa partire una voce per ogni zona che la
 * contiene (tasti e velocity), e ogni voce legge il sample della sua zona a una velocità che dà
 * l'intonazione (interpolazione di Hermite, anche quando il file ha un'altra frequenza di
 * campionamento), dentro la regione Inizio…Fine o la sua fetta; in Classic il loop la tiene
 * finché si tiene la nota, in avanti (con la dissolvenza a potenza costante tra la fine del loop
 * e il pezzo prima dell'inizio) o avanti e indietro. Il suono passa nel filtro di Prisma e
 * nell'inviluppo del volume, campione per campione; pitch, filtro, LFO e guadagni si calcolano
 * ogni CONTROL_RATE campioni. Una voce che riparte mentre suona (mono, voce rubata) sfuma il
 * suo ultimo valore invece di saltare: niente click. */
import { dbToGain, type InstrumentCore, type SampleData, type SamplePlayer } from '../../dsp/core';
import { MonoPlayer, type MonoVoice } from '../../dsp/mono-player';
import { VoicePool, type PolyVoice } from '../../dsp/voice-pool';
import { TEMPO_RATES } from '../../rates';
import { CurvedEnv, type EnvShape } from '../prisma/curved-env';
import { PrismaFilter } from '../prisma/prisma-filter';
import { LFO_SHAPE as PRISMA_SHAPE, randomValue, shapeValue } from '../prisma/shapes';
import {
  ENV, FILTER_ENV_OCTAVES, FILTER_VEL_OCTAVES, FIRST_SLICE_NOTE, LFO_CUTOFF_OCTAVES, LFO_SYNC, LFO_TRIG, LOOP,
  LOOP_RELEASE, MAX_ZONES, MODE, sliceStarts, TRIGGER, VOICE_MODE, zoneOfSlot, zoneParam, type ZoneKey,
} from './sampler';

const CONTROL_RATE = 32;
export const SAMPLER_VOICES = 16;
/** Il loop più corto, in campioni del sample (sotto, il loop non c'è). */
const MIN_LOOP = 16;
/** Gli ultimi campioni prima della fine della regione sfumano (in campioni del sample). */
const END_FADE = 64;
/** La velocità di lettura più alta (quattro ottave sopra, a frequenze uguali, e un po' di più). */
const MAX_SPEED = 64;
/** Quanto dura la sfumatura del valore lasciato da una voce che riparte. */
const DECLICK_TIME = 0.004;

/** Le forme dell'LFO del Sampler tra quelle di Prisma (le casuali hanno il loro calcolo). */
const SHAPES: readonly number[] = [
  PRISMA_SHAPE.sine, PRISMA_SHAPE.triangle, PRISMA_SHAPE.sawUp, PRISMA_SHAPE.sawDown, PRISMA_SHAPE.square,
  PRISMA_SHAPE.sampleHold, PRISMA_SHAPE.smoothRandom,
];

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

const envShape = (v: (id: string) => number, n: number): EnvShape => ({
  attack: v(`e${n}A`), hold: v(`e${n}H`), decay: v(`e${n}D`), sustain: v(`e${n}S`) / 100, release: v(`e${n}R`),
  attackCurve: v(`e${n}Ac`), decayCurve: v(`e${n}Dc`), releaseCurve: v(`e${n}Rc`),
});

const ZONE_KEYS: readonly ZoneKey[] = ['lo', 'hi', 'vlo', 'vhi', 'root', 'tune', 'fine', 'gain', 'pan', 'start', 'end', 'loopStart', 'loopEnd'];

/** Una zona: il suo sample e i suoi valori, già nelle unità del motore. Restano gli stessi
 *  oggetti (si aggiornano), così una voce che suona segue i cambi della sua zona. */
class Zone {
  sample: SampleData | null = null;
  lo = 0;
  hi = 127;
  vlo = 1;
  vhi = 127;
  root = 60;
  /** In semitoni, con i cent. */
  tune = 0;
  gain = 1;
  pan = 0;
  start = 0;
  end = 1;
  loopStart = 0;
  loopEnd = 1;
  private readonly ids: Readonly<Record<ZoneKey, string>>;

  constructor(readonly index: number) {
    this.ids = Object.fromEntries(ZONE_KEYS.map(k => [k, zoneParam(index, k)])) as Record<ZoneKey, string>;
  }

  read(params: Readonly<Record<string, number>>): void {
    const v = (key: ZoneKey, def: number) => params[this.ids[key]] ?? def;
    const lo = v('lo', 0), hi = v('hi', 127), vlo = v('vlo', 1), vhi = v('vhi', 127);
    this.lo = Math.min(lo, hi);
    this.hi = Math.max(lo, hi);
    this.vlo = Math.min(vlo, vhi);
    this.vhi = Math.max(vlo, vhi);
    this.root = v('root', 60);
    this.tune = v('tune', 0) + v('fine', 0) / 100;
    this.gain = dbToGain(v('gain', 0));
    this.pan = v('pan', 0) / 100;
    this.start = clamp01(v('start', 0) / 100);
    this.end = Math.max(this.start, clamp01(v('end', 100) / 100));
    this.loopStart = clamp01(v('loopStart', 0) / 100);
    this.loopEnd = clamp01(v('loopEnd', 100) / 100);
  }

  /** Se la nota la fa suonare. */
  plays(pitch: number, velocity: number): boolean {
    return !!this.sample && pitch >= this.lo && pitch <= this.hi && velocity >= this.vlo && velocity <= this.vhi;
  }
}

/** I valori dei parametri, già nelle unità del motore; li leggono tutte le voci. */
class Settings {
  readonly zones = Array.from({ length: MAX_ZONES }, (_, i) => new Zone(i));
  mode = MODE.classic as number;
  reverse = false;
  gate = false;
  loop = LOOP.off as number;
  loopExit = false;
  xfade = 0;
  /** Gli inizi delle fette (frazioni), più la fine della regione in fondo (della prima zona). */
  slices: number[] = [];
  transpose = 0;
  keyTrack = 1;
  voiceMode = VOICE_MODE.poly as number;
  glide = 0;
  pitchEnv = 0;
  filterOn = false;
  fType = 0;
  fCutoff = 6000;
  fRes = 0;
  fDrive = 0;
  fVar = 0.5;
  fKey = 0;
  fEnv = 0;
  fVel = 0;
  readonly envs: EnvShape[] = [ENV.amp, ENV.filter, ENV.pitch].map(() => envShape(() => 0, 0));
  lfoShape = 0;
  lfoRate = 4;
  lfoFree = false;
  lfoFade = 0;
  lfoPitch = 0;
  lfoCutoff = 0;
  lfoVolume = 0;
  lfoPan = 0;
  velocity = 0.5;
  pan = 0;
  gain = 1;
  bpm = 120;
  /** L'LFO libero: il giro comune a tutte le voci. */
  freePhase = 0;
  freeCycle = 0;
  private params: Readonly<Record<string, number>> = {};

  read(params: Readonly<Record<string, number>>): void {
    this.params = params;
    const v = (id: string) => params[id] ?? 0;
    this.mode = v('mode');
    this.reverse = v('reverse') === 1;
    this.gate = v('trigger') === TRIGGER.gate;
    this.loop = v('loop');
    this.loopExit = v('loopRelease') === LOOP_RELEASE.exit;
    this.xfade = v('xfade') / 100;
    for (const z of this.zones) z.read(params);
    this.slices = this.mode === MODE.slice ? [...sliceStarts(params), this.zones[0].end] : [];
    this.transpose = v('transpose') + v('detune') / 100;
    this.keyTrack = (params.keyTrack ?? 100) / 100;
    this.voiceMode = v('voiceMode');
    this.glide = v('glide') / 1000;
    this.pitchEnv = v('pitchEnv');
    this.filterOn = v('fOn') === 1;
    this.fType = v('fType');
    this.fCutoff = params.fCutoff ?? 6000;
    this.fRes = v('fRes') / 100;
    this.fDrive = v('fDrive') / 100;
    this.fVar = (params.fVar ?? 50) / 100;
    this.fKey = v('fKey') / 100;
    this.fEnv = v('fEnv') / 100;
    this.fVel = v('fVel') / 100;
    for (const n of [ENV.amp, ENV.filter, ENV.pitch]) this.envs[n - 1] = envShape(v, n);
    this.lfoShape = SHAPES[v('lfoShape')] ?? PRISMA_SHAPE.sine;
    this.lfoFree = v('lfoTrig') === LFO_TRIG.free;
    this.lfoFade = v('lfoFade');
    this.lfoPitch = v('lfoPitch');
    this.lfoCutoff = v('lfoCutoff') / 100;
    this.lfoVolume = v('lfoVolume') / 100;
    this.lfoPan = v('lfoPan') / 100;
    this.velocity = (params.velocity ?? 50) / 100;
    this.pan = v('pan') / 100;
    this.gain = dbToGain(params.volume ?? -6);
    this.readRate();
  }

  setTempo(bpm: number): void {
    this.bpm = bpm;
    this.readRate();
  }

  /** La prima zona che suona la nota (in Slice la prima zona, che ha le fette), o null. */
  zoneFor(pitch: number, velocity: number): Zone | null {
    if (this.mode === MODE.slice) return this.zones[0].sample ? this.zones[0] : null;
    for (const z of this.zones) if (z.plays(pitch, velocity)) return z;
    return null;
  }

  /** Tutte le zone che suonano la nota, in `out` (che restituisce). */
  zonesFor(pitch: number, velocity: number, out: Zone[]): Zone[] {
    out.length = 0;
    if (this.mode === MODE.slice) {
      if (this.zones[0].sample) out.push(this.zones[0]);
    } else for (const z of this.zones) if (z.plays(pitch, velocity)) out.push(z);
    return out;
  }

  /** Per la voce sola (MonoPlayer): in Legato le note sovrapposte scivolano. */
  get legato(): boolean {
    return this.voiceMode === VOICE_MODE.legato;
  }

  private readRate(): void {
    const p = this.params;
    const beats = TEMPO_RATES[p.lfoDiv ?? 0]?.[1] ?? 1;
    this.lfoRate = p.lfoSync === LFO_SYNC.tempo ? this.bpm / 60 / beats : p.lfoRate ?? 4;
  }

  /** Il valore dell'LFO (0…1) al giro `cycle`, a `phase`. */
  lfoAt(cycle: number, phase: number): number {
    const shape = this.lfoShape;
    return shape === PRISMA_SHAPE.sampleHold || shape === PRISMA_SHAPE.smoothRandom ? randomValue(shape, cycle, phase) : shapeValue(shape, phase);
  }
}

class SamplerVoice implements PolyVoice, MonoVoice {
  private readonly amp: CurvedEnv;
  private readonly filterEnv: CurvedEnv;
  private readonly pitchEnv: CurvedEnv;
  private readonly filter: PrismaFilter;
  private readonly bufL = new Float64Array(CONTROL_RATE);
  private readonly bufR = new Float64Array(CONTROL_RATE);
  /** La zona che la voce suona, e il suo sample: lo tiene anche se nella zona ne arriva un altro. */
  private zone: Zone;
  private data: SampleData | null = null;
  /** La posizione nel sample come lo si vede (con Reverse, nel sample rovesciato), in campioni. */
  pos = 0;
  private dir = 1;
  private speed = 1;
  /** La fetta della voce (Slice), in campioni; −1: la regione Inizio…Fine. */
  private sliceA = -1;
  private sliceB = -1;
  private pitch = 60;
  private target = 60;
  private velocity = 1;
  private released = false;
  /** La regione è finita: la voce tace. */
  private done = false;
  private gainL = 0;
  private gainR = 0;
  private stepL = 0;
  private stepR = 0;
  private lfoPhase = 0;
  private lfoCycle = 0;
  private age = 0;
  private fresh = true;
  private countdown = 0;
  /** L'ultimo valore mandato in uscita, e quello che sfuma dopo una ripartenza. */
  private lastL = 0;
  private lastR = 0;
  private tailL = 0;
  private tailR = 0;
  private readonly tailK: number;

  constructor(private readonly s: Settings, private readonly sampleRate: number, private readonly seed: () => number) {
    const control = sampleRate / CONTROL_RATE;
    this.amp = new CurvedEnv(sampleRate);
    this.filterEnv = new CurvedEnv(control);
    this.pitchEnv = new CurvedEnv(control);
    this.filter = new PrismaFilter(sampleRate);
    this.tailK = Math.exp(-1 / (DECLICK_TIME * sampleRate));
    this.zone = s.zones[0];
  }

  get active(): boolean {
    return (this.amp.active && !this.done) || this.tailL !== 0 || this.tailR !== 0;
  }

  get releasing(): boolean {
    return this.amp.releasing || this.done;
  }

  get currentPitch(): number {
    return this.pitch;
  }

  /** Dove legge la voce, in frazione del sample (−1 se non suona). */
  get position(): number {
    const n = this.data?.channels[0].length ?? 0;
    return this.amp.active && !this.done && n > 0 ? this.pos / n : -1;
  }

  /** La zona che suona (da 0). */
  get zoneIndex(): number {
    return this.zone.index;
  }

  /** Una nota da capo: la zona `zone`, o la prima che la suona. */
  start(pitch: number, velocity: number, from: number | null = null, zone: Zone | null = null): void {
    const { s } = this;
    const z = zone ?? s.zoneFor(pitch, velocity);
    const data = z?.sample;
    if (!z || !data || data.channels[0].length < 2) return;
    const n = data.channels[0].length;
    if (s.mode === MODE.slice) {
      const i = pitch - FIRST_SLICE_NOTE;
      if (i < 0 || i >= s.slices.length - 1) return;
      this.sliceA = Math.floor(s.slices[i] * n);
      this.sliceB = Math.max(this.sliceA + 2, Math.min(n, Math.round(s.slices[i + 1] * n)));
    } else this.sliceA = this.sliceB = -1;
    if (this.amp.active && !this.done) {
      // ripartendo a metà, il valore di adesso sfuma da sé invece di saltare
      this.tailL += this.lastL;
      this.tailR += this.lastR;
    } else {
      this.filter.reset();
      this.fresh = true;
    }
    this.zone = z;
    this.data = data;
    this.lastL = this.lastR = 0;
    this.pos = this.sliceA >= 0 ? this.sliceA : Math.floor(z.start * n);
    this.dir = 1;
    this.done = false;
    this.released = false;
    this.target = pitch;
    this.pitch = from ?? pitch;
    this.velocity = velocity / 127;
    const note = this.seed();
    this.lfoPhase = s.lfoFree ? s.freePhase : 0;
    this.lfoCycle = s.lfoFree ? s.freeCycle : note * 17;
    this.age = 0;
    this.amp.set(s.envs[0]);
    this.filterEnv.set(s.envs[1]);
    this.pitchEnv.set(s.envs[2]);
    this.amp.trigger();
    this.filterEnv.trigger();
    this.pitchEnv.trigger();
    this.countdown = 0;
  }

  slide(pitch: number, velocity: number): void {
    // una fetta è un altro pezzo del sample: si riparte da lì
    if (this.s.mode === MODE.slice) return this.start(pitch, velocity, null);
    // un'altra zona è un altro sample: si riparte, scivolando dall'intonazione di adesso
    const zone = this.s.zoneFor(pitch, velocity);
    if (zone && zone !== this.zone) return this.start(pitch, velocity, this.pitch, zone);
    this.target = pitch;
    this.velocity = velocity / 127;
  }

  release(): void {
    const { s } = this;
    // in Trigger il colpo suona fino in fondo, qualunque sia la durata della nota
    if (s.mode !== MODE.classic && !s.gate) return;
    this.released = true;
    this.amp.release();
    this.filterEnv.release();
    this.pitchEnv.release();
  }

  kill(): void {
    this.amp.kill();
    this.filterEnv.kill();
    this.pitchEnv.kill();
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const { amp, bufL, bufR, tailK } = this;
    for (let i = from; i < to;) {
      if (this.countdown <= 0) this.control();
      const len = Math.min(this.countdown, to - i);
      this.countdown -= len;
      const playing = amp.active && !this.done;
      const got = playing ? this.read(len) : 0;
      if (got && this.s.filterOn) this.filter.process(bufL, bufR, got);
      for (let j = 0; j < len; j++, i++) {
        let l = 0, r = 0;
        if (j < got) {
          const g = amp.next();
          this.gainL += this.stepL;
          this.gainR += this.stepR;
          l = bufL[j] * g * this.gainL;
          r = bufR[j] * g * this.gainR;
        }
        this.lastL = l;
        this.lastR = r;
        if (this.tailL !== 0 || this.tailR !== 0) {
          l += this.tailL;
          r += this.tailR;
          this.tailL *= tailK;
          this.tailR *= tailK;
          if (Math.abs(this.tailL) < 1e-6 && Math.abs(this.tailR) < 1e-6) this.tailL = this.tailR = 0;
        }
        left[i] += l;
        right[i] += r;
      }
      if (!this.active) return;
    }
  }

  /** Legge fino a `len` campioni nei buffer; meno se la regione finisce prima (allora la voce tace). */
  private read(len: number): number {
    const { s, bufL, bufR, zone } = this;
    const data = this.data!;
    const L = data.channels[0], R = data.channels[1] ?? L, stereo = R !== L;
    const n = L.length, last = n - 1, reverse = s.reverse;
    let a: number, b: number;
    if (this.sliceA >= 0) {
      a = this.sliceA;
      b = this.sliceB;
    } else {
      a = Math.floor(zone.start * n);
      b = Math.max(a + 2, Math.min(n, Math.round(zone.end * n)));
    }
    // il loop (solo Classic): dentro la regione, lungo almeno MIN_LOOP
    let la = 0, lb = 0, xf = 0, looping = s.mode === MODE.classic && s.loop !== LOOP.off && !(this.released && s.loopExit);
    if (looping) {
      la = Math.max(a, Math.min(b - MIN_LOOP, Math.floor(zone.loopStart * n)));
      lb = Math.max(la + MIN_LOOP, Math.min(b, Math.round(zone.loopEnd * n)));
      // oltre la fine del loop (l'ha spostata la manopola) si va fino alla fine della regione
      looping = lb - la >= MIN_LOOP && this.pos <= lb;
      if (looping && s.loop === LOOP.forward) xf = Math.min(s.xfade * (lb - la), la - a);
    }
    if (!looping) this.dir = 1;
    const span = lb - la, pingPong = s.loop === LOOP.pingPong, speed = this.speed;
    let pos = this.pos, dir = this.dir;
    for (let j = 0; j < len; j++) {
      if (!looping && pos >= b) {
        this.done = true;
        this.pos = pos;
        return j;
      }
      let q = reverse ? last - pos : pos;
      if (q < 0) q = 0;
      else if (q > last) q = last;
      let k = Math.floor(q), f = q - k;
      let l = hermite(L, k, f), r = stereo ? hermite(R, k, f) : l;
      if (xf > 0 && pos > lb - xf) {
        // la fine del loop sfuma nel pezzo che sta prima del suo inizio: al giro si arriva lì
        const t = (pos - (lb - xf)) / xf, p2 = pos - span;
        q = reverse ? last - p2 : p2;
        k = Math.floor(q);
        f = q - k;
        const gOut = Math.sqrt(1 - t), gIn = Math.sqrt(t);
        l = l * gOut + hermite(L, k, f) * gIn;
        r = stereo ? r * gOut + hermite(R, k, f) * gIn : l;
      }
      if (!looping) {
        const tail = b - pos;
        if (tail < END_FADE) {
          l *= tail / END_FADE;
          r *= tail / END_FADE;
        }
      }
      bufL[j] = l;
      bufR[j] = r;
      pos += dir * speed;
      if (looping) {
        if (pingPong) {
          if (dir > 0 && pos >= lb) {
            pos = Math.max(la, 2 * lb - pos);
            dir = -1;
          } else if (dir < 0 && pos <= la) {
            pos = Math.min(lb, 2 * la - pos);
            dir = 1;
          }
        } else if (pos >= lb) pos = Math.max(la, pos - span);
      }
    }
    this.pos = pos;
    this.dir = dir;
    return len;
  }

  /** Ogni CONTROL_RATE campioni: glide, inviluppi di filtro e pitch, LFO, velocità di lettura,
   *  filtro e guadagni. */
  private control(): void {
    const { s, sampleRate, zone } = this;
    this.countdown = CONTROL_RATE;
    const tick = CONTROL_RATE / sampleRate;
    if (this.pitch !== this.target) {
      // glide esponenziale in semitoni: arriva al 95 % in circa `glide` secondi
      const k = s.glide > 0 ? 1 - Math.exp((-3 * CONTROL_RATE) / (s.glide * sampleRate)) : 1;
      this.pitch += (this.target - this.pitch) * k;
      if (Math.abs(this.target - this.pitch) < 1e-3) this.pitch = this.target;
    }
    this.amp.set(s.envs[0]);
    this.filterEnv.set(s.envs[1]);
    this.pitchEnv.set(s.envs[2]);
    const fenv = this.filterEnv.next(), penv = this.pitchEnv.next();

    // l'LFO, bipolare, che entra in `lfoFade` secondi
    const ramp = s.lfoFade > 0 ? Math.min(1, this.age / s.lfoFade) : 1;
    const lfo = (2 * s.lfoAt(this.lfoCycle, this.lfoPhase) - 1) * ramp;
    this.lfoPhase += s.lfoRate * tick;
    if (this.lfoPhase >= 1) {
      const turns = Math.floor(this.lfoPhase);
      this.lfoPhase -= turns;
      this.lfoCycle += turns;
    }
    this.age += tick;

    const sliced = s.mode === MODE.slice;
    const semis = (sliced ? 0 : (this.pitch - zone.root) * s.keyTrack) + s.transpose + zone.tune + s.pitchEnv * penv + s.lfoPitch * lfo;
    const rate = this.data ? this.data.sampleRate / sampleRate : 1;
    this.speed = Math.min(MAX_SPEED, rate * Math.pow(2, semis / 12));

    if (s.filterOn) {
      const octaves = s.fEnv * FILTER_ENV_OCTAVES * fenv + (s.fKey * (this.pitch - 60)) / 12
        + s.fVel * FILTER_VEL_OCTAVES * this.velocity + s.lfoCutoff * LFO_CUTOFF_OCTAVES * lfo;
      this.filter.set(s.fType, s.fCutoff * Math.pow(2, octaves), s.fRes, s.fDrive, s.fVar, 1);
    }

    const v = this.velocity;
    const level = (1 - s.velocity + s.velocity * v * v) * (1 - s.lfoVolume * 0.5 * (1 - lfo)) * s.gain * zone.gain;
    const pan = Math.max(-1, Math.min(1, s.pan + zone.pan + s.lfoPan * lfo));
    const gl = level * (pan > 0 ? 1 - pan : 1), gr = level * (pan < 0 ? 1 + pan : 1);
    if (this.fresh) {
      this.gainL = gl;
      this.gainR = gr;
      this.stepL = this.stepR = 0;
      this.fresh = false;
    } else {
      this.stepL = (gl - this.gainL) / CONTROL_RATE;
      this.stepR = (gr - this.gainR) / CONTROL_RATE;
    }
  }
}

/** Interpolazione di Hermite a 4 punti tra x[k] e x[k+1] (bordi ripetuti). */
const hermite = (x: Float32Array, k: number, f: number): number => {
  const n = x.length;
  const xm = x[k > 0 ? k - 1 : 0], x0 = x[k], x1 = x[k + 1 < n ? k + 1 : n - 1], x2 = x[k + 2 < n ? k + 2 : n - 1];
  const c1 = 0.5 * (x1 - xm), c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
};

export class SamplerCore implements InstrumentCore, SamplePlayer {
  private readonly settings = new Settings();
  private readonly pool: VoicePool<SamplerVoice>;
  private readonly mono: MonoPlayer;
  private single: boolean | null = null;
  private notes = 0;
  private readonly hits: Zone[] = [];

  constructor(private readonly sampleRate: number, voices = SAMPLER_VOICES) {
    const seed = () => ++this.notes;
    this.pool = new VoicePool(Array.from({ length: voices }, () => new SamplerVoice(this.settings, sampleRate, seed)));
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
    if (bpm > 0) this.settings.setTempo(bpm);
  }

  /** Il sample di una zona: le voci che suonano tengono il loro, le note dopo usano questo. */
  setSample(slot: string, sample: SampleData | null): void {
    const i = zoneOfSlot(slot);
    if (i < 0) return;
    this.settings.zones[i].sample = sample && sample.channels.length && sample.channels[0].length > 1 ? sample : null;
  }

  noteOn(id: number, pitch: number, velocity: number): void {
    const s = this.settings;
    const zones = s.zonesFor(pitch, velocity, this.hits);
    if (!zones.length) return;
    // in Slice suonano solo le note che hanno una fetta
    if (s.mode === MODE.slice && (pitch < FIRST_SLICE_NOTE || pitch >= FIRST_SLICE_NOTE + s.slices.length - 1)) return;
    // a una voce sola suona la prima zona; in poli una voce per zona
    if (this.single) this.mono.noteOn(id, pitch, velocity);
    else for (const z of zones) this.pool.noteOn(id, pitch, velocity, v => v.start(pitch, velocity, null, z));
  }

  noteOff(id: number): void {
    if (this.single) this.mono.noteOff(id);
    else this.pool.noteOff(id);
  }

  silence(): void {
    this.pool.silence();
    this.mono.silence();
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const s = this.settings;
    this.pool.render(left, right, from, to);
    // il giro dell'LFO libero, che le voci prendono quando partono
    s.freePhase += (s.lfoRate * (to - from)) / this.sampleRate;
    if (s.freePhase >= 1) {
      const turns = Math.floor(s.freePhase);
      s.freePhase -= turns;
      s.freeCycle += turns;
    }
  }

  /** Dove leggono le voci che suonano: la zona più la frazione del suo sample come lo si vede
   *  (2.25: un quarto del sample della terza zona). Le scrive in `out` e dice quante sono. */
  playheads(out: Float32Array): number {
    let k = 0;
    for (const v of this.pool.voices) {
      const p = v.position;
      if (p >= 0 && k < out.length) out[k++] = v.zoneIndex + Math.min(p, 0.9999);
    }
    return k;
  }
}
