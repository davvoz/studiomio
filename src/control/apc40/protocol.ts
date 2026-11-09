/* The Akai APC40 mkII protocol in "Ableton Live mode" (APC40 mkII Communications
 * Protocol): notes and controls of each element, the SysEx message that turns that mode on and the
 * RGB pad palette. In Ableton mode the buttons are momentary and the LEDs are driven by the
 * program: it decides what lights up, as Live does. Here there's only data and pure maths. */

/** The button notes (Note On on press, Note Off on release). The per-track ones
 *  arrive on the track's channel (0..7); the others on channel 0. */
export const NOTE = {
  /** 8×5 grid: 0x00..0x27, from the bottom row (0..7) to the top one (32..39). */
  clipGrid: 0x00,
  recordArm: 0x30,
  solo: 0x31,
  /** The button with the track number: on = the track plays (isn't muted). */
  activator: 0x32,
  trackSelect: 0x33,
  clipStop: 0x34,
  deviceLeft: 0x3a,
  deviceRight: 0x3b,
  bankLeft: 0x3c,
  bankRight: 0x3d,
  deviceOnOff: 0x3e,
  deviceLock: 0x3f,
  clipDeviceView: 0x40,
  detailView: 0x41,
  crossfadeAssign: 0x42,
  master: 0x50,
  stopAllClips: 0x51,
  /** Scene launch: 0x52..0x56, top to bottom. */
  sceneLaunch: 0x52,
  pan: 0x57,
  sends: 0x58,
  user: 0x59,
  metronome: 0x5a,
  play: 0x5b,
  record: 0x5d,
  up: 0x5e,
  down: 0x5f,
  right: 0x60,
  left: 0x61,
  shift: 0x62,
  tapTempo: 0x63,
  nudgeMinus: 0x64,
  nudgePlus: 0x65,
  session: 0x66,
  bank: 0x67,
} as const;

/** The continuous controls (Control Change). */
export const CC = {
  /** Track faders, on the track's channel. */
  trackFader: 0x07,
  /** Tempo encoder, relative. */
  tempo: 0x0d,
  masterFader: 0x0e,
  crossfader: 0x0f,
  /** The 8 "Device Control" knobs: value 0x10..0x17, LED ring type 0x18..0x1f. */
  deviceKnob: 0x10,
  deviceRing: 0x18,
  /** Cue level encoder, relative. */
  cueLevel: 0x2f,
  /** The 8 knobs above the tracks: value 0x30..0x37, ring type 0x38..0x3f. */
  trackKnob: 0x30,
  trackRing: 0x38,
} as const;

/** How a knob's LED ring lights up. */
export const RING = { off: 0, single: 1, volume: 2, pan: 3 } as const;

export const TRACKS = 8;
export const SCENES = 5;

/** Recognizing the controller from its MIDI port name ("APC40 mkII", "2- APC40 mkII"…). */
export const PORT_NAME = /apc\s*40\s*mk\s*(ii|2)/i;

const AKAI = 0x47;
const APC40_MK2 = 0x29;

/** Controller modes: generic (it handles the LEDs itself) or Ableton Live (the program handles them). */
export const MODE = { generic: 0x40, ableton: 0x41, alternateAbleton: 0x42 } as const;

// The startup as Live does it (script _APC/APC.py): identity request; from the reply the device
// ID; introduction with that device ID; then the "dongle challenge" and, on its reply, the LEDs.

/** The identity request, as Live sends it. */
export const IDENTITY_REQUEST: readonly number[] = [0xf0, 0x7e, 0x00, 0x06, 0x01, 0xf7];

/** The device ID from an APC40 mkII's identity reply (F0 7E <id> 06 02 47 29 …), or null
 *  if the message isn't one. Live takes it from byte 13. */
export function identityDeviceId(data: ArrayLike<number>): number | null {
  if (data.length < 14 || data[0] !== 0xf0 || data[1] !== 0x7e || data[3] !== 0x06 || data[4] !== 0x02) return null;
  return data[5] === AKAI && data[6] === APC40_MK2 ? data[13] : null;
}

