/* The Novation Launchpad protocol as Live 11 uses it (scripts Launchpad_X,
 * Launchpad_Mini_MK3, Launchpad_Pro_MK3, Launchpad_MK2 and novation/): X, Mini MK3 and Pro MK3 in
 * "DAW mode", the MK2 in its Session layout. For all of them the 8×8 grid is made of notes 11..88
 * (the top row is 81..88), the scene buttons are on the right (89, 79 … 19), the palette is
 * the APC40 mkII's; a LED is steady with the colour on channel 1, blinks with the second colour
 * on channel 2, pulses on channel 3 (the controller does the animations, in time). In DAW mode
 * the LEDs are driven by the program, as Live does. Here there's only data and pure maths. */

export type ModelId = 'x' | 'mini' | 'pro' | 'mk2';

/** The buttons outside the grid and the scene column. */
export type Button =
  | 'up' | 'down' | 'left' | 'right' | 'session'
  // Launchpad X
  | 'note' | 'custom' | 'captureMidi'
  // Launchpad Mini MK3
  | 'drums' | 'keys' | 'user'
  // Launchpad Pro MK3
  | 'shift' | 'clear' | 'duplicate' | 'quantize' | 'fixedLength' | 'play' | 'record'
  | 'arm' | 'mute' | 'solo' | 'volume' | 'pan' | 'sends' | 'device' | 'stopClip'
  // Launchpad MK2
  | 'user1' | 'user2' | 'mixer';

export interface Model {
  readonly id: ModelId;
  readonly name: string;
  /** Recognition from the MIDI port names ("LPX MIDI", "MIDIIN2 (LPX MIDI)", "Launchpad MK2"…). */
  readonly port: RegExp;
  /** Which USB interface is the one for programs (the "DAW"): on Windows the first port has the
   *  controller's name, the others "MIDIIN2 (…)", "MIDIIN3 (…)". */
  readonly dawInterface: number;
  /** The model byte in Novation SysEx: F0 00 20 29 02 <id> … */
  readonly sysexId: number;
  /** The family in the identity reply: F0 7E <dev> 06 02 00 20 29 <family> 00 00 … */
  readonly family: readonly [number, number];
  /** The scene buttons send CCs (X, Mini MK3, Pro MK3) or notes (MK2). */
  readonly sceneKind: 'cc' | 'note';
  /** The buttons, all CCs on channel 1 (pressed 127, released 0). */
  readonly buttons: Readonly<Partial<Record<Button, number>>>;
}

export const MODELS: readonly Model[] = [
  {
    id: 'x', name: 'Launchpad X', port: /\bLPX\b|launchpad\s*x\b/i, dawInterface: 2, sysexId: 0x0c, family: [0x03, 0x01], sceneKind: 'cc',
    buttons: { up: 91, down: 92, left: 93, right: 94, session: 95, note: 96, custom: 97, captureMidi: 98 },
  },
  {
    id: 'mini', name: 'Launchpad Mini MK3', port: /LPMiniMK3|launchpad\s*mini\s*mk\s*3/i, dawInterface: 2, sysexId: 0x0d, family: [0x13, 0x01], sceneKind: 'cc',
    buttons: { up: 91, down: 92, left: 93, right: 94, session: 95, drums: 96, keys: 97, user: 98 },
  },
  {
    id: 'pro', name: 'Launchpad Pro MK3', port: /LPProMK3|launchpad\s*pro\s*mk\s*3/i, dawInterface: 3, sysexId: 0x0e, family: [0x23, 0x01], sceneKind: 'cc',
    buttons: {
      up: 80, down: 70, left: 91, right: 92, session: 93,
      shift: 90, clear: 60, duplicate: 50, quantize: 40, fixedLength: 30, play: 20, record: 10,
      arm: 1, mute: 2, solo: 3, volume: 4, pan: 5, sends: 6, device: 7, stopClip: 8,
    },
  },
  {
    id: 'mk2', name: 'Launchpad MK2', port: /launchpad\s*mk\s*2/i, dawInterface: 1, sysexId: 0x18, family: [0x69, 0x00], sceneKind: 'note',
    buttons: { up: 104, down: 105, left: 106, right: 107, session: 108, user1: 109, user2: 110, mixer: 111 },
  },
];

/** A Launchpad, also of a model studiomio doesn't know (Launchpad, S, Mini, Pro from 2015…). */
export const ANY_LAUNCHPAD = /launchpad|\bLP(X|Mini|Pro)/i;

/** The model from a port name, or null. */
export const modelOfPort = (name: string): Model | null => MODELS.find(m => m.port.test(name)) ?? null;

