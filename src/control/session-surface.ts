/* What the session controllers (APC40 mkII, Launchpad) have in common: the box they
 * play (first track, first scene, width and height), the state of slots, scenes and blocks the
 * pads light up from, the chosen track, the device they move, the continuous controls
 * (the last value is applied each round, and a sweep is a single undo) and the LEDs, sent
 * only when they change and in limited bursts. Each controller brings its protocol: how
 * it starts, what each button does, what colour each LED is and how it's lit. */
import type { DeviceId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { MAX_BPM, MIN_BPM } from '../core/music-time';
import { resolveParams, visibleParamsOf, type DeviceType } from '../devices/device-type';
import { paramFromUnit, paramToUnit, type ParamSpec } from '../devices/params';
import { mappingSpec } from '../devices/rack-params';
import { effectType, instrumentType } from '../devices/registry';
import { groupSlotState, sceneState, type TrackSessionState } from '../engine/session';
import type { DeviceSettings } from '../model/device';
import type { ModTarget } from '../model/envelope';
import { MASTER, type ChainOwner, type Project } from '../model/project';
import {
  chainItems, MACRO_MAX, macroName, macroOf, macroParam, rackName, springOf, type ChainItem, type DeviceKey, type Rack,
} from '../model/rack';
import { GroupTrack, MidiTrack, type Track } from '../model/track';
import type { ClipRef } from '../store/clip-ref';
import { setEffectParam, setInstrumentParam, setTempo } from '../store/edits';
import type { Edit, ProjectStore } from '../store/project-store';
import { setMacro } from '../store/rack-edits';
import type { ControlledDevice, SessionRing, UiState } from '../ui/ui-state';

/** What the controller uses of the engine (PlaybackEngine already is one). */
export interface SurfaceEngine {
  readonly playing: boolean;
  readonly position: Beats;
  readonly metronomeOn: boolean;
  launchSlot(track: TrackId, slot: number): void;
  launchScene(index: number): void;
  stopTrack(track: TrackId): void;
  stopAllClips(): void;
  sessionState(track: Track): TrackSessionState;
  /** Where a playing curve takes a parameter now (knob offset, −1 … +1),
   *  or null: rings and faders show the value that's heard. */
  modulationAt?(owner: ChainOwner, target: ModTarget): number | null;
}

/** What the app's bottom area shows. */
export type DetailView = 'devices' | 'clip' | null;

/** The app as the controller sees it. */
export interface SurfaceHost {
  readonly store: ProjectStore;
  readonly ui: UiState;
  readonly engine: SurfaceEngine;
  togglePlay(): void;
  stopAndRewind(): void;
  toggleMetronome(): void;
  openDevices(owner: ChainOwner): void;
  openClip(ref: ClipRef): void;
  readonly detail: DetailView;
  closeDetail(): void;
  say(text: string): void;
}

/** A chain's device, as the knobs see it. A rack is a device with 8
 *  parameters, its macros, and comes before its devices (as in Live). */
export interface ChainDevice {
  /** "instrument" for the instrument, otherwise the id of the effect or the rack. */
  readonly key: string;
  readonly type: DeviceType;
  readonly settings: DeviceSettings;
  /** Only effects can be turned off. */
  readonly enabled: boolean | null;
  readonly rack?: Rack;
}

/** The device the knobs move now, with its parameters. */
export interface Controlled {
  readonly owner: ChainOwner;
  readonly chain: readonly ChainDevice[];
  readonly index: number;
  readonly device: ChainDevice;
  readonly bank: number;
  readonly banks: number;
  readonly params: readonly ParamSpec[];
}

/** How a slot's pad lights up: off, the clip's colour, playing, queued. */
export type SlotLight = 'off' | 'playing' | 'queued' | { readonly clip: string };
/** A scene's button: off (empty row), playing, queued, or the scene's colour (null: it has none). */
export type SceneLight = 'off' | 'playing' | 'queued' | { readonly color: string | null };
/** A block map pad: outside the project, the box, something playing, there are clips, empty. */
export type BlockLight = 'off' | 'ring' | 'playing' | 'clips' | 'empty';

export const INSTRUMENT_KEY = 'instrument';
/** How many parameters a device bank has (the 8 knobs, the 8 faders). */
export const PARAMS_PER_BANK = 8;
/** After how long a still fader closes its undo step. */
const MERGE_IDLE_MS = 400;
/** After the startup the controller may send the position of faders and knobs: it mustn't change
 *  the project's mixer. */
export const SETTLE_MS = 500;
/** Tap Tempo hits further apart than this restart the count. */
const TAP_RESET_MS = 2000;
/** While a control is moving its value isn't sent back to it (rounded to the parameter's
 *  step): they'd fight over the position. Still for long, it's aligned. */
const TOUCH_MS = 300;

export abstract class SessionSurface {
  /** Last value sent to each LED (and ring or fader), to send only the changes. */
  protected readonly sent = new Map<string, number>();
  /** Faders and knobs arrived since the last round: only the last value of each is applied. */
  private readonly pending = new Map<string, () => void>();
  protected shift = false;
  protected masterSelected = false;
  private lastTrack: TrackId | null = null;
  /** The chosen device in each chain, and the parameter bank of each device. */
  protected readonly deviceIndex = new Map<ChainOwner, number>();
  protected readonly banks = new Map<string, number>();
  protected locked: ControlledDevice | null = null;
  private merging = false;
  private lastMove = 0;
  protected settleUntil = 0;
  private taps: number[] = [];
  /** When each control was last moved. */
  protected readonly touched = new Map<string, number>();
  private failed = false;
  /** Disconnected: nothing more is sent. */
  protected stopped = false;

  /** The name in the status bar ("APC40", "Launchpad X"). */
  protected abstract readonly label: string;
  /** The prefix of the keys continuous changes are merged by. */
  protected abstract readonly mergePrefix: string;
  /** Tracks and scenes of the box. */
  protected abstract readonly width: number;
  protected abstract readonly height: number;
  /** At most this many messages per round: what's left goes in the next round. */
  protected abstract readonly maxSend: number;

  constructor(
    protected readonly host: SurfaceHost,
    protected readonly out: (data: number[]) => void,
    protected readonly now: () => number = () => performance.now(),
  ) {}

  /** The controller has just been connected: the startup begins. */
  abstract start(): void;
  /** The controller goes away (or the app closes). */
  abstract stop(): void;
  /** True when the startup is finished and the controller works. */
  abstract get ready(): boolean;
  /** Advances the startup with an arrived SysEx (or null, every round: for the waits). */
  protected abstract handshake(data: ArrayLike<number> | null): void;
  /** A message (not SysEx) after the startup. True if it was a continuous control: the LEDs are
   *  updated by the round, no need to do it right away. */
  protected abstract input(kind: number, channel: number, number: number, value: number): boolean;
  /** The state of every LED the controller shows now, by key (see noteKey and ccKey). */
  protected abstract leds(): Map<string, number>;
  /** The messages that light a LED. */
  protected abstract ledMessages(status: number, number: number, value: number): number[][];

  /** A round: applies the faders and knobs that arrived, closes still continuous changes, updates the LEDs. */
  tick(): void {
    if (this.stopped) return;
    if (!this.ready) return this.handshake(null);
    try {
      this.flush();
      if (this.merging && this.now() - this.lastMove > MERGE_IDLE_MS) {
        this.merging = false;
        this.host.store.endMerge();
      }
      this.refresh();
      this.failed = false;
    } catch (e) {
      // an error mustn't repeat every round in the status bar
      if (!this.failed) {
        console.error(this.label, e);
        this.fail(e);
      }
      this.failed = true;
    }
  }

  /** A MIDI message from the controller. */
  receive(data: ArrayLike<number>): void {
    if (this.stopped) return;
    if (data[0] === 0xf0) return this.handshake(data);
    if (!this.ready) return; // like Live: the controls work after the startup
    const [status, number, value = 0] = Array.from(data);
    let continuous = false;
    try {
      continuous = this.input(status & 0xf0, status & 0x0f, number, value);
    } catch (e) {
      this.fail(e);
    }
    if (!continuous) this.tick();
  }

  protected fail(e: unknown): void {
    this.host.say(`${this.label}: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ---------------------------------------------------------------- box

  protected get project(): Project {
    return this.host.store.project;
  }

  protected get ring(): SessionRing {
    return this.host.ui.sessionRing ?? { track: 0, scene: 0, width: this.width, height: this.height };
  }

  /** The columns are the session's: the visible tracks (a closed group is a single column). */
  protected trackAt(col: number): Track | undefined {
    return col >= 0 && col < this.width ? this.project.visibleTracks[this.ring.track + col] : undefined;
  }

  /** The box's tracks, one per column (undefined where there are none). */
  protected ringTracks(): (Track | undefined)[] {
    return Array.from({ length: this.width }, (_, c) => this.trackAt(c));
  }

  protected moveRing(dx: number, dy: number): void {
    this.setRing(this.ring.track + dx, this.ring.scene + dy);
  }

  /** The box stays inside the project (if there are fewer tracks than the width, it starts from the first). */
  protected setRing(track: number, scene: number): void {
    const p = this.project;
    this.host.ui.setSessionRing({
      track: clamp(track, 0, Math.max(0, p.visibleTracks.length - this.width)),
      scene: clamp(scene, 0, Math.max(0, p.scenes.length - this.height)),
      width: this.width, height: this.height,
    });
  }

  /** Can the box go in that direction? */
  protected canMove(direction: 'up' | 'down' | 'left' | 'right'): boolean {
    const r = this.ring, p = this.project;
    switch (direction) {
      case 'up': return r.scene > 0;
      case 'down': return r.scene + this.height < p.scenes.length;
      case 'left': return r.track > 0;
      case 'right': return r.track + this.width < p.visibleTracks.length;
    }
  }

  /** The pad of a box slot: launches the clip (an empty slot stops the track, like a click). */
  protected launchPad(col: number, row: number): void {
    const track = this.trackAt(col), scene = this.ring.scene + row;
    if (track && scene < this.project.scenes.length) this.host.engine.launchSlot(track.id, scene);
  }

  protected launchScene(row: number): void {
    const scene = this.ring.scene + row;
    if (scene < this.project.scenes.length) this.host.engine.launchScene(scene);
  }

  /** The block map: each pad is a block as big as the box; pressing it brings the box there. */
  protected jumpToBlock(col: number, row: number): void {
    const p = this.project;
    if (col * this.width >= p.visibleTracks.length || row * this.height >= p.scenes.length) return;
    this.setRing(col * this.width, row * this.height);
  }

  /** A track's slot: the playing one, the queued one, the clip's colour, off. */
  protected slotLight(track: Track | undefined, scene: number): SlotLight {
    if (!track || scene >= track.slots.length) return 'off';
    const { engine } = this.host;
    if (track instanceof GroupTrack) {
      // a group's slot: from its tracks, in the group's colour
      const members = this.project.soundingTracks(track.id).map(t => [t, engine.sessionState(t)] as const);
      const g = groupSlotState(members, scene);
      return g.queued ? 'queued' : g.playing ? 'playing' : g.clips ? { clip: track.color } : 'off';
    }
    const st = engine.sessionState(track);
    const clip = track.slots[scene];
    if (st.queued && typeof st.queued === 'object' && st.queued.slot === scene) return 'queued';
    if (st.playing?.slot === scene) return 'playing';
    return clip ? { clip: clip.color } : 'off';
  }

  /** The button of the box's row `row`: queued if something in the row is, playing if
   *  one of its clips plays, the scene's colour if the row has clips, off if it's empty. */
  protected sceneLight(row: number): SceneLight {
    const p = this.project, { engine } = this.host;
    const s = this.ring.scene + row;
    if (s >= p.scenes.length) return 'off';
    const scene = sceneState(p.tracks.filter(t => !(t instanceof GroupTrack)).map(t => [t, engine.sessionState(t)] as const), s);
    if (scene.queued) return 'queued';
    if (scene.playing) return 'playing';
    return scene.clips ? { color: p.scenes[s].color ?? null } : 'off';
  }

  /** A block map pad. */
  protected blockLight(col: number, row: number): BlockLight {
    const p = this.project, ring = this.ring, w = this.width, h = this.height;
    const t0 = col * w, s0 = row * h;
    if (t0 >= p.visibleTracks.length || s0 >= p.scenes.length) return 'off';
    if (ring.track >= t0 && ring.track < t0 + w && ring.scene >= s0 && ring.scene < s0 + h) return 'ring';
    const tracks = p.visibleTracks.slice(t0, t0 + w).flatMap(t => p.soundingTracks(t.id));
    const inBlock = (s: number) => s >= s0 && s < s0 + h;
    if (tracks.some(t => { const pl = this.host.engine.sessionState(t).playing; return pl && inBlock(pl.slot); })) return 'playing';
    if (tracks.some(t => t.slots.some((c, s) => c && inBlock(s)))) return 'clips';
    return 'empty';
  }

  /** The track stopped, playing, or with the stop queued. */
  protected stopLight(track: Track | undefined): 'off' | 'playing' | 'queued' {
    if (!track) return 'off';
    const st = this.host.engine.sessionState(track);
    return st.queued === 'stop' ? 'queued' : st.playing ? 'playing' : 'off';
  }

  // ---------------------------------------------------------------- chosen track

  protected selectOwner(owner: ChainOwner): void {
    const { ui } = this.host;
    this.masterSelected = owner === MASTER;
    ui.selectTrack(owner === MASTER ? null : owner);
    this.lastTrack = ui.track;
    if (this.host.detail === 'devices') this.host.openDevices(owner);
  }

  protected get selectedOwner(): ChainOwner | null {
    return this.masterSelected ? MASTER : this.host.ui.track;
  }

  // ---------------------------------------------------------------- devices

  protected moveDevice(delta: number): void {
    this.locked = null;
    const c = this.controlled();
    if (!c) return;
    const index = Math.max(0, Math.min(c.chain.length - 1, c.index + delta));
    this.deviceIndex.set(c.owner, index);
    this.host.openDevices(c.owner);
    this.announce();
  }

  protected setBank(bank: number): void {
    const c = this.controlled();
    if (!c) return;
    this.banks.set(bankKey(c.owner, c.device.key), Math.max(0, Math.min(c.banks - 1, bank)));
    this.announce();
  }

  /** In the status bar: which device and which parameters the controls have (the controller has no display). */
  protected announce(): void {
    const c = this.controlled();
    if (!c) return;
    const names = c.params.map(p => p.label).join(', ');
    this.host.say(`${this.label} · ${c.device.type.label}${c.banks > 1 ? ` · bank ${c.bank + 1}/${c.banks}` : ''}: ${names}`);
  }

  /** The device the controls move: the locked one, or the chosen one in the chosen track. */
  protected controlled(): Controlled | null {
    const p = this.project;
    const lock = this.locked;
    if (lock) {
      const chain = chainOf(p, lock.owner);
      const index = chain.findIndex(d => d.key === lock.device);
      if (index >= 0) return this.describe(lock.owner, chain, index);
      this.locked = null;
    }
    const owner = this.selectedOwner;
    if (!owner) return null;
    const chain = chainOf(p, owner);
    if (!chain.length) return null;
    return this.describe(owner, chain, Math.min(this.deviceIndex.get(owner) ?? 0, chain.length - 1));
  }

  private describe(owner: ChainOwner, chain: readonly ChainDevice[], index: number): Controlled {
    const device = chain[index];
    const all = visibleParamsOf(device.type, device.settings.params);
    const banks = Math.max(1, Math.ceil(all.length / PARAMS_PER_BANK));
    const bank = Math.min(this.banks.get(bankKey(owner, device.key)) ?? 0, banks - 1);
    return { owner, chain, index, device, bank, banks, params: all.slice(bank * PARAMS_PER_BANK, (bank + 1) * PARAMS_PER_BANK) };
  }

  /** The offset a curve gives now to the controlled device's parameter (0: none). */
  private offsetOf(c: Controlled, spec: ParamSpec): number {
    return this.host.engine.modulationAt?.(c.owner, { kind: 'device', device: c.device.key as DeviceId, param: spec.id }) ?? 0;
  }

  /** Where the controlled device's parameter is (0..1), with the playing curve: rings and
   *  faders show the value that's heard, like the knobs on screen. */
  protected heardUnit(c: Controlled, spec: ParamSpec): number {
    const base = paramToUnit(spec, resolveParams(c.device.type, c.device.settings.params)[spec.id]);
    return clamp(base + this.offsetOf(c, spec), 0, 1);
  }

  /** Parameter `i` of the controlled device's bank, brought to `unit` (0..1): the value
   *  that's heard, so with a playing curve the knob goes where needed for that to be
   *  heard (no jumps). A parameter moved by a macro isn't touched: it's said. */
  protected turnParam(i: number, unit: number): void {
    const c = this.controlled(), spec = c?.params[i];
    if (!c || !spec) return;
    const v = paramFromUnit(spec, unit - this.offsetOf(c, spec));
    const { rack, key } = c.device;
    // also a macro mapped to one of a surrounding rack
    const macro = macroOf(this.project.racksOf(c.owner), key as DeviceKey, spec.id);
    if (macro) return this.host.say(`${this.label}: ${spec.label} is moved by macro ${macro.index + 1} of ${rackName(macro.rack)}.`);
    const index = rack ? rack.macros.findIndex((_, m) => macroParam(m) === spec.id) : -1;
    const edit = rack
      ? setMacro(c.owner, rack.id, index, v)
      : key === INSTRUMENT_KEY
        ? setInstrumentParam(c.owner as TrackId, spec.id, v)
        : setEffectParam(c.owner, key as DeviceId, spec.id, v);
    const id = `param-${c.owner}-${c.device.key}-${spec.id}`;
    // a spring returns by itself: pulling it isn't an undo step (the knob doesn't say
    // when it's let go: the spring waits for it to be still)
    if (rack && rack.macros[index] && springOf(rack.macros[index])) this.later(id, () => this.host.store.apply(edit, { transient: true }));
    else this.later(id, () => this.move(edit, `${this.mergePrefix}-${id}`));
  }

  // ---------------------------------------------------------------- continuous controls

  /** The control is already in that position: no need to send it back, and for a while it isn't corrected. */
  protected touch(key: string, value: number): void {
    this.sent.set(key, value);
    this.touched.set(key, this.now());
  }

  protected later(key: string, run: () => void): void {
    this.pending.set(key, run);
  }

  private flush(): void {
    const runs = [...this.pending.values()];
    this.pending.clear();
    for (const run of runs) {
      try { run(); } catch (e) { this.fail(e); }
    }
  }

  protected tap(): void {
    const t = this.now();
    if (this.taps.length && t - this.taps.at(-1)! > TAP_RESET_MS) this.taps = [];
    this.taps = [...this.taps, t].slice(-5);
    if (this.taps.length < 2) return;
    const beat = (this.taps.at(-1)! - this.taps[0]) / (this.taps.length - 1);
    this.setBpm(60_000 / beat, `${this.mergePrefix}-tap`);
  }

  protected setBpm(bpm: number, mergeKey: string): void {
    this.move(setTempo(Math.round(Math.max(MIN_BPM, Math.min(MAX_BPM, bpm)) * 100) / 100), mergeKey);
  }

  /** A continuous change: a fader's movements are a single undo step. */
  protected move(edit: Edit, mergeKey: string): void {
    this.host.store.apply(edit, { mergeKey });
    this.merging = true;
    this.lastMove = this.now();
  }

  protected apply(edit: Edit): void {
    this.host.store.apply(edit);
  }

  // ---------------------------------------------------------------- LED

  /** Computes the state of every LED and sends the changed ones. */
  refresh(): void {
    const { ui } = this.host;
    if (ui.track !== this.lastTrack) {
      this.lastTrack = ui.track;
      if (ui.track) this.masterSelected = false;
    }
    const r = this.ring;
    this.setRing(r.track, r.scene); // tracks or scenes removed: the box comes back in
    const leds = this.leds();
    const now = this.now();
    let budget = this.maxSend;
    for (const [key, value] of leds) {
      if (this.sent.get(key) === value || now - (this.touched.get(key) ?? -Infinity) < TOUCH_MS) continue;
      if (this.muted(key)) continue;
      if (budget-- <= 0) break;
      this.send(key, value);
    }
  }

  /** A LED that isn't sent for now (see Apc40.knobFeedback). */
  protected muted(_key: string): boolean {
    return false;
  }

  /** A LED: one or more messages (see ledMessages). */
  protected send(key: string, value: number): void {
    const [kind, channel, number] = key.split(':');
    for (const m of this.ledMessages((kind === 'n' ? 0x90 : 0xb0) | Number(channel), Number(number), value)) this.out(m);
    this.sent.set(key, value);
  }

  /** Turns off all lit LEDs and frees the session (on disconnection). */
  protected darken(): void {
    for (const [key, value] of this.sent) if (value !== 0) this.send(key, 0);
    this.sent.clear();
    this.host.ui.setSessionRing(null);
    this.host.ui.setControlledDevice(null);
  }
}

/** A chain's devices, in the order the sound goes through them; each rack before
 *  its own (also of the racks it has inside). */
export function chainOf(p: Project, owner: ChainOwner): ChainDevice[] {
  const devices = new Map<DeviceKey, ChainDevice>();
  if (owner !== MASTER) {
    const track = p.track(owner);
    if (!track) return [];
    const instrument = track instanceof MidiTrack ? instrumentType(track.instrument.type) : undefined;
    if (track instanceof MidiTrack && instrument) devices.set(INSTRUMENT_KEY, { key: INSTRUMENT_KEY, type: instrument, settings: track.instrument, enabled: null });
  }
  for (const e of p.effectsOf(owner)) {
    const type = effectType(e.type);
    if (type) devices.set(e.id, { key: e.id, type, settings: e, enabled: e.enabled });
  }
  const order = p.chainKeys(owner), racks = p.racksOf(owner);
  const flat = (item: ChainItem): ChainDevice | ChainDevice[] => (item.kind === 'device'
    ? devices.get(item.key) ?? []
    : [rackDevice(p, owner, item.rack), ...chainItems(order, racks, item.rack).flatMap(flat)]);
  return chainItems(order, racks).flatMap(flat);
}

/** A rack as a device for the knobs: the 8 macros are its parameters. */
function rackDevice(p: Project, owner: ChainOwner, rack: Rack): ChainDevice {
  const params = rack.macros.map((m, i) => ({
    kind: 'number' as const, id: macroParam(i), min: 0, max: MACRO_MAX, default: 0,
    label: macroName(m, i, x => mappingSpec(p, owner, x)?.label),
  }));
  const type: DeviceType = { type: 'rack', label: rackName(rack), sections: [{ label: 'Macro', params }], presets: [] };
  const settings: DeviceSettings = { type: 'rack', preset: null, params: Object.fromEntries(rack.macros.map((m, i) => [macroParam(i), m.value])) };
  return { key: rack.id, type, settings, enabled: null, rack };
}

export const noteKey = (note: number, channel = 0) => `n:${channel}:${note}`;
export const ccKey = (cc: number, channel = 0) => `c:${channel}:${cc}`;
export const bankKey = (owner: ChainOwner, device: string) => `${owner}/${device}`;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Parameters with zero in the middle (pan, ± gains): ring or fader starting from the centre. */
export const bipolar = (p: ParamSpec) => p.kind === 'number' && p.min < 0 && p.max > 0;
