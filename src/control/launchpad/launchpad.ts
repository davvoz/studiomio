/* The Launchpads on the session, as in Live: the 8×8 grid launches the clips of the box (the arrows
 * move it), the buttons on the right launch the scenes, the Session button brings up the block
 * map. The rest depends on the model, as in Live's scripts:
 *  - X: Session switches to the mixer, where the buttons on the right choose volume and pan (faders drawn
 *    on the grid), stop, mute and solo (on the grid's last row);
 *  - Mini MK3: the last button on the right (Stop Solo Mute) cycles stop, solo and mute on the last row;
 *  - Pro MK3: under the grid the track row (selects, or mute, solo, stop) and the modes;
 *    Volume, Pan and Device put faders on the grid, Device with the device's parameters;
 *  - MK2: Mixer brings the mixer onto the grid (rows of stop, mute, solo; volume and pan faders).
 * The LEDs are decided by the program every round; the animations (pulse, blink) are done by the controller.
 * The controller doesn't know Web MIDI: it receives messages with `receive` and sends with `out`. */
import type { Track } from '../../model/track';
import { setMixer } from '../../store/edits';
import { dbToFader, faderToDb, knobToPan, panToKnob } from '../mixer-scale';
import { paletteIndex } from '../palette';
import { ccKey, noteKey, SessionSurface, type BlockLight, type SlotLight, type SurfaceHost } from '../session-surface';
import {
  blink, COLOR, dawMode, FADER_CHANNEL, FADER_COLOR_CHANNEL, FADER_PAGE, faderCc, faderSetup, IDENTITY_REQUEST, identityFamily,
  isMk2ChallengeResponse, layoutMessage, ledMessages, MK2_QUIT, mk2Challenge, mk2Fader, padAt, padNote, pulse, reportedLayout,
  sceneAt, sceneButton, sessionColor, SIZE, TRACK_BUTTONS, type Button, type Layout, type Model,
} from './protocol';

/** At most this many messages per round (30 ms): the Launchpads cope well, but a whole grid is
 *  better sent in two or three rounds than in a single burst. */
const MAX_SEND = 80;
/** How long each startup reply (identity, challenge) is awaited before going on anyway. */
const HANDSHAKE_MS = 1000;
/** Two Session presses closer than this are a double click (Live: 0.3 s). */
const DOUBLE_CLICK_MS = 300;

type Phase = 'identity' | 'challenge' | 'ready';

/** What the mixer controls do: nothing (the grid launches), a function per track
 *  (stop, mute, solo), or the faders on the grid (volume, pan, device parameters). */
type Mode = 'none' | 'stop' | 'mute' | 'solo' | 'volume' | 'pan' | 'device';
const FADER_MODES: readonly Mode[] = ['volume', 'pan', 'device'];
type TrackMode = 'select' | 'stop' | 'mute' | 'solo';

/** The functions' colours, as in Live's skin (novation/skin.py). */
const MODE_COLOR: Readonly<Record<Exclude<Mode, 'none'>, number>> = {
  stop: COLOR.red, mute: COLOR.yellow, solo: COLOR.blue, volume: COLOR.green, pan: COLOR.orange, device: COLOR.darkBlue,
};

/** The mixer mode buttons: X and MK2 in the scene column, from the top. */
const MIXER_COLUMN: readonly (Mode | 'sendA' | 'sendB' | 'arm')[] = ['volume', 'pan', 'sendA', 'sendB', 'stop', 'mute', 'solo', 'arm'];

const NOT_YET: Readonly<Partial<Record<Button | 'sendA' | 'sendB', string>>> = {
  note: 'The Note mode', custom: 'The Custom modes', captureMidi: 'Capture MIDI', drums: 'The Drums mode', keys: 'The Keys mode',
  user: 'The User mode', user1: 'The User mode', user2: 'The User mode', record: 'The recording', arm: 'Record arm',
  sends: 'The sends', sendA: 'The sends', sendB: 'The sends', clear: 'Clear', duplicate: 'Duplicate',
  quantize: 'The quantization', fixedLength: 'Fixed length',
};

