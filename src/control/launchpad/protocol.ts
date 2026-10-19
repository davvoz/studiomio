/* Il protocollo dei Novation Launchpad come lo usa Live 11 (script Launchpad_X,
 * Launchpad_Mini_MK3, Launchpad_Pro_MK3, Launchpad_MK2 e novation/): X, Mini MK3 e Pro MK3 in
 * "DAW mode", il MK2 nel suo layout Session. Per tutti la griglia 8×8 è fatta di note 11..88
 * (la riga in alto è 81..88), i pulsanti di scena stanno a destra (89, 79 … 19), la tavolozza è
 * quella dell'APC40 mkII; un LED è fisso col colore sul canale 1, lampeggia col secondo colore
 * sul canale 2, pulsa sul canale 3 (le animazioni le fa il controller, a tempo). Nella DAW mode
 * i LED li comanda il programma, come fa Live. Qui ci sono solo dati e conti puri. */

export type ModelId = 'x' | 'mini' | 'pro' | 'mk2';

/** I pulsanti fuori dalla griglia e dalla colonna delle scene. */
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
  /** Il riconoscimento dal nome delle porte MIDI ("LPX MIDI", "MIDIIN2 (LPX MIDI)", "Launchpad MK2"…). */
  readonly port: RegExp;
  /** Quale interfaccia USB è quella per i programmi (la "DAW"): su Windows la prima porta ha il
   *  nome del controller, le altre "MIDIIN2 (…)", "MIDIIN3 (…)". */
  readonly dawInterface: number;
  /** Il byte del modello nei SysEx Novation: F0 00 20 29 02 <id> … */
  readonly sysexId: number;
  /** La famiglia nella risposta d'identità: F0 7E <dev> 06 02 00 20 29 <famiglia> 00 00 … */
  readonly family: readonly [number, number];
  /** I pulsanti di scena mandano CC (X, Mini MK3, Pro MK3) o note (MK2). */
  readonly sceneKind: 'cc' | 'note';
  /** I pulsanti, tutti CC sul canale 1 (premuto 127, lasciato 0). */
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

/** Un Launchpad, anche di un modello che studiomio non conosce (Launchpad, S, Mini, Pro del 2015…). */
export const ANY_LAUNCHPAD = /launchpad|\bLP(X|Mini|Pro)/i;

/** Il modello dal nome di una porta, o null. */
export const modelOfPort = (name: string): Model | null => MODELS.find(m => m.port.test(name)) ?? null;

/** L'interfaccia USB di una porta dal suo nome: "MIDIIN2 (LPX MIDI)" è la 2, "LPX MIDI" la 1;
 *  'daw' se il nome lo dice (macOS, il nuovo stack MIDI di Windows: "LPX DAW"). */
