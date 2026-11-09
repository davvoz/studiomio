import type { ClipId } from '../core/id';
import type { Beats } from '../core/music-time';
import { Clip, fullRange, type ClipProps, type Color } from './clip';
import type { InstrumentSettings } from './device';

export interface Note {
  /** 0..127 (60 = middle C) */
  readonly pitch: number;
  readonly start: Beats;
  readonly duration: Beats;
  /** 1..127 */
  readonly velocity: number;
}

export interface MidiClipProps extends ClipProps {
  /** Sorted by start, then by pitch. */
  readonly notes: readonly Note[];
  /** The sound the track's instrument takes when the clip starts (a snapshot of its
   *  parameters, like a program change). Absent: the instrument stays as it is. */
  readonly sound?: InstrumentSettings;
}

const byStartThenPitch = (a: Note, b: Note) => a.start - b.start || a.pitch - b.pitch;

function validNote(n: Note): Note {
  if (!Number.isInteger(n.pitch) || n.pitch < 0 || n.pitch > 127) throw new RangeError(`invalid pitch: ${n.pitch}`);
  if (!(n.duration > 0)) throw new RangeError(`invalid duration: ${n.duration}`);
  const velocity = Math.max(1, Math.min(127, Math.round(n.velocity)));
  // the same note if it's already valid: the editor recognizes the selected notes by identity
  return velocity === n.velocity ? n : { ...n, velocity };
}

/** Clip of notes, to edit in the piano roll and play with the track's instrument. */
export class MidiClip extends Clip<MidiClipProps> {
  readonly kind = 'midi';

  static create(props: MidiClipProps): MidiClip {
    return new MidiClip({ ...props, notes: props.notes.map(validNote).sort(byStartThenPitch) });
  }

  /** Empty clip (looping), `length` beats long. */
  static empty(id: ClipId, name: string, color: Color, length: Beats = 4): MidiClip {
    return new MidiClip({ id, name, color, ...fullRange(0, length, true), notes: [] });
  }

  protected create(props: MidiClipProps): this {
    return MidiClip.create(props) as this;
  }

  get notes(): readonly Note[] { return this.props.notes; }
  get sound(): InstrumentSettings | null { return this.props.sound ?? null; }

  /** The sound to give the instrument when the clip starts (null: none). */
  withSound(sound: InstrumentSettings | null): MidiClip {
    const { sound: _old, ...rest } = this.props;
    return MidiClip.create(sound ? { ...rest, sound } : rest);
  }

  /** Notes starting in [from, to). */
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
    return this.withNotes(this.notes.map((n, i) => fn(n, i)));
  }

  /** The clip's time multiplied by `factor` (×2: everything lasts twice as long, as at half
   *  speed; ×0.5: the opposite): notes, region, loop and modulations. */
  scaledTime(factor: number): MidiClip {
    if (!(factor > 0)) throw new RangeError(`invalid factor: ${factor}`);
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

  /** Live's "Dupl. Loop": the loop (without loop, the clip) doubles and its copy goes right after.
   *  Copied notes and modulations take the place of those that were in that stretch. */
  duplicatingLoop(): MidiClip {
    const { start, end } = this.loop.enabled ? this.loop : this.region;
    const len = end - start, to = end + len;
    const notes = [
      ...this.notes.filter(n => n.start < end || n.start >= to),
      ...this.notesIn(start, end).map(n => ({ ...n, start: n.start + len })),
    ];
    // the points at the ends both stay: at the end of the original loop the curve makes a
    // step from its last value to the copy's first (as when the loop restarts)
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

  /** Transposes all the notes, leaving out those that would go beyond 0..127. */
  transposed(semitones: number): MidiClip {
    return this.withNotes(this.notes
      .map(n => ({ ...n, pitch: n.pitch + semitones }))
      .filter(n => n.pitch >= 0 && n.pitch <= 127));
  }
}