export class Launchpad extends SessionSurface {
  protected readonly label: string;
  protected readonly mergePrefix = 'lp';
  protected readonly width = SIZE;
  protected readonly height = SIZE;
  protected readonly maxSend = MAX_SEND;
  private phase: Phase = 'identity';
  private phaseAt = 0;
  private challengeSent = false;
  /** The family from the identity reply (null if it didn't arrive). */
  identified: readonly [number, number] | null = null;
  /** The layout requested from the controller (null: to be sent). */
  private layout: Layout | null = null;
  /** The controller shows a layout of its own (note, custom…): the grid launches nothing. */
  private foreign = false;
  private overview = false;
  /** X and MK2: the scene column chooses the mixer modes. */
  private mixer = false;
  private mode: Mode = 'none';
  private sessionPressedAt = -Infinity;
  /** The number of each button, and the button of each number. */
  private readonly buttonOf = new Map<number, Button>();

  constructor(readonly model: Model, host: SurfaceHost, out: (data: number[]) => void, now?: () => number) {
    super(host, out, now);
    this.label = model.name;
    for (const [name, n] of Object.entries(model.buttons)) this.buttonOf.set(n, name as Button);
  }

  /** The controller has just been connected: it's asked who it is (see `handshake`). */
  start(): void {
    this.stopped = false;
    this.sent.clear();
    this.touched.clear();
    this.phase = 'identity';
    this.phaseAt = this.now();
    this.layout = null;
    this.overview = false;
    this.shift = false;
    this.out([...IDENTITY_REQUEST]);
  }

  get ready(): boolean {
    return this.phase === 'ready';
  }

  /** The startup, as in Live: identity, then (X, Mini, Pro) DAW mode and the Session layout, or
   *  (MK2) the challenge and the Session layout; then the LEDs. If a reply doesn't arrive it goes on anyway. */
  protected handshake(data: ArrayLike<number> | null): void {
    const now = this.now();
    if (this.phase === 'ready') {
      if (data) this.layoutReport(data);
      return;
    }
    if (this.phase === 'identity') {
      const family = data ? identityFamily(data) : null;
      if (family) this.identified = family;
      if (!family && now - this.phaseAt < HANDSHAKE_MS) return;
      if (family && (family[0] !== this.model.family[0] || family[1] !== this.model.family[1])) {
        console.warn(`${this.label}: the identity reply is from another family`, family);
      }
      if (this.model.id !== 'mk2') return this.begin();
      this.phase = 'challenge';
      this.phaseAt = now;
      this.challengeSent = false;
    }
    if (!this.challengeSent) {
      this.out(mk2Challenge(Array.from({ length: 4 }, () => Math.floor(Math.random() * 128))));
      this.challengeSent = true;
      this.phaseAt = now;
      return;
    }
    if ((data && isMk2ChallengeResponse(data)) || now - this.phaseAt >= HANDSHAKE_MS) this.begin();
  }

  /** After the startup: DAW mode, Session layout, box and LEDs. */
  private begin(): void {
    if (this.model.id !== 'mk2') this.out(dawMode(this.model, true));
    this.phase = 'ready';
    this.foreign = false;
    this.applyLayout();
    const ring = this.host.ui.sessionRing;
    this.setRing(ring?.track ?? 0, ring?.scene ?? 0);
    this.refresh();
  }

  /** The controller changed layout by itself (Note, Custom, the settings…) or went back to Session. */
  private layoutReport(data: ArrayLike<number>): void {
    const shown = reportedLayout(this.model, data);
    if (!shown) return;
    this.foreign = shown === 'other';
    // went back to Session by itself (the Pro MK3's Session): the faders are gone
    if (shown === 'session' && this.layout !== 'session') {
      this.mode = 'none';
      this.layout = 'session';
    }
    // coming back from its own layout the controller has the grid to redraw
    this.sent.clear();
  }

  /** The controller goes away (or the app closes): LEDs off and back in its own mode. */
  stop(): void {
    this.stopped = true;
    this.darken();
    this.out(this.model.id === 'mk2' ? [...MK2_QUIT] : dawMode(this.model, false));
  }

  // ---------------------------------------------------------------- messages

  protected input(kind: number, channel: number, number: number, value: number): boolean {
    const note = kind === 0x90 || kind === 0x80;
    if (note || (kind === 0xb0 && channel === 0 && !this.isFader(number, channel))) {
      const pressed = kind !== 0x80 && value > 0;
      const sceneMessage = this.model.sceneKind === (note ? 'note' : 'cc');
      const scene = sceneMessage ? sceneAt(number) : null;
      if (note && scene === null) {
        const pad = padAt(number);
        if (pad && pressed) this.pad(pad.col, pad.row);
      } else if (scene !== null) {
        if (pressed) this.scene(scene);
      } else if (!note) {
        this.button(number, pressed);
      }
      return false;
    }
    if (kind === 0xb0 && this.isFader(number, channel)) {
      this.fader(number, value);
      return true;
    }
    return true;
  }

