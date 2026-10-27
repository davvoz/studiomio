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
  /** −1 (sinistra) .. 1 (destra) */
  readonly pan: number;
  readonly mute: boolean;
  readonly solo: boolean;
}

export const DEFAULT_MIXER: MixerSettings = { volumeDb: 0, pan: 0, mute: false, solo: false };

/** Le mandate di una traccia: per bus, il livello in dB del suono che gli arriva. */
export type Sends = Readonly<Partial<Record<TrackId, number>>>;

/** Da qui in giù una mandata è chiusa (−∞): non si salva e non manda niente. */
export const SEND_OFF_DB = -40;

const NO_SENDS: Sends = Object.freeze({});

export interface TrackProps<C extends Clip> {
  readonly id: TrackId;
  readonly name: string;
  readonly color: Color;
  readonly mixer: MixerSettings;
  /** Clip sulla timeline (arrangement), ordinate per inizio e senza sovrapposizioni. */
  readonly arrangement: lane.Lane<C>;
  /** Slot della session view, uno per scena (null = vuoto). */
  readonly slots: readonly (C | null)[];
  /** Catena degli effetti, nell'ordine in cui il suono li attraversa. */
  readonly effects: readonly EffectSettings[];
  /** I rack che raggruppano dispositivi della catena (assenti: nessuno). */
  readonly racks?: RackList;
  /** Il gruppo che contiene la traccia (assente: nessuno, esce nel master). */
  readonly group?: TrackId;
  /** Le mandate verso i bus (assenti: tutte chiuse). */
  readonly sends?: Sends;
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
  get effects(): readonly EffectSettings[] { return this.props.effects; }
  get racks(): RackList { return this.props.racks ?? NO_RACKS; }
  /** Il gruppo che contiene la traccia, o null: il suono esce nel suo canale invece che nel master. */
  get group(): TrackId | null { return this.props.group ?? null; }
  /** Le mandate aperte, per bus (le altre sono chiuse). */
  get sends(): Sends { return this.props.sends ?? NO_SENDS; }

  /** Il livello della mandata verso il bus, in dB (SEND_OFF_DB: chiusa). */
  send(bus: TrackId): number {
    return this.sends[bus] ?? SEND_OFF_DB;
  }

  /** I dispositivi della catena nell'ordine del suono: lo strumento (se c'è) e gli effetti. */
  get chainKeys(): readonly DeviceKey[] { return this.keysFor(this.effects); }

  protected keysFor(effects: EffectList): DeviceKey[] {
    return effects.map(e => e.id);
  }

  /** Tutti i dispositivi della traccia: lo strumento (se c'è) e gli effetti. */
  get devices(): readonly DeviceSettings[] { return this.effects; }

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

  /** Mette la traccia in un gruppo (null: fuori). Le regole dei gruppi le controlla il progetto. */
  withGroup(group: TrackId | null): this {
    if (group === this.group) return this;
    return this.with({ group: group ?? undefined } as Partial<P>);
  }

  /** Apre, cambia o (fino a SEND_OFF_DB) chiude la mandata verso un bus. Le regole dei bus le
   *  controlla il progetto. */
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

  /** Svuota [from, to) della timeline della traccia. */
  clearing(from: Beats, to: Beats, ids: IdFactory): this {
    return this.withLane(lane.clear(this.arrangement, from, to, ids));
  }

  /** Sostituisce la catena degli effetti (le operazioni sono in `effect-list`); gli effetti tolti
   *  escono dai loro rack. */
  withEffects(effects: EffectList): this {
    return this.withChain(effects, pruneRacks(this.keysFor(effects), this.racks));
  }

  /** Effetti e rack insieme (es. uno spostamento che cambia ordine e gruppi). Le regole dei rack
   *  le controlla il progetto. */
  withChain(effects: EffectList, racks: RackList): this {
    if (effects === this.effects && racks === this.racks) return this;
    return this.with({ effects, racks: racks.length ? racks : undefined } as Partial<P>);
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

  /** Lo slot `from` va in posizione `to` (una scena spostata), gli altri scorrono. */
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
    if (!Number.isInteger(index) || index < 0 || index >= this.slots.length) throw new RangeError(`slot ${index} inesistente`);
  }

  private wrongKind(clip: Clip): Error {
    return new TypeError(`una traccia ${this.kind} non può contenere una clip ${clip.kind}`);
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
  /** Chiuso: le sue tracce non si vedono (timeline e session), ma suonano. */
  readonly folded?: boolean;
}

/** Traccia di gruppo, come in Live: non ha clip; le tracce del gruppo (che nel progetto la
 *  seguono) escono nel suo canale, con i suoi effetti, il suo volume e il suo mute. */
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

/** La lettera del bus in posizione `index`, come in Live: A, B, C… (dopo la Z, A1, B1…). */
export const busLetter = (index: number): string =>
  `${String.fromCharCode(65 + (index % 26))}${index >= 26 ? Math.floor(index / 26) : ''}`;

export interface BusTrackProps extends TrackProps<never> {
  /** Compresso: nella session la sua colonna è stretta (solo il livello, mute e solo), ma suona. */
  readonly folded?: boolean;
}

/** Bus, come le tracce di ritorno di Live: non ha clip né slot; riceve il suono che le tracce
 *  gli mandano (le loro mandate), lo passa per i suoi effetti ed esce nel master. Nel progetto
 *  i bus stanno in una lista a parte, dopo le tracce. */
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
