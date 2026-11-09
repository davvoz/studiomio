/* The APC40 mkII on the session, as in Live: the 8×5 grid launches the clips of the red box
 * (the arrows move it), the scene buttons launch the rows, below are stop, select,
 * mute (activator) and solo of each track, the faders and the master; the top knobs do pan,
 * the 8 "Device Control" knobs move the parameters of the chosen device (the "blue hand"),
 * in banks of 8. The LEDs are decided by the program, every round: clip colour, green for the one
 * playing, blinking for the queued one (the controller does it); only what changes is sent.
 * The controller doesn't know Web MIDI: it receives messages with `receive` and sends with `out`. */
import { type ParamSpec } from '../../devices/params';
import type { DeviceId, TrackId } from '../../core/id';
import { MASTER } from '../../model/project';
import { slotRef, type ClipRef } from '../../store/clip-ref';
import { setEffectEnabled, setMasterMixer, setMixer } from '../../store/edits';
import {
  bipolar, ccKey, noteKey, PARAMS_PER_BANK, SessionSurface, SETTLE_MS, type BlockLight, type SceneLight, type SlotLight,
} from '../session-surface';
import {
  CC, COLOR, dongleChallenge, faderToDb, IDENTITY_REQUEST, identityDeviceId, introduction, isDongleResponse, knobToPan, ledMessages,
  MODE, NOTE, ON, padAt, padNote, paletteIndex, panToKnob, relative, RING, SCENES, STOP_LED, TRACKS, TRIGGERED,
} from './protocol';

export { INSTRUMENT_KEY, type DetailView, type SurfaceEngine, type SurfaceHost } from '../session-surface';

/** At most this many messages per round: the APC40 mkII processes MIDI slowly, in bursts it
 *  hangs. What's left goes in the next round. */
const MAX_SEND = 32;
/** How long each startup reply (identity, challenge) is awaited before going on anyway. */
const HANDSHAKE_MS = 1000;
/** Live sends the challenge two of its rounds (100 ms) after the introduction. */
const CHALLENGE_DELAY_MS = 200;
/** After how long the Device knob rings are resent to a newly chosen device: the
 *  controller may lose the ones sent right away (they go dark until the value changes). */
const RINGS_AGAIN_MS = 250;

/** The startup, as in Live: ask for the identity, introduce ourselves, do the challenge, then work. */
type Phase = 'identity' | 'challenge' | 'ready';

const NOT_YET: Readonly<Record<number, string>> = {
  [NOTE.recordArm]: 'Record arm', [NOTE.record]: 'Recording', [NOTE.session]: 'Session recording',
  [NOTE.crossfadeAssign]: 'Il crossfader', [NOTE.sends]: 'The sends', [NOTE.user]: 'The User mode',
  [NOTE.nudgeMinus]: 'The nudge', [NOTE.nudgePlus]: 'The nudge',
};

export class Apc40 extends SessionSurface {
  protected readonly label = 'APC40';
  protected readonly mergePrefix = 'apc';
  protected readonly width = TRACKS;
  protected readonly height = SCENES;
  protected readonly maxSend = MAX_SEND;
  private tempoSteps = 0;
  private bankMode = false;
  /** Off: nothing is sent to the knobs (neither values nor ring type). To find out whether
   *  a controller hangs because of the knob messages. */
  knobFeedback = true;
  private phase: Phase = 'identity';
  private phaseAt = 0;
  private challengeSent = false;
  /** The controller's device ID, from its identity reply (Live does the same). */
  private device = 0;
  /** The Device knobs' device (and bank) last time, and when to resend its rings. */
  private ringsOf = '';
  private ringsAgainAt = Infinity;

  /** The controller has just been connected: it's asked who it is (see `handshake`). */
  start(): void {
    this.stopped = false;
    this.sent.clear();
    this.touched.clear();
    this.ringsOf = '';
    this.phase = 'identity';
    this.phaseAt = this.now();
    this.out([...IDENTITY_REQUEST]);
  }

  get ready(): boolean {
    return this.phase === 'ready';
  }