  // ---------------------------------------------------------------- grid and scenes

  private pad(col: number, row: number): void {
    if (this.foreign || this.faders) return;
    if (this.overview) return this.jumpToBlock(col, row);
    const fn = this.gridFunction(row);
    if (fn) return this.trackFunction(fn, this.trackAt(col));
    this.launchPad(col, row);
  }

  /** The function of a grid row, if it doesn't launch clips: the last row of X and Mini in
   *  stop, mute, solo modes; the MK2's mixer rows. */
  private gridFunction(row: number): TrackMode | 'volumeReset' | 'panReset' | 'none' | null {
    const { id } = this.model;
    if (id === 'mk2' && this.mixer) return (['volumeReset', 'panReset', 'none', 'none', 'stop', 'mute', 'solo', 'none'] as const)[row];
    if ((id === 'x' || id === 'mini') && row === SIZE - 1 && isTrackMode(this.mode)) return this.mode;
    return null;
  }

  private trackFunction(fn: TrackMode | 'volumeReset' | 'panReset' | 'none', track: Track | undefined): void {
    if (!track) return;
    switch (fn) {
      case 'select': return this.selectOwner(track.id);
      case 'stop': return this.host.engine.stopTrack(track.id);
      case 'mute': return this.apply(setMixer(track.id, { mute: !track.mixer.mute }));
      case 'solo': return this.apply(setMixer(track.id, { solo: !track.mixer.solo }));
      case 'volumeReset': return this.apply(setMixer(track.id, { volumeDb: 0 }));
      case 'panReset': return this.apply(setMixer(track.id, { pan: 0 }));
    }
  }

  private scene(row: number): void {
    if (this.overview) return;
    const { id } = this.model;
    if (id === 'mini' && row === SIZE - 1) return this.cycleMiniMode();
    if (id === 'pro' && this.mode === 'device') {
      const dev = this.controlled();
      if (dev && row < dev.banks) this.setBank(row);
      return;
    }
    if ((id === 'x' || id === 'mk2') && this.mixer) return this.mixerColumn(row);
    this.launchScene(row);
  }

  /** X and MK2 in the mixer: the buttons on the right choose the mode (pressed again, they leave it). On the
   *  MK2 the last four, outside the faders, stop everything and remove mute and solo from all. */
  private mixerColumn(row: number): void {
    const p = this.project, choice = MIXER_COLUMN[row];
    if (this.model.id === 'mk2' && row >= 4) {
      if (choice === 'stop') return this.host.engine.stopAllClips();
      if (choice === 'mute') return p.tracks.filter(t => t.mixer.mute).forEach(t => this.apply(setMixer(t.id, { mute: false })));
      if (choice === 'solo') return p.tracks.filter(t => t.mixer.solo).forEach(t => this.apply(setMixer(t.id, { solo: false })));
    }
    if (choice === 'sendA' || choice === 'sendB' || choice === 'arm') return this.notYet(choice);
    this.setMode(this.mode === choice ? 'none' : choice);
  }

  /** Mini MK3: Stop Solo Mute cycles the last row's modes, as in Live. */
  private cycleMiniMode(): void {
    const order: readonly Mode[] = ['none', 'stop', 'solo', 'mute'];
    this.setMode(order[(order.indexOf(this.mode) + 1) % order.length]);
  }

  // ---------------------------------------------------------------- buttons

  private button(n: number, pressed: boolean): void {
    if (this.model.id === 'pro' && n >= TRACK_BUTTONS && n < TRACK_BUTTONS + SIZE) {
      if (pressed) this.trackFunction(isTrackMode(this.mode) ? this.mode : 'select', this.trackAt(n - TRACK_BUTTONS));
      return;
    }
    const b = this.buttonOf.get(n);
    if (!b) return;
    if (!pressed) return this.released(b);
    switch (b) {
      case 'up': case 'down': case 'left': case 'right': return this.arrow(b);
      case 'session': return this.sessionButton();
      case 'shift': this.shift = true; return;
      case 'mixer': return this.mk2Mixer();
      case 'play': return this.shift ? this.host.stopAndRewind() : this.host.togglePlay();
    }
    if (this.model.id === 'pro' && this.proMode(b)) return;
    const missing = NOT_YET[b];
    if (missing) this.notYet(b, missing);
  }

