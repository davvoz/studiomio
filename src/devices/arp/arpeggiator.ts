/* The arpeggiator in front of an instrument (see arp.ts): off it lets the notes through as they are;
 * on, the held notes come out one at a time, at every step. With the transport running the steps
 * sit on the bar's grid; when stopped the clock is its own and starts with the first note, so
 * you can arpeggiate from the keyboard without starting anything. The order restarts when there's no
 * held note any more: every round of a clip sounds the same, Random and Chance included (the numbers
 * are fixed, as in the step sequencer). Pure: it's also tested in Node. */
import { hash01 } from '../dsp/step-sequencer';
import type { InstrumentCore, TransportFollower, TransportPosition } from '../dsp/core';
import { ARP_ON, ARP_RATES, ARP_STYLE } from './arp';

export interface ArpSettings {
  readonly on: boolean;
  readonly style: number;
  readonly octaves: number;
  readonly repeat: number;
  readonly stepBeats: number;
  readonly gate: number;
  readonly swing: number;
  readonly chance: number;
  readonly hold: boolean;
}

/** The settings from the device's parameters. */
export function arpSettings(p: Readonly<Record<string, number>>): ArpSettings {
  const rate = ARP_RATES[Math.round(p.arpRate ?? 6)] ?? ARP_RATES[6];
  return {
    on: (p[ARP_ON] ?? 0) >= 0.5,
    style: Math.round(p.arpStyle ?? 0),
    octaves: Math.max(1, Math.round(p.arpOctaves ?? 1)),
    repeat: Math.max(1, Math.round(p.arpRepeat ?? 1)),
    stepBeats: rate[1],
    gate: (p.arpGate ?? 60) / 100,
    swing: (p.arpSwing ?? 0) / 100,
    chance: (p.arpChance ?? 100) / 100,
    hold: (p.arpHold ?? 0) >= 0.5,
  };
}

interface Key {
  readonly pitch: number;
  readonly velocity: number;
  /** With Hold a released note stays in the loop, but the next one restarts it. */
  down: boolean;
}

interface Tone {
  readonly pitch: number;
  readonly velocity: number;
}

/** The note loop of a style, in order. `played` in the order they arrived. */
export function arpOrder(played: readonly Tone[], style: number, octaves: number): readonly Tone[] {
  const base = style === ARP_STYLE.played ? played : [...played].sort((a, b) => a.pitch - b.pitch);
  const all: Tone[] = [];
  for (let o = 0; o < octaves; o++) {
    for (const t of base) if (t.pitch + 12 * o <= 127) all.push({ pitch: t.pitch + 12 * o, velocity: t.velocity });
  }
  const inner = all.slice(1, -1).reverse();
  switch (style) {
    case ARP_STYLE.down: return [...all].reverse();
    case ARP_STYLE.upDown: return [...all, ...inner];
    case ARP_STYLE.downUp: return [...[...all].reverse(), ...[...inner].reverse()];
    case ARP_STYLE.inward: {
      const out: Tone[] = [];
      for (let lo = 0, hi = all.length - 1; lo <= hi; lo++, hi--) out.push(...(lo === hi ? [all[lo]] : [all[lo], all[hi]]));
      return out;
    }
    case ARP_STYLE.pedal: return all.length < 2 ? all : all.slice(1).flatMap(t => [all[0], t]);
    default: return all;
  }
}

/** The arpeggiator's note ids, far from those of the note queue and the sequencer. */
const ID_BASE = 0x20000000, ID_END = 0x30000000;
/** A note arriving within this fraction of the step plays it anyway (the clip starting a
 *  sample after the boundary doesn't lose the first step; the key pressed right after doesn't wait). */
const CATCH_UP = 0.5;
const EPS = 1e-9;
/** The seeds of the fixed numbers. */
const CHANCE = 11, PICK = 12;

interface Playing {
  readonly id: number;
  /** The beat at which it ends. */
  readonly offBeat: number;
}