export function portInterface(name: string): number | 'daw' {
  if (/\bDAW\b/i.test(name)) return 'daw';
  const m = /^\s*MIDI(?:IN|OUT)(\d+)\s*\(/i.exec(name);
  return m ? Number(m[1]) : 1;
}

/** Fra le porte del controller, quella della DAW: col nome che lo dice, o quella dell'interfaccia
 *  giusta per il modello (`prefer` la sceglie a mano), o la sola che c'è. */
export function dawPort<P extends { readonly name?: string | null }>(ports: readonly P[], model: Model, prefer?: number): P | undefined {
  const named = ports.find(p => portInterface(p.name ?? '') === 'daw');
  if (named && prefer === undefined) return named;
  const wanted = prefer ?? model.dawInterface;
  return ports.find(p => portInterface(p.name ?? '') === wanted) ?? (ports.length === 1 ? ports[0] : undefined);
}

// ------------------------------------------------------------------ griglia

export const SIZE = 8;

/** Nota del pad in colonna `col` (0 = sinistra) e riga `row` (0 = in alto). */
export const padNote = (col: number, row: number): number => (SIZE - row) * 10 + col + 1;

/** Colonna e riga (0 = in alto) di una nota della griglia, o null. */
export function padAt(note: number): { col: number; row: number } | null {
  const r = Math.floor(note / 10), c = note % 10;
  return r >= 1 && r <= SIZE && c >= 1 && c <= SIZE ? { col: c - 1, row: SIZE - r } : null;
}

/** Il pulsante di scena della riga `row` (0 = in alto): 89, 79 … 19. */
export const sceneButton = (row: number): number => (SIZE - row) * 10 + 9;

/** La riga di un pulsante di scena, o null. */
export function sceneAt(n: number): number | null {
  const r = Math.floor(n / 10);
  return n % 10 === 9 && r >= 1 && r <= SIZE ? SIZE - r : null;
}

/** Launchpad Pro MK3: i pulsanti sotto la griglia, uno per traccia (101..108). */
export const TRACK_BUTTONS = 101;

// ------------------------------------------------------------------ SysEx

const header = (model: Model) => [0xf0, 0x00, 0x20, 0x29, 0x02, model.sysexId];

/** La richiesta d'identità, come la manda Live a questi controller. */
export const IDENTITY_REQUEST: readonly number[] = [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7];

/** La famiglia nella risposta d'identità di un apparecchio Novation, o null se non lo è. */
export function identityFamily(data: ArrayLike<number>): [number, number] | null {
  if (data.length < 10 || data[0] !== 0xf0 || data[1] !== 0x7e || data[3] !== 0x06 || data[4] !== 0x02) return null;
  return data[5] === 0x00 && data[6] === 0x20 && data[7] === 0x29 ? [data[8], data[9]] : null;
}

/** X, Mini MK3, Pro MK3: la DAW mode (i LED della Session li comanda il programma) o il modo normale. */
export const dawMode = (model: Model, on: boolean): number[] => [...header(model), 0x10, on ? 1 : 0, 0xf7];

/** Cosa mostra la griglia. */
export type Layout = 'session' | 'volume' | 'pan' | 'device';

/** Il SysEx che cambia layout. X e Mini MK3: 00 <layout> (Session 0, fader 0x0D); Pro MK3:
 *  00 <layout> <pagina> 00 (Session 0, fader 1 con la pagina 0 volume, 1 pan, 3 dispositivo);
 *  MK2: 22 <layout> (Session 0, fader del volume 4, del pan 5). */
export function layoutMessage(model: Model, layout: Layout): number[] {
  if (model.id === 'mk2') return [...header(model), 0x22, layout === 'volume' ? 4 : layout === 'pan' ? 5 : 0, 0xf7];
  if (model.id === 'pro') return [...header(model), 0x00, layout === 'session' ? 0 : 1, FADER_PAGE[layout], 0x00, 0xf7];
  return [...header(model), 0x00, layout === 'session' ? 0 : 0x0d, 0xf7];
}

/** Pro MK3: la pagina di fader di ogni layout (i suoi fader mandano i CC pagina × 8 + 0..7). */
export const FADER_PAGE: Readonly<Record<Layout, number>> = { session: 0, volume: 0, pan: 1, device: 3 };

/** Il layout che il controller dice di mostrare (lo dice quando lo si cambia dal controller),
 *  o null se il messaggio non lo è: 'other' è un layout suo (note, custom, impostazioni…). */
export function reportedLayout(model: Model, data: ArrayLike<number>): 'session' | 'faders' | 'other' | null {
  if (model.id === 'mk2' || data.length < 9) return null;
  const h = header(model);
  if (h.some((b, i) => data[i] !== b) || data[6] !== 0x00) return null;
  return data[7] === 0 ? 'session' : data[7] === (model.id === 'pro' ? 1 : 0x0d) ? 'faders' : 'other';
}

/** X e Mini MK3: i due colori del pulsante Session (il primo quando la griglia è sulla Session). */
export const sessionColor = (model: Model, active: number, inactive: number): number[] =>
  [...header(model), 0x14, active, inactive, 0xf7];

/** I fader disegnati sulla griglia: verticali o orizzontali, da zero o dal centro. */
export interface FaderSetup {
  readonly horizontal: boolean;
  readonly bipolar: boolean;
  readonly colors: readonly number[];
}

/** X e Pro MK3: la pagina di 8 fader (01 <pagina> <orientamento> e per ogni fader indice,
 *  polarità, CC, colore). Mandano e ricevono i CC sul canale 5 (FADER_CHANNEL). */
export function faderSetup(model: Model, page: number, f: FaderSetup): number[] {
  const faders = Array.from({ length: SIZE }, (_, i) => [i, f.bipolar ? 1 : 0, faderCc(model, page, i), f.colors[i] ?? 0]);
  return [...header(model), 0x01, page, f.horizontal ? 1 : 0, ...faders.flat(), 0xf7];
}

/** X e Pro MK3: il canale dei fader (valore) e quello del loro colore. */
export const FADER_CHANNEL = 4;
export const FADER_COLOR_CHANNEL = 5;

/** Il CC del fader `i`: X 21..28 (canale 5), Pro MK3 pagina × 8 + i (canale 5), MK2 21..28 (canale 1). */
export const faderCc = (model: Model, page: number, i: number): number => (model.id === 'pro' ? page * SIZE + i : 21 + i);

/** MK2: un fader del layout Volume o Pan (2B <indice> <tipo> <colore> <valore>; tipo 0 volume, 1 pan). */
export const mk2Fader = (index: number, pan: boolean, color: number, value: number): number[] =>
  [0xf0, 0x00, 0x20, 0x29, 0x02, 0x18, 0x2b, index, pan ? 1 : 0, color, value, 0xf7];

/** MK2: la challenge che Live manda dopo l'identità (quattro byte da 7 bit), e la risposta. */
export const mk2Challenge = (bytes: readonly number[]): number[] =>
  [0xf0, 0x00, 0x20, 0x29, 0x02, 0x18, 0x40, ...bytes.map(b => b & 0x7f), 0xf7];
export const isMk2ChallengeResponse = (data: ArrayLike<number>): boolean =>
  data.length === 10 && [0xf0, 0x00, 0x20, 0x29, 0x02, 0x18, 0x40].every((b, i) => data[i] === b);
/** MK2: Live se ne va. */
export const MK2_QUIT: readonly number[] = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x18, 0x40, 0xf7];

// ------------------------------------------------------------------ colori

/** I colori della tavolozza che Live usa sui Launchpad (novation/colors.py: Rgb). */
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

/** I canali delle animazioni: lampeggia (tra il colore fisso e questo) e pulsa. */
const BLINK_CHANNEL = 1;
const PULSE_CHANNEL = 2;

/** Lo stato di un LED in un numero solo: il colore fisso, e per un'animazione il suo colore e canale. */
const animated = (base: number, color: number, channel: number) => base + 128 * color + 16384 * channel;
/** Lampeggia tra spento e il colore (Blink(BLACK, color)): come una clip in coda. */
export const blink = (color: number): number => animated(COLOR.off, color, BLINK_CHANNEL);
/** Pulsa nel colore (Pulse(BLACK, color)): come la clip che suona. */
export const pulse = (color: number): number => animated(COLOR.off, color, PULSE_CHANNEL);

/** I messaggi di un LED: uno (colore fisso) o due (il fisso, poi l'animazione sul suo canale). */
export function ledMessages(status: number, number: number, value: number): number[][] {
  const channel = value >> 14;
  if (!channel) return [[status, number, value & 0x7f]];
  return [[status, number, value & 0x7f], [(status & 0xf0) | channel, number, (value >> 7) & 0x7f]];
}