  private released(b: Button): void {
    if (b === 'shift') this.shift = false;
    // Pro MK3 and MK2: the block map shows while Session is held
    if (b === 'session' && (this.model.id === 'pro' || this.model.id === 'mk2')) this.overview = false;
  }

  private notYet(b: Button | 'sendA' | 'sendB', what = NOT_YET[b]): void {
    if (what) this.host.say(`${this.label}: ${what} isn't in studiomio yet.`);
  }

  /** The arrows move the box by one (by a page with Shift or on the block map);
   *  Pro MK3 with the device parameters: ◂ ▸ change device. */
  private arrow(b: 'up' | 'down' | 'left' | 'right'): void {
    if (this.model.id === 'pro' && this.mode === 'device') {
      if (b === 'left' || b === 'right') this.moveDevice(b === 'left' ? -1 : 1);
      return;
    }
    const step = this.overview || this.shift ? SIZE : 1;
    if (b === 'up') this.moveRing(0, -step);
    else if (b === 'down') this.moveRing(0, step);
    else if (b === 'left') this.moveRing(-step, 0);
    else this.moveRing(step, 0);
  }

  /** Session, as in Live. If the controller shows a layout of its own, first of all it goes back to
   *  Session. X: switches from launching to the mixer and vice versa, a double click opens the block map
   *  (and a press closes it). Mini MK3: double click for the map. Pro MK3 and MK2: the map
   *  while it's held (MK2: and it goes back from the mixer to Session). */
  private sessionButton(): void {
    const now = this.now(), { id } = this.model;
    const double = now - this.sessionPressedAt < DOUBLE_CLICK_MS;
    this.sessionPressedAt = now;
    if (this.foreign) {
      this.foreign = false;
      this.layout = null;
      this.applyLayout();
      return;
    }
    if (id === 'pro' || id === 'mk2') {
      if (id === 'mk2') {
        this.mixer = false;
        this.setMode('none');
      }
      // the map sits on the Session layout: the faders go away
      if (this.faders) this.setMode('none');
      this.overview = true;
      return;
    }
    if (this.overview) {
      this.overview = false;
      this.sessionPressedAt = -Infinity;
      return;
    }
    if (id === 'x') {
      // the first click of the double already changed mode: the second puts it back, as in Live
      this.mixer = !this.mixer;
      if (!this.mixer) this.setMode('none');
    }
    if (double) {
      if (this.faders) this.setMode('none');
      this.overview = true;
    }
  }

  /** MK2: Mixer opens the mixer on the grid; pressed again, it goes back to Session. */
  private mk2Mixer(): void {
    this.overview = false;
    this.mixer = !this.mixer || FADER_MODES.includes(this.mode);
    this.setMode('none');
  }

  /** Pro MK3: the mode buttons under the grid (with Shift: undo, redo, metronome, tap
   *  tempo, as in Live). True if the button handled it. */
  private proMode(b: Button): boolean {
    if (this.shift) {
      switch (b) {
        case 'arm': this.host.store.undo(); return true;
        case 'mute': this.host.store.redo(); return true;
        case 'solo': this.host.toggleMetronome(); return true;
        case 'sends': this.tap(); return true;
      }
      return false;
    }
    const mode: Partial<Record<Button, Mode>> = { mute: 'mute', solo: 'solo', stopClip: 'stop', volume: 'volume', pan: 'pan', device: 'device' };
    const m = mode[b];
    if (!m) return false;
    this.setMode(this.mode === m ? 'none' : m);
    if (m === 'device' && this.mode === 'device') this.announce();
    return true;
  }

  // ---------------------------------------------------------------- modes and layout

  private get faders(): boolean {
    return FADER_MODES.includes(this.mode);
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    if (this.faders) this.overview = false;
    this.applyLayout();
  }