export class Arpeggiator implements InstrumentCore, TransportFollower {
  private settings = arpSettings({});
  /** The held notes, in the order they arrived. */
  private readonly keys = new Map<number, Key>();
  /** The notes passed to the instrument with the arpeggiator off: if it's turned on they join the loop. */
  private readonly direct = new Map<number, Tone>();
  /** The loop of the held notes (null: to be rebuilt). */
  private order: readonly Tone[] | null = null;
  private playing: Playing[] = [];
  /** How many steps have passed since the loop last restarted. */
  private count = 0;
  private nextId = ID_BASE;
  private bpm = 120;
  private running = false;
  /** The beat at the start of the block and where the last played stretch ended. */
  private blockBeat = 0;
  private endBeat = 0;
  /** The beat of step 0: 0 with the transport (the bar's grid), the first note when stopped. */
  private origin = 0;
  /** The next step to play. */
  private nextIndex: number | null = null;
  /** The last step passed without notes, to recover it. */
  private missed: number | null = null;
  /** When stopped the first step starts right away, with the first note. */
  private startNow = false;

  constructor(readonly inner: InstrumentCore, private readonly sampleRate: number) {}

  setParams(params: Readonly<Record<string, number>>): void {
    const prev = this.settings, next = arpSettings(params);
    this.settings = next;
    this.inner.setParams(params);
    if (next.on && !prev.on) {
      // the notes played directly turn off: from here the arpeggiator plays them
      for (const [id, t] of this.direct) {
        this.inner.noteOff(id);
        this.keys.set(id, { ...t, down: true });
      }
      this.direct.clear();
      this.restart();
    } else if (!next.on && prev.on) {
      this.release();
      this.keys.clear();
    }
    if (next.style !== prev.style || next.octaves !== prev.octaves) this.order = null;
    if (next.stepBeats !== prev.stepBeats) this.nextIndex = null;
    if (prev.hold && !next.hold) this.dropReleased();
  }

  setTempo(bpm: number): void {
    this.bpm = bpm;
    this.inner.setTempo?.(bpm);
  }

  setTransport(position: TransportPosition | null): void {
    if (!position) {
      if (this.running) {
        this.running = false;
        this.nextIndex = this.missed = null;
      }
      this.blockBeat = this.endBeat;
      return;
    }
    this.bpm = position.bpm;
    // started, or a jump (loop, cursor moved): the grid picks up from there
    if (!this.running || Math.abs(position.beat - this.endBeat) > 1e-3) {
      this.running = true;
      this.origin = 0;
      this.startNow = false;
      this.release();
      this.nextIndex = this.missed = null;
    }
    this.blockBeat = position.beat;
  }

  noteOn(id: number, pitch: number, velocity: number): void {
    if (!this.settings.on) {
      this.direct.set(id, { pitch, velocity });
      this.inner.noteOn(id, pitch, velocity);
      return;
    }
    // Hold: the first note after releasing everything starts a new chord
    if (![...this.keys.values()].some(k => k.down)) this.keys.clear();
    if (!this.keys.size) this.restart();
    this.keys.set(id, { pitch, velocity, down: true });
    this.order = null;
  }

  noteOff(id: number): void {
    if (this.direct.delete(id)) {
      this.inner.noteOff(id);
      return;
    }
    const key = this.keys.get(id);
    if (!key) return;
    if (this.settings.hold) {
      key.down = false;
      return;
    }
    this.keys.delete(id);
    this.order = null;
  }