/** A port's USB interface from its name: "MIDIIN2 (LPX MIDI)" is 2, "LPX MIDI" is 1;
 *  'daw' if the name says so (macOS, the new Windows MIDI stack: "LPX DAW"). */
export function portInterface(name: string): number | 'daw' {
  if (/\bDAW\b/i.test(name)) return 'daw';
  const m = /^\s*MIDI(?:IN|OUT)(\d+)\s*\(/i.exec(name);
  return m ? Number(m[1]) : 1;
}

/** Among the controller's ports, the DAW one: with the name saying so, or the one of the right
 *  interface for the model (`prefer` chooses it by hand), or the only one there is. */
export function dawPort<P extends { readonly name?: string | null }>(ports: readonly P[], model: Model, prefer?: number): P | undefined {
  const named = ports.find(p => portInterface(p.name ?? '') === 'daw');
  if (named && prefer === undefined) return named;
  const wanted = prefer ?? model.dawInterface;
  return ports.find(p => portInterface(p.name ?? '') === wanted) ?? (ports.length === 1 ? ports[0] : undefined);
}

// ------------------------------------------------------------------ grid

export const SIZE = 8;

/** Note of the pad in column `col` (0 = left) and row `row` (0 = top). */
export const padNote = (col: number, row: number): number => (SIZE - row) * 10 + col + 1;

/** Column and row (0 = top) of a grid note, or null. */
export function padAt(note: number): { col: number; row: number } | null {
  const r = Math.floor(note / 10), c = note % 10;
  return r >= 1 && r <= SIZE && c >= 1 && c <= SIZE ? { col: c - 1, row: SIZE - r } : null;
}

/** The scene button of row `row` (0 = top): 89, 79 … 19. */
export const sceneButton = (row: number): number => (SIZE - row) * 10 + 9;

/** The row of a scene button, or null. */
export function sceneAt(n: number): number | null {
  const r = Math.floor(n / 10);
  return n % 10 === 9 && r >= 1 && r <= SIZE ? SIZE - r : null;
}

/** Launchpad Pro MK3: the buttons under the grid, one per track (101..108). */
export const TRACK_BUTTONS = 101;

// ------------------------------------------------------------------ SysEx

const header = (model: Model) => [0xf0, 0x00, 0x20, 0x29, 0x02, model.sysexId];

/** The identity request, as Live sends it to these controllers. */
export const IDENTITY_REQUEST: readonly number[] = [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7];

/** The family in a Novation device's identity reply, or null if it isn't one. */
export function identityFamily(data: ArrayLike<number>): [number, number] | null {
  if (data.length < 10 || data[0] !== 0xf0 || data[1] !== 0x7e || data[3] !== 0x06 || data[4] !== 0x02) return null;
  return data[5] === 0x00 && data[6] === 0x20 && data[7] === 0x29 ? [data[8], data[9]] : null;
}

/** X, Mini MK3, Pro MK3: DAW mode (the program drives the Session LEDs) or the normal mode. */
export const dawMode = (model: Model, on: boolean): number[] => [...header(model), 0x10, on ? 1 : 0, 0xf7];

/** What the grid shows. */
export type Layout = 'session' | 'volume' | 'pan' | 'device';

/** MK2's layout bytes (the device page doesn't exist there: it stays on Session). */
const MK2_LAYOUT: Readonly<Record<Layout, number>> = { session: 0, volume: 4, pan: 5, device: 0 };

/** The SysEx that changes layout. X and Mini MK3: 00 <layout> (Session 0, faders 0x0D); Pro MK3:
 *  00 <layout> <page> 00 (Session 0, faders 1 with page 0 volume, 1 pan, 3 device);
 *  MK2: 22 <layout> (Session 0, volume faders 4, pan faders 5). */
export function layoutMessage(model: Model, layout: Layout): number[] {
  if (model.id === 'mk2') return [...header(model), 0x22, MK2_LAYOUT[layout], 0xf7];
  if (model.id === 'pro') return [...header(model), 0x00, layout === 'session' ? 0 : 1, FADER_PAGE[layout], 0x00, 0xf7];
  return [...header(model), 0x00, layout === 'session' ? 0 : 0x0d, 0xf7];
}

/** Pro MK3: the fader page of each layout (its faders send CCs page × 8 + 0..7). */
export const FADER_PAGE: Readonly<Record<Layout, number>> = { session: 0, volume: 0, pan: 1, device: 3 };

/** The layout the controller says it shows (it says so when it's changed from the controller),
 *  or null if the message isn't one: 'other' is a layout of its own (note, custom, settings…). */
export function reportedLayout(model: Model, data: ArrayLike<number>): 'session' | 'faders' | 'other' | null {
  if (model.id === 'mk2' || data.length < 9) return null;
  const h = header(model);
  if (h.some((b, i) => data[i] !== b) || data[6] !== 0x00) return null;
  if (data[7] === 0) return 'session';
  const faders = model.id === 'pro' ? 1 : 0x0d;
  return data[7] === faders ? 'faders' : 'other';
}

/** X and Mini MK3: the Session button's two colours (the first when the grid is on Session). */
export const sessionColor = (model: Model, active: number, inactive: number): number[] =>
  [...header(model), 0x14, active, inactive, 0xf7];

/** The faders drawn on the grid: vertical or horizontal, from zero or from the centre. */
export interface FaderSetup {
  readonly horizontal: boolean;
  readonly bipolar: boolean;
  readonly colors: readonly number[];
}

/** X and Pro MK3: the page of 8 faders (01 <page> <orientation> and for each fader index,
 *  polarity, CC, colour). They send and receive the CCs on channel 5 (FADER_CHANNEL). */
export function faderSetup(model: Model, page: number, f: FaderSetup): number[] {
  const faders = Array.from({ length: SIZE }, (_, i) => [i, f.bipolar ? 1 : 0, faderCc(model, page, i), f.colors[i] ?? 0]);
  return [...header(model), 0x01, page, f.horizontal ? 1 : 0, ...faders.flat(), 0xf7];
}

/** X and Pro MK3: the faders' channel (value) and that of their colour. */
export const FADER_CHANNEL = 4;
export const FADER_COLOR_CHANNEL = 5;

/** The CC of fader `i`: X 21..28 (channel 5), Pro MK3 page × 8 + i (channel 5), MK2 21..28 (channel 1). */
export const faderCc = (model: Model, page: number, i: number): number => (model.id === 'pro' ? page * SIZE + i : 21 + i);

/** MK2: a fader of the Volume or Pan layout (2B <index> <type> <colour> <value>; type 0 volume, 1 pan). */
export const mk2Fader = (index: number, pan: boolean, color: number, value: number): number[] =>
  [0xf0, 0x00, 0x20, 0x29, 0x02, 0x18, 0x2b, index, pan ? 1 : 0, color, value, 0xf7];

/** MK2: the challenge Live sends after the identity (four 7-bit bytes), and the reply. */
export const mk2Challenge = (bytes: readonly number[]): number[] =>
  [0xf0, 0x00, 0x20, 0x29, 0x02, 0x18, 0x40, ...bytes.map(b => b & 0x7f), 0xf7];
export const isMk2ChallengeResponse = (data: ArrayLike<number>): boolean =>
  data.length === 10 && [0xf0, 0x00, 0x20, 0x29, 0x02, 0x18, 0x40].every((b, i) => data[i] === b);
/** MK2: Live se ne va. */
export const MK2_QUIT: readonly number[] = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x18, 0x40, 0xf7];