  /** Sends the controller the layout needed (Session or a fader page), if it changed. */
  private applyLayout(): void {
    if (!this.ready) return;
    const want: Layout = this.faders ? (this.mode as Layout) : 'session';
    if (this.layout === want) return;
    this.layout = want;
    // changing layout the controller redraws everything: what's needed is resent
    this.sent.clear();
    const { model } = this;
    if (want !== 'session' && model.id !== 'mk2') this.out(faderSetup(model, FADER_PAGE[want], this.faderLook(want)));
    this.out(layoutMessage(model, want));
    if (want !== 'session' && model.id === 'mk2') {
      // the MK2 takes each fader's colour and position together, after the layout
      const look = this.faderLook(want), values = this.faderValues(want);
      for (let i = 0; i < SIZE; i++) {
        this.out(mk2Fader(i, want === 'pan', look.colors[i], values[i] ?? 0));
        if (values[i] !== undefined) this.sent.set(ccKey(faderCc(model, 0, i)), values[i]!);
      }
    }
  }

  /** What the faders look like: volume green and vertical, pan horizontal from the centre in the
   *  track's colour, parameters blue (as in Live); off where there's nothing to move. */
  private faderLook(layout: Layout): { horizontal: boolean; bipolar: boolean; colors: number[] } {
    const tracks = this.ringTracks();
    if (layout === 'device') {
      const dev = this.controlled();
      return { horizontal: false, bipolar: false, colors: tracks.map((_, i) => (dev?.params[i] ? COLOR.darkBlue : COLOR.off)) };
    }
    const pan = layout === 'pan';
    const color = (t: Track | undefined) => {
      if (!t) return COLOR.off;
      return pan ? paletteIndex(t.color) : COLOR.green;
    };
    return { horizontal: pan, bipolar: pan, colors: tracks.map(color) };
  }

  /** A grid pad: the overview's blocks, a track function on its row, otherwise the clip slot. */
  private gridColor(fn: TrackMode | 'volumeReset' | 'panReset' | 'none' | null, col: number, row: number, track: Track | undefined): number {
    if (this.overview) return blockColor(this.blockLight(col, row));
    if (fn) return functionColor(fn, track, this.host.ui.track, this.stopLight(track));
    return padColor(this.slotLight(track, this.ring.scene + row));
  }

  /** The Session button's colour when active (inactive it's always half white). */
  private sessionButtonColor(): number {
    if (this.overview) return COLOR.blue;
    return this.mixer ? COLOR.cream : COLOR.paleGreenHalf;
  }

  /** The position of each fader (undefined where there's nothing to move). */
  private faderValues(layout: Layout): (number | undefined)[] {
    if (layout === 'device') {
      const dev = this.controlled();
      return Array.from({ length: SIZE }, (_, i) => {
        const spec = dev?.params[i];
        return dev && spec ? Math.round(this.heardUnit(dev, spec) * 127) : undefined;
      });
    }
    return this.ringTracks().map(t => {
      if (!t) return undefined;
      return layout === 'pan' ? panToKnob(t.mixer.pan) : dbToFader(t.mixer.volumeDb);
    });
  }

  // ---------------------------------------------------------------- fader

  private isFader(cc: number, channel: number): boolean {
    if (!this.faders) return false;
    const { model } = this;
    const page = model.id === 'pro' ? FADER_PAGE[this.mode as Layout] : 0;
    const first = faderCc(model, page, 0);
    return channel === (model.id === 'mk2' ? 0 : FADER_CHANNEL) && cc >= first && cc < first + SIZE;
  }

  private fader(cc: number, value: number): void {
    const { model } = this;
    const page = model.id === 'pro' ? FADER_PAGE[this.mode as Layout] : 0;
    const i = cc - faderCc(model, page, 0);
    this.touch(ccKey(cc, model.id === 'mk2' ? 0 : FADER_CHANNEL), value);
    if (this.mode === 'device') return this.turnParam(i, value / 127);
    const track = this.trackAt(i);
    if (!track) return;
    if (this.mode === 'volume') this.later(`vol-${track.id}`, () => this.move(setMixer(track.id, { volumeDb: faderToDb(value) }), `lp-vol-${track.id}`));
    else this.later(`pan-${track.id}`, () => this.move(setMixer(track.id, { pan: knobToPan(value) }), `lp-pan-${track.id}`));
  }

  // ---------------------------------------------------------------- LED

  protected ledMessages(status: number, number: number, value: number): number[][] {
    return ledMessages(status, number, value);
  }