  silence(): void {
    this.keys.clear();
    this.direct.clear();
    this.playing = [];
    this.order = null;
    this.nextIndex = this.missed = null;
    this.startNow = false;
    this.inner.silence();
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const perFrame = this.bpm / 60 / this.sampleRate, block = this.blockBeat;
    const beatAt = (frame: number) => block + frame * perFrame;
    this.endBeat = beatAt(to);
    if (!this.settings.on) return this.inner.render(left, right, from, to);
    const frameAt = (beat: number) => Math.min(to, Math.max(from, from + Math.ceil((beat - beatAt(from)) / perFrame - EPS)));
    const step = this.settings.stepBeats;
    if (this.startNow) {
      this.startNow = false;
      this.origin = beatAt(from);
      this.nextIndex = 0;
      this.missed = null;
    }
    if (this.nextIndex === null) {
      // restart (on, jump, transport started, step changed): the step just begun is recovered
      const elapsed = (beatAt(from) - this.origin) / step;
      this.nextIndex = Math.ceil(elapsed - 1e-6);
      if (this.running && this.nextIndex > elapsed + 1e-6) this.missed = this.nextIndex - 1;
    }
    if (this.missed !== null) {
      if (beatAt(from) - this.stepBeat(this.missed) >= step * CATCH_UP) this.missed = null;
      else if (this.keys.size) {
        this.fire(beatAt(from));
        this.missed = null;
      }
    }
    let pos = from;
    for (;;) {
      const off = this.playing.reduce((first, n) => Math.min(first, n.offBeat), Infinity);
      const next = this.stepBeat(this.nextIndex);
      const beat = Math.min(off, next), at = frameAt(beat);
      if (beat >= beatAt(to) - EPS || at >= to) break;
      if (at > pos) {
        this.inner.render(left, right, pos, at);
        pos = at;
      }
      // at equal times the note-offs first: a note ending where another starts frees the voice
      if (off <= next) this.endNotes(off);
      else {
        const index = this.nextIndex++;
        if (this.keys.size) this.fire(next);
        else this.missed = index;
      }
    }
    if (pos < to) this.inner.render(left, right, pos, to);
  }

  /** The beat of step `index`: swing moves the odd ones. */
  private stepBeat(index: number): number {
    const { stepBeats: step, swing } = this.settings;
    return this.origin + (index + (index & 1 ? swing : 0)) * step;
  }

  private fire(beat: number): void {
    const s = this.settings;
    const n = this.count++, turn = Math.floor(n / s.repeat);
    if (s.chance < 1 && hash01(n, 0, CHANCE) >= s.chance) return;
    const offBeat = beat + s.stepBeats * s.gate;
    for (const t of this.tonesOf(turn)) {
      const id = this.nextId++;
      if (this.nextId >= ID_END) this.nextId = ID_BASE;
      this.inner.noteOn(id, t.pitch, t.velocity);
      this.playing.push({ id, offBeat });
    }
  }

  /** The notes of round `turn`: one, or all with Chord (which rises an octave every round). */
  private tonesOf(turn: number): readonly Tone[] {
    const { style, octaves } = this.settings;
    if (style === ARP_STYLE.chord) {
      const up = 12 * (turn % octaves);
      return [...this.keys.values()].filter(k => k.pitch + up <= 127).map(k => ({ pitch: k.pitch + up, velocity: k.velocity }));
    }
    const order = this.order ??= arpOrder([...this.keys.values()], style, octaves);
    if (!order.length) return [];
    return [order[style === ARP_STYLE.random ? Math.floor(hash01(turn, 0, PICK) * order.length) : turn % order.length]];
  }

  private endNotes(beat: number): void {
    const still: Playing[] = [];
    for (const n of this.playing) {
      if (n.offBeat <= beat) this.inner.noteOff(n.id);
      else still.push(n);
    }
    this.playing = still;
  }

  /** The loop restarts: when stopped the first step plays right away. */
  private restart(): void {
    this.count = 0;
    this.order = null;
    if (!this.running) this.startNow = true;
  }

  private dropReleased(): void {
    for (const [id, key] of this.keys) if (!key.down) this.keys.delete(id);
    this.order = null;
  }

  private release(): void {
    for (const n of this.playing) this.inner.noteOff(n.id);
    this.playing = [];
  }
}
