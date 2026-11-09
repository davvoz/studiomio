/* The step sequencer in front of an instrument (see devices/sequencer.ts): off it lets the
 * notes through as they are; on, while a note is held it plays the loop of steps transposed onto
 * it, locked to the transport's bar. The loop is deterministic: each step of each
 * pattern has its own fixed numbers (hit, accent, slide, pitch) and the knobs decide the
 * threshold: with higher Density notes are added, with higher Pitch the scale widens, without
 * the rest moving. A new pattern comes in at the start of the loop, as on a 303.
 * The slides are overlapping notes: the instrument in Legato makes them slide. Pure: it's
 * also tested in Node. */
import { SEQ_MAX_STEPS, SEQ_RATES, SEQ_SCALES } from '../sequencer';
import type { InstrumentCore, TransportFollower, TransportPosition } from './core';

/** A number in [0, 1) from three integers, always the same for the same input. */
export function hash01(a: number, b: number, c: number): number {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const HIT = 1, ACCENT = 2, SLIDE = 3, PITCH = 4;

/** Where a step falls in the beat decides when it comes in with the density: first the eighth's
 *  offbeat (the space between the kicks), then the downbeat, then the sixteenths. */
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
  /** Leaves the downbeat to the kick: no step on the beat. */
  readonly skipBeat: boolean;
}

/** A step of the loop: whether it plays, how far above the held note, whether it's accented and whether it slides into the
 *  next (the slide only counts if the next one plays too). */
export interface SeqStep {
  readonly hit: boolean;
  readonly interval: number;
  readonly accent: boolean;
  readonly slide: boolean;
}

/** Step `pos` (0 … length − 1) of pattern `pattern`, falling at beat `beatPos`. */
export function seqStep(s: SeqSettings, pattern: number, pos: number, beatPos: number): SeqStep {
  const onBeat = Math.abs(beatPos - Math.round(beatPos)) < 1e-6;
  const score = 0.55 * hash01(pattern, pos, HIT) + 0.45 * metricBias(beatPos);
  const hit = !(s.skipBeat && onBeat) && score < s.density;
  const n = s.scale.length;
  const span = 1 + s.range * (n - 1);
  const interval = s.scale[Math.min(n - 1, Math.floor(hash01(pattern, pos, PITCH) * span))] + 12 * s.octave;
  return { hit, interval, accent: hash01(pattern, pos, ACCENT) < s.accent, slide: hash01(pattern, pos, SLIDE) < s.slide };
}

/** The settings from the device's parameters. */
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

/** Note velocities: the accents above the instruments' threshold (100). */
const ACCENT_VELOCITY = 127, NORMAL_VELOCITY = 92;
/** The sequencer's note ids, far from those of the note queue. */
const SEQ_ID_BASE = 0x40000000;
/** A held note arriving within this fraction of the step plays it anyway (the clip
 *  starting a sample after the boundary doesn't lose the first step). */
const CATCH_UP = 0.5;
const EPS = 1e-9;

/** The note the sequencer is playing. */
interface Playing {
  readonly id: number;
  /** The beat it ends at (Infinity if it slides into the next step). */
  offBeat: number;
}

export class StepSequencer implements InstrumentCore, TransportFollower {
  private settings: SeqSettings = seqSettings({});
  /** The playing pattern: the new one comes in at the start of the loop. */
  private activePattern = 0;
  /** The held notes (id → pitch), in the order they arrived. */
  private readonly held = new Map<number, number>();
  /** The notes passed to the instrument with the sequencer off (id → pitch): if it's turned on they
   *  turn off and become held notes (the clip turning the sequencer on and its note arrive
   *  together: the note may arrive one block before the parameter). */
  private readonly direct = new Map<number, number>();
  private playing: Playing | null = null;
  private nextId = SEQ_ID_BASE;
  private bpm = 120;
  /** The beat at the start of the block (null: transport stopped). */
  private blockBeat: number | null = null;
  /** When stopped, with a held note (playing by hand), the clock is its own and starts with the note: the
   *  beat at the start of the block and the one where the last stretch ended. */
  private freeBeat: number | null = null;
  private freeEnd = 0;
  /** The beat where the last played stretch ended (to recognize jumps). */
  private endBeat: number | null = null;
  /** The next step boundary to play (in beats). */
  private nextStepBeat: number | null = null;
  /** The boundary of the last step passed without a held note (to recover it). */
  private missedStepBeat: number | null = null;