  /** The Session button of X and Mini MK3 has its two colours, sent with a SysEx. */
  protected override send(key: string, value: number): void {
    if (key !== SESSION_KEY) return super.send(key, value);
    this.out(sessionColor(this.model, value >> 7, value & 0x7f));
    this.sent.set(key, value);
  }

  protected leds(): Map<string, number> {
    const { model } = this;
    const leds = new Map<string, number>();
    const tracks = this.ringTracks();
    const button = (b: Button, color: number) => {
      const n = model.buttons[b];
      if (n !== undefined) leds.set(ccKey(n), color);
    };
    const sceneKey = (row: number) => (model.sceneKind === 'cc' ? ccKey(sceneButton(row)) : noteKey(sceneButton(row)));

    // the grid: the controller draws the faders, the rest is lit from here
    if (this.faders) {
      const values = this.faderValues(this.mode as Layout), look = this.faderLook(this.mode as Layout);
      const page = model.id === 'pro' ? FADER_PAGE[this.mode as Layout] : 0;
      for (let i = 0; i < SIZE; i++) {
        const cc = faderCc(model, page, i);
        if (model.id === 'mk2') {
          if (values[i] !== undefined) leds.set(ccKey(cc), values[i]!);
          continue;
        }
        leds.set(ccKey(cc, FADER_CHANNEL), values[i] ?? 0);
        leds.set(ccKey(cc, FADER_COLOR_CHANNEL), look.colors[i]);
      }
    } else {
      for (let row = 0; row < SIZE; row++) {
        const fn = this.overview ? null : this.gridFunction(row);
        for (let col = 0; col < SIZE; col++) {
          leds.set(noteKey(padNote(col, row)), this.gridColor(fn, col, row, tracks[col]));
        }
      }
    }

    // the right column
    for (let row = 0; row < SIZE; row++) leds.set(sceneKey(row), this.sceneColor(row));

    // navigation
    const nav = (b: 'up' | 'down' | 'left' | 'right') => button(b, this.overview || this.canMove(b) ? COLOR.whiteHalf : COLOR.off);
    if (model.id === 'pro' && this.mode === 'device') {
      const dev = this.controlled();
      button('up', COLOR.off);
      button('down', COLOR.off);
      button('left', dev && dev.index > 0 ? COLOR.darkBlueHalf : COLOR.off);
      button('right', dev && dev.index < dev.chain.length - 1 ? COLOR.darkBlueHalf : COLOR.off);
    } else {
      nav('up'); nav('down'); nav('left'); nav('right');
    }

    // the Session button: X and Mini with the SysEx, the others with their LED
    if (model.id === 'x' || model.id === 'mini') {
      leds.set(SESSION_KEY, this.sessionButtonColor() * 128 + COLOR.whiteHalf);
    } else if (model.id === 'mk2') {
      button('session', this.mixer ? COLOR.whiteHalf : COLOR.paleGreenHalf);
      button('mixer', this.mixer ? COLOR.cream : COLOR.whiteHalf);
      button('user1', COLOR.off);
      button('user2', COLOR.off);
    }

    if (model.id === 'x') button('captureMidi', COLOR.off);
    if (model.id === 'pro') this.proLeds(leds, button, tracks);

    // the blue hand: only the Pro MK3, with the device parameters on the faders
    const dev = model.id === 'pro' && this.mode === 'device' ? this.controlled() : null;
    this.host.ui.setControlledDevice(dev ? { owner: dev.owner, device: dev.device.key } : null);
    return leds;
  }

  /** A button of the right column. */
  private sceneColor(row: number): number {
    const { id } = this.model;
    if (this.overview) return COLOR.off;
    if (id === 'mini' && row === SIZE - 1) return this.mode === 'none' ? COLOR.whiteHalf : MODE_COLOR[this.mode as Exclude<Mode, 'none'>];
    if (id === 'pro' && this.mode === 'device') {
      const dev = this.controlled();
      if (!dev || row >= dev.banks) return COLOR.off;
      return row === dev.bank ? COLOR.darkBlue : COLOR.whiteHalf;
    }
    if ((id === 'x' || id === 'mk2') && this.mixer) {
      const choice = MIXER_COLUMN[row];
      if (id === 'mk2' && row >= 4) {
        const p = this.project, playing = p.tracks.some(t => this.host.engine.sessionState(t).playing);
        if (choice === 'stop') return playing ? COLOR.red : COLOR.redHalf;
        if (choice === 'mute') return p.tracks.some(t => t.mixer.mute) ? COLOR.yellow : COLOR.yellowHalf;
        if (choice === 'solo') return p.tracks.some(t => t.mixer.solo) ? COLOR.blue : COLOR.blueHalf;
      }
      if (choice === 'sendA' || choice === 'sendB' || choice === 'arm') return COLOR.off;
      return this.mode === choice ? MODE_COLOR[choice as Exclude<Mode, 'none'>] : COLOR.whiteHalf;
    }
    const s = this.sceneLight(row);
    switch (s) {
      case 'queued': return blink(COLOR.green);
      case 'playing': return pulse(COLOR.green);
      case 'off': return COLOR.off;
      default: return s.color ? paletteIndex(s.color) : COLOR.green;
    }
  }

