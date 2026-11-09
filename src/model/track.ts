import type { IdFactory, PlacementId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import * as lane from './arrangement';
import { AudioClip } from './audio-clip';
import type { Clip, Color } from './clip';
import { DEFAULT_INSTRUMENT, type DeviceSettings, type EffectSettings, type InstrumentSettings } from './device';
import type { EffectList } from './effect-list';
import { INSTRUMENT_DEVICE } from './envelope';
import { MidiClip } from './midi-clip';
import { NO_RACKS, pruneRacks, type DeviceKey, type RackList } from './rack';

export interface MixerSettings {
  readonly volumeDb: number;
  /** −1 (left) .. 1 (right) */
  readonly pan: number;
  readonly mute: boolean;
  readonly solo: boolean;
}

export const DEFAULT_MIXER: MixerSettings = { volumeDb: 0, pan: 0, mute: false, solo: false };

/** A track's sends: per bus, the level in dB of the sound reaching it. */
export type Sends = Readonly<Partial<Record<TrackId, number>>>;

/** From here down a send is closed (−∞): it isn't saved and sends nothing. */
export const SEND_OFF_DB = -40;

const NO_SENDS: Sends = Object.freeze({});

export interface TrackProps<C extends Clip> {
  readonly id: TrackId;
  readonly name: string;
  readonly color: Color;
  readonly mixer: MixerSettings;
  /** Clips on the timeline (arrangement), sorted by start and without overlaps. */
  readonly arrangement: lane.Lane<C>;
  /** Session view slots, one per scene (null = empty). */
  readonly slots: readonly (C | null)[];
  /** Effect chain, in the order the sound goes through them. */
  readonly effects: readonly EffectSettings[];
  /** The racks grouping devices of the chain (absent: none). */
  readonly racks?: RackList;
  /** The group containing the track (absent: none, it goes out into the master). */
  readonly group?: TrackId;
  /** The sends to the buses (absent: all closed). */
  readonly sends?: Sends;
}

/** A track: mixer, clips on the timeline and session slots. Each track kind
 *  accepts only one kind of clip. Immutable like the clips. */
export abstract class Track<C extends Clip = Clip, P extends TrackProps<C> = TrackProps<C>> {
  abstract readonly kind: string;
  protected readonly props: P;

  protected constructor(props: P) {
    this.props = props;
  }

  protected abstract create(props: P): this;

  /** True if the clip is of the kind this track plays. */
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
  get effects(): readonly EffectSettings[] { return this.props.effects; }
  get racks(): RackList { return this.props.racks ?? NO_RACKS; }
  /** The group containing the track, or null: the sound goes out into its channel instead of the master. */
  get group(): TrackId | null { return this.props.group ?? null; }
  /** The open sends, per bus (the others are closed). */
  get sends(): Sends { return this.props.sends ?? NO_SENDS; }

  /** The level of the send to the bus, in dB (SEND_OFF_DB: closed). */
  send(bus: TrackId): number {
    return this.sends[bus] ?? SEND_OFF_DB;
  }

  /** The chain's devices in the order of the sound: the instrument (if any) and the effects. */
  get chainKeys(): readonly DeviceKey[] { return this.keysFor(this.effects); }

  protected keysFor(effects: EffectList): DeviceKey[] {
    return effects.map(e => e.id);
  }

  /** All the track's devices: the instrument (if any) and the effects. */
  get devices(): readonly DeviceSettings[] { return this.effects; }

  /** All the track's clips, timeline and session. */
  get clips(): C[] {
    return [...this.arrangement.map(p => p.clip), ...this.slots.filter((c): c is C => c !== null)];
  }

  /** End of the last clip on the timeline. */
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

  /** Puts the track in a group (null: outside). The project checks the group rules. */
  withGroup(group: TrackId | null): this {
    if (group === this.group) return this;
    return this.with({ group: group ?? undefined } as Partial<P>);
  }

  /** Opens, changes or (down to SEND_OFF_DB) closes the send to a bus. The project checks the
   *  bus rules. */
  withSend(bus: TrackId, db: number): this {
    const open = db > SEND_OFF_DB;
    if (open ? this.sends[bus] === db : !(bus in this.sends)) return this;
    const { [bus]: _, ...rest } = this.sends;
    const sends: Sends = open ? { ...rest, [bus]: db } : rest;
    return this.with({ sends: Object.keys(sends).length ? sends : undefined } as Partial<P>);
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

  /** Empties [from, to) of the track's timeline. */
  clearing(from: Beats, to: Beats, ids: IdFactory): this {
    return this.withLane(lane.clear(this.arrangement, from, to, ids));
  }

  /** Replaces the effect chain (the operations are in `effect-list`); the removed effects
   *  leave their racks. */
  withEffects(effects: EffectList): this {
    return this.withChain(effects, pruneRacks(this.keysFor(effects), this.racks));
  }

  /** Effects and racks together (e.g. a move changing order and groups). The project checks
   *  the rack rules. */
  withChain(effects: EffectList, racks: RackList): this {
    if (effects === this.effects && racks === this.racks) return this;
    return this.with({ effects, racks: racks.length ? racks : undefined } as Partial<P>);
  }

  withSlot(index: number, clip: Clip | null): this {
    this.checkSlot(index);
    if (clip && !this.accepts(clip)) throw this.wrongKind(clip);
    return this.withSlots(this.slots.map((c, i) => (i === index ? clip as C | null : c)));
  }

  /** Adds an empty slot (a new scene) at position `index`. */
  insertingSlot(index: number): this {
    const s = [...this.slots];
    s.splice(index, 0, null);
    return this.withSlots(s);
  }

  removingSlot(index: number): this {
    this.checkSlot(index);
    return this.withSlots(this.slots.filter((_, i) => i !== index));
  }

  /** Slot `from` goes to position `to` (a moved scene), the others shift. */
  movingSlot(from: number, to: number): this {
    this.checkSlot(from);
    this.checkSlot(to);
    const s = [...this.slots];
    s.splice(to, 0, ...s.splice(from, 1));
    return this.withSlots(s);
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
    if (!Number.isInteger(index) || index < 0 || index >= this.slots.length) throw new RangeError(`slot ${index} doesn't exist`);
  }

  private wrongKind(clip: Clip): Error {
    return new TypeError(`a ${this.kind} track can't contain a ${clip.kind} clip`);
  }
}

const emptyProps = (id: TrackId, name: string, color: Color, sceneCount: number) => ({
  id, name, color, mixer: DEFAULT_MIXER, arrangement: [], slots: Array<null>(sceneCount).fill(null), effects: [],
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
  /** The instrument playing the track's notes. */
  readonly instrument: InstrumentSettings;
}

/** Track of notes, played by its instrument. */
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

  override get devices(): readonly DeviceSettings[] { return [this.instrument, ...this.effects]; }

  protected override keysFor(effects: EffectList): DeviceKey[] {
    return [INSTRUMENT_DEVICE, ...super.keysFor(effects)];
  }

  withInstrument(instrument: InstrumentSettings): this {
    return this.with({ instrument });
  }

  accepts(clip: Clip): clip is MidiClip {
    return clip instanceof MidiClip;
  }
}

export interface GroupTrackProps extends TrackProps<never> {
  /** Closed: its tracks aren't visible (timeline and session), but they play. */
  readonly folded?: boolean;
}

/** Group track, as in Live: it has no clips; the group's tracks (which in the project
 *  follow it) go out into its channel, with its effects, its volume and its mute. */
export class GroupTrack extends Track<never, GroupTrackProps> {
  readonly kind = 'group';

  static create(props: GroupTrackProps): GroupTrack {
    return new GroupTrack(props);
  }

  static empty(id: TrackId, name: string, color: Color, sceneCount: number): GroupTrack {
    return new GroupTrack(emptyProps(id, name, color, sceneCount));
  }

  protected create(props: GroupTrackProps): this {
    return new GroupTrack(props) as this;
  }

  get folded(): boolean { return this.props.folded ?? false; }

  withFolded(folded: boolean): this {
    return folded === this.folded ? this : this.with({ folded: folded || undefined });
  }

  accepts(_clip: Clip): _clip is never {
    return false;
  }
}

/** The letter of the bus at position `index`, as in Live: A, B, C… (after Z, A1, B1…). */
export const busLetter = (index: number): string =>
  `${String.fromCharCode(65 + (index % 26))}${index >= 26 ? Math.floor(index / 26) : ''}`;

export interface BusTrackProps extends TrackProps<never> {
  /** Collapsed: in the session its column is narrow (only the level, mute and solo), but it plays. */
  readonly folded?: boolean;
}

/** Bus, like Live's return tracks: it has no clips or slots; it receives the sound the tracks
 *  send it (their sends), passes it through its effects and goes out into the master. In the project
 *  the buses are in a separate list, after the tracks. */
export class BusTrack extends Track<never, BusTrackProps> {
  readonly kind = 'bus';

  static create(props: BusTrackProps): BusTrack {
    return new BusTrack(props);
  }

  static empty(id: TrackId, name: string, color: Color): BusTrack {
    return new BusTrack(emptyProps(id, name, color, 0));
  }

  protected create(props: BusTrackProps): this {
    return new BusTrack(props) as this;
  }

  get folded(): boolean { return this.props.folded ?? false; }

  withFolded(folded: boolean): this {
    return folded === this.folded ? this : this.with({ folded: folded || undefined });
  }

  accepts(_clip: Clip): _clip is never {
    return false;
  }
}