// ------------------------------------------------------------------ colours

/** The palette colours Live uses on the Launchpads (novation/colors.py: Rgb). */
export const COLOR = {
  off: 0,
  whiteHalf: 1,
  white: 3,
  red: 5,
  redHalf: 7,
  offWhite: 8,
  orange: 9,
  orangeHalf: 11,
  cream: 12,
  green: 21,
  greenHalf: 27,
  lightBlueHalf: 39,
  blue: 41,
  blueHalf: 43,
  darkBlue: 49,
  darkBlueHalf: 51,
  paleGreenHalf: 89,
  yellow: 97,
  yellowHalf: 125,
} as const;

/** The animation channels: blink (between the steady colour and this one) and pulse. */
const BLINK_CHANNEL = 1;
const PULSE_CHANNEL = 2;

/** A LED's state in a single number: the steady colour, and for an animation its colour and channel. */
const animated = (base: number, color: number, channel: number) => base + 128 * color + 16384 * channel;
/** Blinks between off and the colour (Blink(BLACK, color)): like a queued clip. */
export const blink = (color: number): number => animated(COLOR.off, color, BLINK_CHANNEL);
/** Pulses in the colour (Pulse(BLACK, color)): like the playing clip. */
export const pulse = (color: number): number => animated(COLOR.off, color, PULSE_CHANNEL);

/** A LED's messages: one (steady colour) or two (the steady one, then the animation on its channel). */
export function ledMessages(status: number, number: number, value: number): number[][] {
  const channel = value >> 14;
  if (!channel) return [[status, number, value & 0x7f]];
  return [[status, number, value & 0x7f], [(status & 0xf0) | channel, number, (value >> 7) & 0x7f]];
}