  /** Pro MK3: the track row, the modes, the transport. */
  private proLeds(leds: Map<string, number>, button: (b: Button, color: number) => void, tracks: (Track | undefined)[]): void {
    const fn: TrackMode = isTrackMode(this.mode) ? this.mode : 'select';
    tracks.forEach((t, c) => leds.set(ccKey(TRACK_BUTTONS + c), functionColor(fn, t, this.host.ui.track, this.stopLight(t))));
    const lit = (m: Exclude<Mode, 'none'>) => (this.mode === m ? MODE_COLOR[m] : COLOR.whiteHalf);
    button('arm', COLOR.off);
    button('mute', lit('mute'));
    button('solo', lit('solo'));
    button('volume', lit('volume'));
    button('pan', lit('pan'));
    button('sends', COLOR.off);
    button('device', lit('device'));
    button('stopClip', lit('stop'));
    button('shift', COLOR.whiteHalf);
    button('play', this.host.engine.playing ? COLOR.green : COLOR.whiteHalf);
    for (const b of ['record', 'clear', 'duplicate', 'quantize', 'fixedLength'] as const) button(b, COLOR.off);
  }

  /** The state of the modes, for messages and the report. */
  get state(): string {
    return [this.overview && 'block map', this.mixer && 'mixer', this.mode !== 'none' && this.mode, this.foreign && 'controller layout']
      .filter(Boolean).join(', ') || 'session';
  }
}

const SESSION_KEY = 's:session';

/** A track's stop pad: blinking with the stop queued, lit while it plays. */
const STOP_COLOR: Readonly<Record<'off' | 'playing' | 'queued', number>> = {
  queued: blink(COLOR.red),
  playing: COLOR.red,
  off: COLOR.redHalf,
};

const isTrackMode = (m: Mode): m is 'stop' | 'mute' | 'solo' => m === 'stop' || m === 'mute' || m === 'solo';

/** A slot's pad, as in Live on the Launchpads: the playing clip pulses green, the queued one
 *  blinks green, the others have their colour, empty slots are off. */
function padColor(light: SlotLight): number {
  if (light === 'queued') return blink(COLOR.green);
  if (light === 'playing') return pulse(COLOR.green);
  return light === 'off' ? COLOR.off : paletteIndex(light.clip);
}

/** The block map, as in Live: the box white, pulsing green if something plays,
 *  light blue if there are clips, off if it's empty. */
function blockColor(light: BlockLight): number {
  switch (light) {
    case 'off': case 'empty': return COLOR.off;
    case 'ring': return COLOR.offWhite;
    case 'playing': return pulse(COLOR.green);
    case 'clips': return COLOR.lightBlueHalf;
  }
}

/** A track's button in a function, with Live's colours: stop red (blinks if the stop
 *  is queued, dim if it's stopped), mute yellow lit if the track plays, solo blue, select white. */
function functionColor(fn: TrackMode | 'volumeReset' | 'panReset' | 'none', t: Track | undefined, selected: string | null, stop: 'off' | 'playing' | 'queued'): number {
  if (!t) return COLOR.off;
  switch (fn) {
    case 'select': return t.id === selected ? COLOR.white : COLOR.whiteHalf;
    case 'stop': return STOP_COLOR[stop];
    case 'mute': return t.mixer.mute ? COLOR.yellowHalf : COLOR.yellow;
    case 'solo': return t.mixer.solo ? COLOR.blue : COLOR.blueHalf;
    case 'volumeReset': return COLOR.greenHalf;
    case 'panReset': return COLOR.orangeHalf;
    case 'none': return COLOR.off;
  }
}