  constructor(private readonly inner: InstrumentCore, private readonly sampleRate: number) {}

  setParams(params: Readonly<Record<string, number>>): void {
    const prev = this.settings;
    const next = seqSettings(params);
    this.settings = next;
    this.inner.setParams(params);
    if (next.on && !prev.on) {
      // the notes played directly turn off: from here the sequencer plays them
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
      if (this.blockBeat !== null) {
        this.blockBeat = this.endBeat = this.nextStepBeat = this.missedStepBeat = null;
        this.release();
      } else if (this.freeBeat !== null) {
        this.freeBeat = this.freeEnd;
      }
      return;
    }
    this.freeBeat = null;
    this.bpm = position.bpm;
    // a jump (loop, cursor moved): the loop restarts from there
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
    const perFrame = this.bpm / 60 / this.sampleRate;
    if (this.blockBeat === null) {
      if (s.on && this.held.size) {
        this.freeBeat ??= -from * perFrame;
      } else if (this.freeBeat !== null) {
        this.freeBeat = this.nextStepBeat = this.missedStepBeat = null;
      }
    }
    const start = this.blockBeat ?? this.freeBeat;
    if (!s.on || start === null) {
      this.inner.render(left, right, from, to);
      if (this.blockBeat !== null) this.endBeat = this.blockBeat + to * perFrame;
      return;
    }
    const beatAt = (frame: number) => start + frame * perFrame;
    const frameAt = (beat: number) => Math.min(to, Math.max(from, from + Math.ceil((beat - beatAt(from)) / perFrame - EPS)));
    const step = s.stepBeats;
    if (this.nextStepBeat === null) {
      // restart (on, jump, transport started): the step just begun is recovered
      const prev = Math.floor(beatAt(from) / step + 1e-6) * step;
      if (prev < beatAt(from) - EPS) this.missedStepBeat = prev;
    }
    let nextStep = this.nextStepBeat ?? Math.ceil(beatAt(from) / step - 1e-6) * step;
    // the held note arrived shortly after a boundary: that step is played now
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
    if (this.blockBeat !== null) this.endBeat = beatAt(to);
    else this.freeEnd = beatAt(to);
  }

  /** The step starting at beat `boundary`. */
  private fireStep(boundary: number): void {
    const s = this.settings;
    const index = Math.round(boundary / s.stepBeats);
    const pos = ((index % s.length) + s.length) % s.length;
    if (pos === 0) this.activePattern = s.pattern;
    const st = seqStep(s, this.activePattern, pos, boundary);
    const prev = this.playing;
    if (!st.hit) {
      // a slide towards a step that no longer plays (the density dropped): the note ends here
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
    // the new note before turning off the sliding one: in Legato it's the slide
    this.inner.noteOn(id, pitch, st.accent ? ACCENT_VELOCITY : NORMAL_VELOCITY);
    if (prev) this.inner.noteOff(prev.id);
    const nextPos = (pos + 1) % s.length;
    const slides = st.slide && seqStep(s, this.activePattern, nextPos, boundary + s.stepBeats).hit;
    this.playing = { id, offBeat: slides ? Infinity : boundary + s.stepBeats * s.gate };
  }

  /** Turns off the sequencer's note. */
  private release(): void {
    if (this.playing) this.inner.noteOff(this.playing.id);
    this.playing = null;
  }
}
