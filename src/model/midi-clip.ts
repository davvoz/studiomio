import type { ClipId } from '../core/id';
import type { Beats } from '../core/music-time';
import { Clip, fullRange, type ClipProps, type Color } from './clip';

export interface Note {
  /** 0..127 (60 = do centrale) */
  readonly pitch: number;
  readonly start: Beats;
  readonly duration: Beats;
  /** 1..127 */
  readonly velocity: number;
}

export interface MidiClipProps extends ClipProps {
  /** Ordinate per inizio, poi per altezza. */
  readonly notes: readonly Note[];
}

const byStartThenPitch = (a: Note, b: Note) => a.start - b.start || a.pitch - b.pitch;

function validNote(n: Note): Note {
  if (!Number.isInteger(n.pitch) || n.pitch < 0 || n.pitch > 127) throw new RangeError(`altezza non valida: ${n.pitch}`);
  if (!(n.duration > 0)) throw new RangeError(`durata non valida: ${n.duration}`);
  const velocity = Math.max(1, Math.min(127, Math.round(n.velocity)));
  // la stessa nota se è già valida: l'editor riconosce le note selezionate per identità
  return velocity === n.velocity ? n : { ...n, velocity };
}

/** Clip di note, da modificare nel piano roll e far suonare allo strumento della traccia. */
export class MidiClip extends Clip<MidiClipProps> {
  readonly kind = 'midi';

  static create(props: MidiClipProps): MidiClip {
    return new MidiClip({ ...props, notes: props.notes.map(validNote).sort(byStartThenPitch) });
  }

  /** Clip vuota (in loop) lunga `length` battiti. */
  static empty(id: ClipId, name: string, color: Color, length: Beats = 4): MidiClip {
    return new MidiClip({ id, name, color, ...fullRange(0, length, true), notes: [] });
  }

  protected create(props: MidiClipProps): this {
    return MidiClip.create(props) as this;
  }

  get notes(): readonly Note[] { return this.props.notes; }

  /** Note che iniziano in [from, to). */
  notesIn(from: Beats, to: Beats): Note[] {
    return this.notes.filter(n => n.start >= from && n.start < to);
  }

  withNotes(notes: readonly Note[]): MidiClip {
    return this.with({ notes });
  }

  addingNotes(...notes: Note[]): MidiClip {
    return this.withNotes([...this.notes, ...notes]);
  }

  removingNotes(predicate: (n: Note, index: number) => boolean): MidiClip {
    return this.withNotes(this.notes.filter((n, i) => !predicate(n, i)));
  }

  mappingNotes(fn: (n: Note, index: number) => Note): MidiClip {
    return this.withNotes(this.notes.map(fn));
  }

  /** Il tempo della clip moltiplicato per `factor` (×2: tutto dura il doppio, come a metà
   *  velocità; ×0.5: il contrario): note, regione, loop e modulazioni. */
  scaledTime(factor: number): MidiClip {
    if (!(factor > 0)) throw new RangeError(`fattore non valido: ${factor}`);
    const at = (b: Beats) => b * factor;
    return this.with({
      notes: this.notes.map(n => ({ ...n, start: at(n.start), duration: at(n.duration) })),
      region: { start: at(this.region.start), end: at(this.region.end) },
      loop: { ...this.loop, start: at(this.loop.start), end: at(this.loop.end) },
      ...(this.props.envelopes && {
        envelopes: this.envelopes.map(e => ({ ...e, points: e.points.map(p => ({ ...p, beat: at(p.beat) })) })),
      }),
    });
  }

  /** "Dupl. Loop" di Live: il loop (senza loop, la clip) raddoppia e la sua copia va subito dopo.
   *  Note e modulazioni copiate prendono il posto di quelle che c'erano in quel tratto. */
  duplicatingLoop(): MidiClip {
    const { start, end } = this.loop.enabled ? this.loop : this.region;
    const len = end - start, to = end + len;
    const notes = [
      ...this.notes.filter(n => n.start < end || n.start >= to),
      ...this.notesIn(start, end).map(n => ({ ...n, start: n.start + len })),
    ];
    // i punti agli estremi restano tutti e due: alla fine del loop originale la curva fa uno
    // scalino dal suo ultimo valore al primo della copia (come quando il loop ricomincia)
    const envelopes = this.envelopes.map(e => ({
      ...e,
      points: [
        ...e.points.filter(p => p.beat <= end || p.beat > to),
        ...e.points.filter(p => p.beat >= start && p.beat <= end).map(p => ({ ...p, beat: p.beat + len })),
      ].sort((a, b) => a.beat - b.beat),
    }));
    const linked = this.loop.start === this.region.start && this.loop.end === this.region.end;
    return this.with({
      notes,
      region: { ...this.region, end: Math.max(this.region.end, to) },
      loop: this.loop.enabled || linked ? { ...this.loop, end: to } : this.loop,
      ...(this.props.envelopes && { envelopes }),
    });
  }

  /** Traspone tutte le note, lasciando fuori quelle che uscirebbero da 0..127. */
  transposed(semitones: number): MidiClip {
    return this.withNotes(this.notes
      .map(n => ({ ...n, pitch: n.pitch + semitones }))
      .filter(n => n.pitch >= 0 && n.pitch <= 127));
  }
}