/** The version we introduce ourselves with: Live 11's, as the script does. */
const HOST_VERSION = [11, 0, 0] as const;

/** The introduction message: puts the controller in the given mode. */
export const introduction = (mode: number = MODE.ableton, device = 0): number[] =>
  [0xf0, AKAI, device, APC40_MK2, 0x60, 0x00, 0x04, mode, ...HOST_VERSION, 0xf7];

/** The "dongle challenge" Live sends after the introduction: two numbers, 8 nibbles each.
 *  Live checks the reply with its own algorithm; for us it's enough that the exchange happens. */
export function dongleChallenge(device: number, a: number, b: number): number[] {
  const nibbles = (n: number) => Array.from({ length: 8 }, (_, i) => (n >> (4 * (7 - i))) & 0x0f);
  return [0xf0, AKAI, device, APC40_MK2, 0x50, 0x00, 0x10, ...nibbles(a), ...nibbles(b), 0xf7];
}

/** True if it's the controller's reply to the challenge (… 51 00 10 …). */
export const isDongleResponse = (data: ArrayLike<number>): boolean =>
  data.length >= 7 && data[0] === 0xf0 && data[1] === AKAI && data[3] === APC40_MK2 && data[4] === 0x51;

/** Single-colour buttons (select, solo, activator, transport…): on is 127, as in Live. */
export const ON = 127;
/** Track stops have their own scale: 1 on, 2 blinking (the controller does it). */
export const STOP_LED = { off: 0, on: 1, blink: 2 } as const;

/** Note of the pad in column `col` (0 = left) and row `row` (0 = top). */
export const padNote = (col: number, row: number): number => NOTE.clipGrid + (SCENES - 1 - row) * TRACKS + col;

/** Column and row (0 = top) of a grid note, or null. */
export function padAt(note: number): { col: number; row: number } | null {
  const i = note - NOTE.clipGrid;
  if (i < 0 || i >= TRACKS * SCENES) return null;
  return { col: i % TRACKS, row: SCENES - 1 - Math.floor(i / TRACKS) };
}

/** A relative encoder: 1..63 forward, 65..127 backward (two's complement on 7 bits). */
export const relative = (value: number): number => (value < 64 ? value : value - 128);

// ------------------------------------------------------------------ faders, pan and colours

// the fader curve and the palette are the same as the Launchpads'
export { dbToFader, faderToDb, knobToPan, panToKnob, SILENT_DB } from '../mixer-scale';
export { PALETTE, paletteIndex } from '../palette';

/** The fixed colours, like those Live uses on the APC40 mkII. */
export const COLOR = {
  off: 0,
  dim: 1,
  white: 3,
  red: 5,
  amber: 9,
  green: 21,
} as const;

/** How an RGB pad animates, as Live does (pushbase/colors.py): the first colour on channel 0, the
 *  second on the animation's channel, and the controller does the alternating (by hand it gets choked
 *  until it hangs). Channels 6..10 pulse, 11..15 blink, for speeds 4, 6, 12, 24, 48. */
export const ANIMATION = { pulse: 6, blink: 11 } as const;
const SPEEDS = [4, 6, 12, 24, 48] as const;

/** An RGB LED's state in a single number: colour, and for animations second colour and channel. */
export const rgbLed = (color: number, animation?: { kind: number; color: number; speed: (typeof SPEEDS)[number] }): number =>
  animation ? color + 128 * animation.color + 16384 * (animation.kind + SPEEDS.indexOf(animation.speed)) : color;

/** A LED's messages: one (steady colour or single-colour pulse) or two (animation). */
export function ledMessages(status: number, note: number, value: number): number[][] {
  const channel2 = value >> 14;
  if (!channel2) return [[status, note, value & 0x7f]];
  return [[status, note, value & 0x7f], [(status & 0xf0) | channel2, note, (value >> 7) & 0x7f]];
}

/** Queued, as in Live: blinks between green and off (Blink(GREEN, BLACK, 24): channel 14). */
export const TRIGGERED = (color: number) => rgbLed(color, { kind: ANIMATION.blink, color: 0, speed: 24 });
