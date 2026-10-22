/* Il sequencer a passi davanti a uno strumento (vedi devices/sequencer.ts): spento lascia
 * passare le note com'è; acceso, finché una nota è tenuta suona il giro di passi trasposto su di
 * lei, agganciato alla battuta del trasporto. Il giro è deterministico: ogni passo di ogni
 * pattern ha i suoi numeri fissi (colpo, accento, slide, altezza) e le manopole decidono la
 * soglia: a Densità più alta si aggiungono note, a Altezza più alta si allarga la scala, senza
 * che il resto si sposti. Un pattern nuovo entra all'inizio del giro, come su una 303.
 * Gli slide sono note che si sovrappongono: lo strumento in Legato le fa scivolare. Puro: si
 * prova anche in Node. */
import { SEQ_MAX_STEPS, SEQ_RATES, SEQ_SCALES } from '../sequencer';
import type { InstrumentCore, TransportFollower, TransportPosition } from './core';

/** Un numero in [0, 1) da tre interi, sempre lo stesso per lo stesso ingresso. */
export function hash01(a: number, b: number, c: number): number {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const HIT = 1, ACCENT = 2, SLIDE = 3, PITCH = 4;

/** Dove cade un passo nel battito decide quando entra con la densità: prima il levare
 *  dell'ottavo (lo spazio tra le casse), poi il battere, poi i sedicesimi. */
function metricBias(beatPos: number): number {
  const f = beatPos - Math.floor(beatPos);
  if (Math.abs(f - 0.5) < 1e-6) return 0;
  if (f < 1e-6 || f > 1 - 1e-6) return 0.45;
  if (Math.abs(f - 0.75) < 1e-6) return 0.6;
  if (Math.abs(f - 0.25) < 1e-6) return 0.75;
  return 0.5;
}

export interface SeqSettings {
  readonly on: boolean;
  readonly pattern: number;
  readonly length: number;
  readonly stepBeats: number;
  readonly density: number;
  readonly scale: readonly number[];
  readonly range: number;
  readonly octave: number;
  readonly accent: number;
  readonly slide: number;
  readonly gate: number;
  /** Lascia il battere alla cassa: nessun passo sul battito. */
  readonly skipBeat: boolean;
}

/** Un passo del giro: se suona, quanto sopra la nota tenuta, se è accentato e se scivola nel
 *  prossimo (lo slide vale solo se anche il prossimo suona). */
export interface SeqStep {
  readonly hit: boolean;
  readonly interval: number;
  readonly accent: boolean;
  readonly slide: boolean;
}

/** Il passo `pos` (0 … length − 1) del pattern `pattern`, che cade al battito `beatPos`. */
export function seqStep(s: SeqSettings, pattern: number, pos: number, beatPos: number): SeqStep {
  const onBeat = Math.abs(beatPos - Math.round(beatPos)) < 1e-6;
  const score = 0.55 * hash01(pattern, pos, HIT) + 0.45 * metricBias(beatPos);
  const hit = !(s.skipBeat && onBeat) && score < s.density;
  const n = s.scale.length;
  const span = 1 + s.range * (n - 1);
  const interval = s.scale[Math.min(n - 1, Math.floor(hash01(pattern, pos, PITCH) * span))] + 12 * s.octave;
  return { hit, interval, accent: hash01(pattern, pos, ACCENT) < s.accent, slide: hash01(pattern, pos, SLIDE) < s.slide };
}

/** Le impostazioni dai parametri del dispositivo. */
export function seqSettings(p: Readonly<Record<string, number>>): SeqSettings {
  const rate = SEQ_RATES[Math.round(p.seqRate ?? 1)] ?? SEQ_RATES[1];
  const scale = SEQ_SCALES[Math.round(p.seqScale ?? 0)] ?? SEQ_SCALES[0];
  return {
    on: (p.seqOn ?? 0) >= 0.5,
    pattern: Math.round(p.seqPattern ?? 0),
    length: Math.max(1, Math.min(SEQ_MAX_STEPS, Math.round(p.seqLength ?? 16))),
    stepBeats: rate[1],
    density: (p.seqDensity ?? 60) / 100,
    scale: scale[1],
    range: (p.seqRange ?? 30) / 100,
    octave: Math.round(p.seqOctave ?? 0),
    accent: (p.seqAccent ?? 30) / 100,
    slide: (p.seqSlide ?? 20) / 100,
    gate: (p.seqGate ?? 55) / 100,
    skipBeat: (p.seqKick ?? 0) >= 0.5,
  };
}

/** Velocity delle note: gli accenti oltre la soglia degli strumenti (100). */
const ACCENT_VELOCITY = 127, NORMAL_VELOCITY = 92;
/** Gli id delle note del sequencer, lontani da quelli della coda delle note. */
const SEQ_ID_BASE = 0x40000000;
/** Una nota tenuta che arriva entro questa frazione del passo lo suona lo stesso (la clip che
 *  parte un campione dopo il confine non perde il primo passo). */
const CATCH_UP = 0.5;
const EPS = 1e-9;

/** La nota che il sequencer sta suonando. */
interface Playing {
  readonly id: number;
  /** Il battito in cui finisce (Infinity se scivola nel prossimo passo). */
  offBeat: number;
}

export class StepSequencer implements InstrumentCore, TransportFollower {
  private settings: SeqSettings = seqSettings({});
  /** Il pattern che suona: quello nuovo entra all'inizio del giro. */
  private activePattern = 0;
  /** Le note tenute (id → altezza), nell'ordine in cui sono arrivate. */
  private readonly held = new Map<number, number>();
  /** Le note passate allo strumento con il sequencer spento (id → altezza): se lo si accende si
   *  spengono e diventano note tenute (la clip che accende il sequencer e la sua nota arrivano
   *  insieme: la nota può arrivare un blocco prima del parametro). */
  private readonly direct = new Map<number, number>();
  private playing: Playing | null = null;
  private nextId = SEQ_ID_BASE;
  private bpm = 120;
  /** Il battito all'inizio del blocco (null: trasporto fermo). */
  private blockBeat: number | null = null;
  /** Il battito dove è finito l'ultimo tratto suonato (per riconoscere i salti). */
  private endBeat: number | null = null;
  /** Il prossimo confine di passo da suonare (in battiti). */
  private nextStepBeat: number | null = null;
  /** Il confine dell'ultimo passo passato senza nota tenuta (per recuperarlo). */
  private missedStepBeat: number | null = null;

  constructor(private readonly inner: InstrumentCore, private readonly sampleRate: number) {}

  setParams(params: Readonly<Record<string, number>>): void {
    const prev = this.settings;
    const next = seqSettings(params);
    this.settings = next;
    this.inner.setParams(params);
    if (next.on && !prev.on) {
      // le note suonate direttamente si spengono: da qui le suona il sequencer
      for (const [id, pitch] of this.direct) {
        this.inner.noteOff(id);
        this.held.set(id, pitch);
      }
      this.direct.clear();
      this.activePattern = next.pattern;
      this.nextStepBeat = null;
    } else if (!next.on && prev.on) {
      this.release();
    }
    if (next.stepBeats !== prev.stepBeats) this.nextStepBeat = null;
  }

  setTempo(bpm: number): void {
    this.bpm = bpm;
    this.inner.setTempo?.(bpm);
  }

  setTransport(position: TransportPosition | null): void {
    if (!position) {
      this.blockBeat = this.endBeat = this.nextStepBeat = this.missedStepBeat = null;
      this.release();
      return;
    }
    this.bpm = position.bpm;
    // un salto (loop, cursore spostato): il giro riparte da lì
    if (this.endBeat === null || Math.abs(position.beat - this.endBeat) > 1e-3) {
      this.release();
      this.nextStepBeat = this.missedStepBeat = null;
    }
    this.blockBeat = position.beat;
  }

  noteOn(id: number, pitch: number, velocity: number): void {
    if (!this.settings.on) {
      this.direct.set(id, pitch);
      this.inner.noteOn(id, pitch, velocity);
      return;
    }
    this.held.set(id, pitch);
  }

  noteOff(id: number): void {
    if (this.direct.delete(id)) {
      this.inner.noteOff(id);
      return;
    }
    if (this.held.delete(id) && !this.held.size) this.release();
  }

  silence(): void {
    this.held.clear();
    this.direct.clear();
    this.playing = null;
    this.nextStepBeat = this.missedStepBeat = null;
    this.inner.silence();
  }

  playheads(out: Float32Array): number {
    return this.inner.playheads?.(out) ?? 0;
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const s = this.settings;
    if (!s.on || this.blockBeat === null) {
      this.inner.render(left, right, from, to);
      if (this.blockBeat !== null) this.endBeat = this.blockBeat + (to * this.bpm) / 60 / this.sampleRate;
      return;
    }
    const perFrame = this.bpm / 60 / this.sampleRate;
    const beatAt = (frame: number) => this.blockBeat! + frame * perFrame;
    const frameAt = (beat: number) => Math.min(to, Math.max(from, from + Math.ceil((beat - beatAt(from)) / perFrame - EPS)));
    const step = s.stepBeats;
    if (this.nextStepBeat === null) {
      // si riparte (acceso, salto, trasporto partito): il passo appena cominciato si recupera
      const prev = Math.floor(beatAt(from) / step + 1e-6) * step;
      if (prev < beatAt(from) - EPS) this.missedStepBeat = prev;
    }
    let nextStep = this.nextStepBeat ?? Math.ceil(beatAt(from) / step - 1e-6) * step;
    // la nota tenuta arrivata poco dopo un confine: quel passo si suona adesso
    if (this.missedStepBeat !== null) {
      if (beatAt(from) - this.missedStepBeat >= step * CATCH_UP) this.missedStepBeat = null;
      else if (this.held.size && !this.playing) {
        this.fireStep(this.missedStepBeat);
        this.missedStepBeat = null;
      }
    }
    let pos = from;
    for (;;) {
      const off = this.playing && Number.isFinite(this.playing.offBeat) ? this.playing.offBeat : Infinity;
      const nextBeat = Math.min(off, nextStep);
      const at = frameAt(nextBeat);
      if (nextBeat >= beatAt(to) - EPS || at >= to) break;
      if (at > pos) {
        this.inner.render(left, right, pos, at);
        pos = at;
      }
      if (off <= nextStep) {
        this.inner.noteOff(this.playing!.id);
        this.playing = null;
      } else {
        const boundary = nextStep;
        nextStep = boundary + step;
        if (this.held.size) this.fireStep(boundary);
        else this.missedStepBeat = boundary;
      }
    }
    if (pos < to) this.inner.render(left, right, pos, to);
    this.nextStepBeat = nextStep;
    this.endBeat = beatAt(to);
  }

  /** Il passo che comincia al battito `boundary`. */
  private fireStep(boundary: number): void {
    const s = this.settings;
    const index = Math.round(boundary / s.stepBeats);
    const pos = ((index % s.length) + s.length) % s.length;
    if (pos === 0) this.activePattern = s.pattern;
    const st = seqStep(s, this.activePattern, pos, boundary);
    const prev = this.playing;
    if (!st.hit) {
      // uno slide verso un passo che non suona più (la densità è scesa): la nota finisce qui
      if (prev && !Number.isFinite(prev.offBeat)) {
        this.inner.noteOff(prev.id);
        this.playing = null;
      }
      return;
    }
    const root = [...this.held.values()].at(-1)!;
    const pitch = Math.max(0, Math.min(127, root + st.interval));
    const id = this.nextId++;
    if (this.nextId >= SEQ_ID_BASE * 1.5) this.nextId = SEQ_ID_BASE;
    // la nota nuova prima di spegnere quella che scivola: in Legato è lo slide
    this.inner.noteOn(id, pitch, st.accent ? ACCENT_VELOCITY : NORMAL_VELOCITY);
    if (prev) this.inner.noteOff(prev.id);
    const nextPos = (pos + 1) % s.length;
    const slides = st.slide && seqStep(s, this.activePattern, nextPos, boundary + s.stepBeats).hit;
    this.playing = { id, offBeat: slides ? Infinity : boundary + s.stepBeats * s.gate };
  }

  /** Spegne la nota del sequencer. */
  private release(): void {
    if (this.playing) this.inner.noteOff(this.playing.id);
    this.playing = null;
  }
}