  /** Advances the startup: introduction (Ableton mode) with the obtained device ID, challenge, then the LEDs. If
   *  a reply doesn't arrive it goes on anyway. */
  protected handshake(data: ArrayLike<number> | null): void {
    const now = this.now();
    if (this.phase === 'identity') {
      const id = data ? identityDeviceId(data) : null;
      if (id === null && now - this.phaseAt < HANDSHAKE_MS) return;
      this.device = id ?? 0;
      this.out(introduction(MODE.ableton, this.device));
      this.phase = 'challenge';
      this.phaseAt = now;
      this.challengeSent = false;
      return;
    }
    if (this.phase !== 'challenge') return;
    if (!this.challengeSent) {
      if (now - this.phaseAt < CHALLENGE_DELAY_MS) return;
      const random = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo));
      this.out(dongleChallenge(this.device, random(0, 2_000_000), random(2_000_001, 4_000_000)));
      this.challengeSent = true;
      this.phaseAt = now;
      return;
    }
    if (!(data && isDongleResponse(data)) && now - this.phaseAt < HANDSHAKE_MS) return;
    this.phase = 'ready';
    this.settleUntil = now + SETTLE_MS;
    const ring = this.host.ui.sessionRing;
    this.setRing(ring?.track ?? 0, ring?.scene ?? 0);
    this.refresh();
  }

  /** The controller goes away (or the app closes): LEDs off and back to generic mode. */
  stop(): void {
    this.stopped = true;
    this.darken();
    this.out(introduction(MODE.generic, this.device));
  }

  protected input(kind: number, channel: number, number: number, value: number): boolean {
    if (kind === 0x90 && value > 0) this.press(number, channel);
    else if (kind === 0x80 || kind === 0x90) this.release(number);
    else if (kind === 0xb0) this.control(number, channel, value);
    return kind !== 0x80 && kind !== 0x90;
  }

  // ---------------------------------------------------------------- buttons

  private press(note: number, channel: number): void {
    const { engine } = this.host;
    const pad = padAt(note);
    if (pad) return this.shift ? this.jumpToBlock(pad.col, pad.row) : this.launchPad(pad.col, pad.row);
    if (note >= NOTE.sceneLaunch && note < NOTE.sceneLaunch + SCENES) return this.launchScene(note - NOTE.sceneLaunch);
    const track = this.trackAt(channel);
    switch (note) {
      case NOTE.clipStop: if (track) engine.stopTrack(track.id); return;
      case NOTE.trackSelect: if (track) this.selectOwner(track.id); return;
      case NOTE.activator: if (track) this.apply(setMixer(track.id, { mute: !track.mixer.mute })); return;
      case NOTE.solo: if (track) this.apply(setMixer(track.id, { solo: !track.mixer.solo })); return;
      case NOTE.master: return this.selectOwner(MASTER);
      case NOTE.stopAllClips: return engine.stopAllClips();
      case NOTE.shift: this.shift = true; return;
      case NOTE.bank: this.bankMode = !this.bankMode; return;
      case NOTE.up: return this.moveRing(0, -this.step(SCENES));
      case NOTE.down: return this.moveRing(0, this.step(SCENES));
      case NOTE.left: return this.moveRing(-this.step(TRACKS), 0);
      case NOTE.right: return this.moveRing(this.step(TRACKS), 0);
      case NOTE.play: return this.shift ? this.host.stopAndRewind() : this.host.togglePlay();
      case NOTE.metronome: return this.host.toggleMetronome();
      case NOTE.tapTempo: return this.tap();
      case NOTE.pan: return;
      case NOTE.deviceLeft: return this.moveDevice(-1);
      case NOTE.deviceRight: return this.moveDevice(1);
      case NOTE.bankLeft: return this.moveBank(-1);
      case NOTE.bankRight: return this.moveBank(1);
      case NOTE.deviceOnOff: return this.toggleDevice();
      case NOTE.deviceLock: return this.toggleLock();
      case NOTE.clipDeviceView: return this.toggleClipDevice();
      case NOTE.detailView: return this.toggleDetail();
    }
    const missing = NOT_YET[note];
    if (missing) this.host.say(`APC40: ${missing} isn't in studiomio yet.`);
  }

  private release(note: number): void {
    if (note === NOTE.shift) this.shift = false;
    // once a track (or the master) is chosen, the rings are resent also after release
    if (note === NOTE.trackSelect || note === NOTE.master) this.ringsAgainAt = this.now() + RINGS_AGAIN_MS;
  }

  /** With Shift (or with Bank on) the arrows move the box by a whole page. */
  private step(page: number): number {
    return this.shift || this.bankMode ? page : 1;
  }

  // ---------------------------------------------------------------- devices

  private moveBank(delta: number): void {
    const c = this.controlled();
    if (c) this.setBank(c.bank + delta);
  }

  private toggleDevice(): void {
    const c = this.controlled();
    if (c?.device.enabled === null || !c) return;
    this.apply(setEffectEnabled(c.owner, c.device.key as DeviceId, !c.device.enabled));
  }

  private toggleLock(): void {
    const c = this.controlled();
    this.locked = this.locked || !c ? null : { owner: c.owner, device: c.device.key };
    if (c) this.host.say(this.locked ? `APC40: knobs locked on ${c.device.type.label}.` : 'APC40: the knobs follow the chosen track.');
  }

  /** Clip/Device View: from the devices to the chosen track's clip, and vice versa. */
  private toggleClipDevice(): void {
    const owner = this.selectedOwner;
    if (!owner) return;
    if (this.host.detail !== 'devices' || owner === MASTER) return this.host.openDevices(owner);
    const ref = this.clipToShow(owner);
    if (ref) this.host.openClip(ref);
    else this.host.say('APC40: the track has no clips in the session.');
  }

  /** Detail View: shows or hides the bottom area. */
  private toggleDetail(): void {
    if (this.host.detail) return this.host.closeDetail();
    const owner = this.selectedOwner ?? this.project.tracks[0]?.id;
    if (owner) this.host.openDevices(owner);
  }

  /** The clip to open: the playing one, or the first in the box, or the track's first. */
  private clipToShow(id: TrackId): ClipRef | null {
    const track = this.project.track(id);
    if (!track) return null;
    const playing = this.host.engine.sessionState(track).playing;
    const r = this.ring;
    const inRing = track.slots.findIndex((c, s) => c && s >= r.scene && s < r.scene + SCENES);
    const slot = playing?.slot ?? (inRing >= 0 ? inRing : track.slots.findIndex(c => c));
    const clip = slot >= 0 ? track.slots[slot] : null;
    return clip ? slotRef(id, clip.id) : null;
  }

  // ---------------------------------------------------------------- continuous controls

  private control(cc: number, channel: number, value: number): void {
    if (cc === CC.tempo) {
      this.tempoSteps += relative(value) * (this.shift ? 0.1 : 1);
      this.later('tempo', () => {
        const steps = this.tempoSteps;
        this.tempoSteps = 0;
        if (steps) this.setBpm(this.project.tempo.bpm + steps, 'apc-tempo');
      });
      return;
    }
    if (this.now() < this.settleUntil) return;
    if (cc === CC.trackFader) {
      const track = this.trackAt(channel);
      if (track) this.later(`vol-${track.id}`, () => this.move(setMixer(track.id, { volumeDb: faderToDb(value) }), `apc-vol-${track.id}`));
    } else if (cc === CC.masterFader) {
      this.later('master', () => this.move(setMasterMixer({ volumeDb: faderToDb(value) }), 'apc-master'));
    } else if (cc >= CC.trackKnob && cc < CC.trackKnob + TRACKS) {
      const track = this.trackAt(cc - CC.trackKnob);
      this.touch(ccKey(cc), value);
      if (track) this.later(`pan-${track.id}`, () => this.move(setMixer(track.id, { pan: knobToPan(value) }), `apc-pan-${track.id}`));
    } else if (cc >= CC.deviceKnob && cc < CC.deviceKnob + PARAMS_PER_BANK) {
      this.touch(ccKey(cc), value);
      this.turnParam(cc - CC.deviceKnob, value / 127);
    }
    // crossfader and cue level: studiomio doesn't have them yet
  }

  // ---------------------------------------------------------------- LED

  protected override muted(key: string): boolean {
    return !this.knobFeedback && key.startsWith('c:');
  }

  protected ledMessages(status: number, number: number, value: number): number[][] {
    return ledMessages(status, number, value);
  }

  protected leds(): Map<string, number> {
    const { ui, engine } = this.host;
    const p = this.project;
    const ring = this.ring;
    const leds = new Map<string, number>();
    // on = 127 as in Live; the blinking is done by the controller (no timed traffic from here)
    const note = (n: number, v: number | boolean, channel = 0) => leds.set(noteKey(n, channel), ledValue(v));
    const tracks = this.ringTracks();

    // the grid
    for (let row = 0; row < SCENES; row++) {
      for (let col = 0; col < TRACKS; col++) {
        note(padNote(col, row), this.shift ? overviewColor(this.blockLight(col, row)) : padColor(this.slotLight(tracks[col], ring.scene + row)));
      }
    }
    // scenes (RGB buttons): steady green if one of their clips plays (like the clips), blinking if
    // something in the row is queued; otherwise the scene's colour (white if it has none), off
    // if the row is empty
    for (let i = 0; i < SCENES; i++) {
      note(NOTE.sceneLaunch + i, sceneColor(this.sceneLight(i)));
    }
    // per track
    tracks.forEach((t, c) => {
      const stop = this.stopLight(t);
      note(NOTE.clipStop, STOP_LED_OF[stop], c);
      note(NOTE.trackSelect, !!t && !this.masterSelected && t.id === ui.track, c);
      note(NOTE.activator, !!t && !t.mixer.mute, c);
      note(NOTE.solo, !!t?.mixer.solo, c);
      note(NOTE.recordArm, false, c);
      note(NOTE.crossfadeAssign, 0, c);
    });
    note(NOTE.master, this.masterSelected);
    note(NOTE.stopAllClips, p.tracks.some(t => engine.sessionState(t).playing));
    // transport and navigation
    note(NOTE.play, engine.playing);
    note(NOTE.metronome, engine.metronomeOn);
    note(NOTE.record, false);
    note(NOTE.session, false);
    note(NOTE.up, this.canMove('up'));
    note(NOTE.down, this.canMove('down'));
    note(NOTE.left, this.canMove('left'));
    note(NOTE.right, this.canMove('right'));
    note(NOTE.bank, this.bankMode);
    note(NOTE.pan, true);
    note(NOTE.sends, false);
    note(NOTE.user, false);
    // knobs above the tracks: the pan
    tracks.forEach((t, c) => {
      leds.set(ccKey(CC.trackRing + c), t ? RING.pan : RING.off);
      leds.set(ccKey(CC.trackKnob + c), t ? panToKnob(t.mixer.pan) : 0);
    });
    // the controlled device
    const dev = this.controlled();
    ui.setControlledDevice(dev ? { owner: dev.owner, device: dev.device.key } : null);
    this.ringsAgain(dev ? `${dev.owner}/${dev.device.key}/${dev.bank}` : '');
    for (let i = 0; i < PARAMS_PER_BANK; i++) {
      const spec = dev?.params[i];
      leds.set(ccKey(CC.deviceRing + i), ringStyle(spec));
      leds.set(ccKey(CC.deviceKnob + i), dev && spec ? Math.round(this.heardUnit(dev, spec) * 127) : 0);
    }
    note(NOTE.deviceLeft, !!dev && dev.index > 0);
    note(NOTE.deviceRight, !!dev && dev.index < dev.chain.length - 1);
    note(NOTE.bankLeft, !!dev && dev.bank > 0);
    note(NOTE.bankRight, !!dev && dev.bank < dev.banks - 1);
    note(NOTE.deviceOnOff, !!dev && dev.device.enabled !== false);
    note(NOTE.deviceLock, this.locked !== null);
    note(NOTE.clipDeviceView, this.host.detail === 'devices');
    note(NOTE.detailView, this.host.detail !== null);
    return leds;
  }

  /** When the knobs' device changes (`shown`), shortly after all its rings (type and value) are
   *  resent, even those that didn't change: the APC40 may have lost the first ones, and a
   *  lost ring would stay dark until its value changes. */
  private ringsAgain(shown: string): void {
    if (shown !== this.ringsOf) {
      this.ringsOf = shown;
      this.ringsAgainAt = this.now() + RINGS_AGAIN_MS;
    } else if (this.now() >= this.ringsAgainAt) {
      this.ringsAgainAt = Infinity;
      for (let i = 0; i < PARAMS_PER_BANK; i++) {
        this.sent.delete(ccKey(CC.deviceRing + i));
        this.sent.delete(ccKey(CC.deviceKnob + i));
      }
    }
  }
}

