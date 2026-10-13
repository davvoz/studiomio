import type { IdFactory, PlacementId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import * as lane from './arrangement';
import { AudioClip } from './audio-clip';
import type { Clip, Color } from './clip';
import { DEFAULT_INSTRUMENT, type InstrumentSettings } from './instrument';
import { MidiClip } from './midi-clip';

export interface MixerSettings {
  readonly volumeDb: number;
  /** −1 (sinistra) .. 1 (destra) */
  readonly pan: number;
  readonly mute: boolean;
  readonly solo: boolean;
}

export const DEFAULT_MIXER: MixerSettings = { volumeDb: 0, pan: 0, mute: false, solo: false };

export interface TrackProps<C extends Clip> {
  readonly id: TrackId;
  readonly name: string;
  readonly color: Color;
  readonly mixer: MixerSettings;
  /** Clip sulla timeline (arrangement), ordinate per inizio e senza sovrapposizioni. */
  readonly arrangement: lane.Lane<C>;
  /** Slot della session view, uno per scena (null = vuoto). */
  readonly slots: readonly (C | null)[];
}

/** Una traccia: mixer, clip sulla timeline e slot della session. Ogni tipo di traccia
 *  accetta un solo tipo di clip. Immutabile come le clip. */
export abstract class Track<C extends Clip = Clip, P extends TrackProps<C> = TrackProps<C>> {
  abstract readonly kind: string;
  protected readonly props: P;

  protected constructor(props: P) {
    this.props = props;
  }

  protected abstract create(props: P): this;

  /** Vero se la clip è del tipo che questa traccia suona. */
  abstract accepts(clip: Clip): clip is C;

  protected with(patch: Partial<P>): this {
    return this.create({ ...this.props, ...patch });
  }

  get id(): TrackId { return this.props.id; }
  get name(): string { return this.props.name; }
  get color(): Color { return this.props.color; }
  get mixer(): MixerSettings { return this.props.mixer; }
  get arrangement(): lane.Lane<C> { return this.props.arrangement; }
  get slots(): readonly (C | null)[] { return this.props.slots; }

  /** Tutte le clip della traccia, timeline e session. */
  get clips(): C[] {
    return [...this.arrangement.map(p => p.clip), ...this.slots.filter((c): c is C => c !== null)];
  }

  /** Fine dell'ultima clip sulla timeline. */
  get arrangementEnd(): Beats {
    return lane.laneEnd(this.arrangement);
  }

  placement(id: PlacementId): lane.Placement<C> | undefined {
    return this.arrangement.find(p => p.id === id);
  }

  withName(name: string): this { return this.with({ name } as Partial<P>); }
  withColor(color: Color): this { return this.with({ color } as Partial<P>); }
  withMixer(patch: Partial<MixerSettings>): this {
    return this.with({ mixer: { ...this.mixer, ...patch } } as Partial<P>);
  }

  placing(placement: lane.Placement, ids: IdFactory): this {
    return this.withLane(lane.place(this.arrangement, this.checked(placement), ids));
  }

  removingPlacement(id: PlacementId): this {
    return this.withLane(lane.remove(this.arrangement, id));
  }

  updatingPlacement(id: PlacementId, fn: (p: lane.Placement<C>) => lane.Placement, ids: IdFactory): this {
    return this.withLane(lane.update(this.arrangement, id, p => this.checked(fn(p)), ids));
  }

  splitting(id: PlacementId, at: Beats, ids: IdFactory): this {
    return this.withLane(lane.split(this.arrangement, id, at, ids));
  }

  withSlot(index: number, clip: Clip | null): this {
    this.checkSlot(index);
    if (clip && !this.accepts(clip)) throw this.wrongKind(clip);
    return this.withSlots(this.slots.map((c, i) => (i === index ? clip as C | null : c)));
  }

  /** Aggiunge uno slot vuoto (una scena nuova) in posizione `index`. */
  insertingSlot(index: number): this {
    const s = [...this.slots];
    s.splice(index, 0, null);
    return this.withSlots(s);
  }

  removingSlot(index: number): this {
    this.checkSlot(index);
    return this.withSlots(this.slots.filter((_, i) => i !== index));
  }

  private withLane(arrangement: lane.Lane<C>): this {
    return this.with({ arrangement } as Partial<P>);
  }

  private withSlots(slots: readonly (C | null)[]): this {
    return this.with({ slots } as Partial<P>);
  }

  private checked(p: lane.Placement): lane.Placement<C> {
    if (!this.accepts(p.clip)) throw this.wrongKind(p.clip);
    return p as lane.Placement<C>;
  }

  private checkSlot(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.slots.length) throw new RangeError(`slot ${index} inesistente`);
  }

  private wrongKind(clip: Clip): Error {
    return new TypeError(`una traccia ${this.kind} non può contenere una clip ${clip.kind}`);
  }
}

const emptyProps = (id: TrackId, name: string, color: Color, sceneCount: number) => ({
  id, name, color, mixer: DEFAULT_MIXER, arrangement: [], slots: Array<null>(sceneCount).fill(null),
});

export class AudioTrack extends Track<AudioClip> {
  readonly kind = 'audio';

  static create(props: TrackProps<AudioClip>): AudioTrack {
    return new AudioTrack(props);
  }

  static empty(id: TrackId, name: string, color: Color, sceneCount: number): AudioTrack {
    return new AudioTrack(emptyProps(id, name, color, sceneCount));
  }

  protected create(props: TrackProps<AudioClip>): this {
    return new AudioTrack(props) as this;
  }

  accepts(clip: Clip): clip is AudioClip {
    return clip instanceof AudioClip;
  }
}

export interface MidiTrackProps extends TrackProps<MidiClip> {
  /** Lo strumento che suona le note della traccia. */
  readonly instrument: InstrumentSettings;
}

/** Traccia di note, suonate dal suo strumento. */
export class MidiTrack extends Track<MidiClip, MidiTrackProps> {
  readonly kind = 'midi';

  static create(props: MidiTrackProps): MidiTrack {
    return new MidiTrack(props);
  }

  static empty(id: TrackId, name: string, color: Color, sceneCount: number, instrument = DEFAULT_INSTRUMENT): MidiTrack {
    return new MidiTrack({ ...emptyProps(id, name, color, sceneCount), instrument });
  }

  protected create(props: MidiTrackProps): this {
    return new MidiTrack(props) as this;
  }

  get instrument(): InstrumentSettings { return this.props.instrument; }

  withInstrument(instrument: InstrumentSettings): this {
    return this.with({ instrument });
  }

  accepts(clip: Clip): clip is MidiClip {
    return clip instanceof MidiClip;
  }
}