/** A slot's pad, as in Live: the playing one is steady green, the queued one blinks
 *  green, the other clips have their colour, empty slots are off. */
function padColor(light: SlotLight): number {
  if (light === 'queued') return TRIGGERED(COLOR.green);
  if (light === 'playing') return COLOR.green;
  return light === 'off' ? COLOR.off : paletteIndex(light.clip);
}

/** Shift held: the block map. White where the box is, green if something plays,
 *  amber if there are clips, dimly lit if it's empty. */
function overviewColor(light: BlockLight): number {
  switch (light) {
    case 'off': return COLOR.off;
    case 'ring': return COLOR.white;
    case 'playing': return COLOR.green;
    case 'clips': return COLOR.amber;
    case 'empty': return COLOR.dim;
  }
}

/** A LED's value: a boolean is on or off, a number is already the colour or the state. */
function ledValue(v: number | boolean): number {
  if (typeof v === 'number') return v;
  return v ? ON : 0;
}

/** A scene button: blinking if queued, green if playing, otherwise the scene's colour (white if
 *  it has none), off if the row is empty. */
function sceneColor(s: SceneLight): number {
  switch (s) {
    case 'queued': return TRIGGERED(COLOR.green);
    case 'playing': return COLOR.green;
    case 'off': return COLOR.off;
    default: return s.color ? paletteIndex(s.color) : COLOR.white;
  }
}

/** A clip stop button: blinking with the stop queued, lit while the track plays. */
const STOP_LED_OF: Readonly<Record<'off' | 'playing' | 'queued', number>> = {
  queued: STOP_LED.blink,
  playing: STOP_LED.on,
  off: STOP_LED.off,
};

/** The LED ring around a device knob: centred for bipolar parameters, off with nothing mapped. */
function ringStyle(spec: ParamSpec | undefined): number {
  if (!spec) return RING.off;
  return bipolar(spec) ? RING.pan : RING.volume;
}
