/* Il protocollo dell'Akai APC40 mkII in "Ableton Live mode" (APC40 mkII Communications
 * Protocol): note e controlli di ogni elemento, il messaggio SysEx che accende quel modo e la
 * tavolozza dei pad RGB. In Ableton mode i pulsanti sono momentanei e i LED li comanda il
 * programma: è lui a decidere cosa si accende, come fa Live. Qui ci sono solo dati e conti puri. */

/** Le note dei pulsanti (Note On alla pressione, Note Off al rilascio). Quelli per traccia
 *  arrivano sul canale della traccia (0..7); gli altri sul canale 0. */
export const NOTE = {
  /** Griglia 8×5: 0x00..0x27, dalla riga in basso (0..7) a quella in alto (32..39). */
  clipGrid: 0x00,
  recordArm: 0x30,
  solo: 0x31,
  /** Il pulsante col numero della traccia: acceso = la traccia suona (non è in mute). */
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
  /** Lancio delle scene: 0x52..0x56, dall'alto in basso. */
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

/** I controlli continui (Control Change). */
export const CC = {
  /** Fader delle tracce, sul canale della traccia. */
  trackFader: 0x07,
  /** Encoder del tempo, relativo. */
  tempo: 0x0d,
  masterFader: 0x0e,
  crossfader: 0x0f,
  /** Le 8 manopole "Device Control": valore 0x10..0x17, tipo dell'anello di LED 0x18..0x1f. */
  deviceKnob: 0x10,
  deviceRing: 0x18,
  /** Encoder del livello del cue, relativo. */
  cueLevel: 0x2f,
  /** Le 8 manopole sopra le tracce: valore 0x30..0x37, tipo dell'anello 0x38..0x3f. */
  trackKnob: 0x30,
  trackRing: 0x38,
} as const;

/** Come si accende l'anello di LED di una manopola. */
export const RING = { off: 0, single: 1, volume: 2, pan: 3 } as const;

export const TRACKS = 8;
export const SCENES = 5;

/** Il riconoscimento del controller dal nome della sua porta MIDI ("APC40 mkII", "2- APC40 mkII"…). */
export const PORT_NAME = /apc\s*40\s*mk\s*(ii|2)/i;

const AKAI = 0x47;
const APC40_MK2 = 0x29;

/** Modi del controller: generico (i LED li gestisce da sé) o Ableton Live (li gestisce il programma). */
export const MODE = { generic: 0x40, ableton: 0x41, alternateAbleton: 0x42 } as const;

// L'avvio come lo fa Live (script _APC/APC.py): richiesta d'identità; dalla risposta il device
// ID; presentazione con quel device ID; poi la "dongle challenge" e, alla sua risposta, i LED.

/** La richiesta d'identità, come la manda Live. */
export const IDENTITY_REQUEST: readonly number[] = [0xf0, 0x7e, 0x00, 0x06, 0x01, 0xf7];

/** Il device ID dalla risposta d'identità di un APC40 mkII (F0 7E <id> 06 02 47 29 …), o null
 *  se il messaggio non lo è. Live lo prende dal byte 13. */
export function identityDeviceId(data: ArrayLike<number>): number | null {
  if (data.length < 14 || data[0] !== 0xf0 || data[1] !== 0x7e || data[3] !== 0x06 || data[4] !== 0x02) return null;
  return data[5] === AKAI && data[6] === APC40_MK2 ? data[13] : null;
}

/** La versione che ci si presenta: quella di Live 11, come fa lo script. */
const HOST_VERSION = [11, 0, 0] as const;

/** Il messaggio di presentazione: mette il controller nel modo dato. */
export const introduction = (mode: number = MODE.ableton, device = 0): number[] =>
  [0xf0, AKAI, device, APC40_MK2, 0x60, 0x00, 0x04, mode, ...HOST_VERSION, 0xf7];

/** La "dongle challenge" che Live manda dopo la presentazione: due numeri, 8 nibble ciascuno.
 *  Live controlla la risposta con un algoritmo suo; a noi basta che lo scambio avvenga. */
export function dongleChallenge(device: number, a: number, b: number): number[] {
  const nibbles = (n: number) => Array.from({ length: 8 }, (_, i) => (n >> (4 * (7 - i))) & 0x0f);
  return [0xf0, AKAI, device, APC40_MK2, 0x50, 0x00, 0x10, ...nibbles(a), ...nibbles(b), 0xf7];
}

/** Vero se è la risposta del controller alla challenge (… 51 00 10 …). */
export const isDongleResponse = (data: ArrayLike<number>): boolean =>
  data.length >= 7 && data[0] === 0xf0 && data[1] === AKAI && data[3] === APC40_MK2 && data[4] === 0x51;

/** I pulsanti a un colore (select, solo, activator, transport…): acceso è 127, come in Live. */
export const ON = 127;
/** Gli stop delle tracce hanno la loro scala: 1 acceso, 2 lampeggia (lo fa il controller). */
export const STOP_LED = { off: 0, on: 1, blink: 2 } as const;

/** Nota del pad in colonna `col` (0 = sinistra) e riga `row` (0 = in alto). */
export const padNote = (col: number, row: number): number => NOTE.clipGrid + (SCENES - 1 - row) * TRACKS + col;

/** Colonna e riga (0 = in alto) di una nota della griglia, o null. */
export function padAt(note: number): { col: number; row: number } | null {
  const i = note - NOTE.clipGrid;
  if (i < 0 || i >= TRACKS * SCENES) return null;
  return { col: i % TRACKS, row: SCENES - 1 - Math.floor(i / TRACKS) };
}

/** Un encoder relativo: 1..63 avanti, 65..127 indietro (complemento a due su 7 bit). */
export const relative = (value: number): number => (value < 64 ? value : value - 128);

// ------------------------------------------------------------------ fader e pan

/** Il fader come quello di Live: 0 è il silenzio, 0 dB a circa l'85% della corsa, +6 dB in cima. */
const UNITY = 0.85;
const MAX_DB = 6;
/** Sotto questo livello il motore tace (vedi dbToGain). */
export const SILENT_DB = -70;

export function faderToDb(value: number): number {
  const u = Math.max(0, Math.min(1, value / 127));
  if (u >= UNITY) return Math.round(((u - UNITY) / (1 - UNITY)) * MAX_DB * 10) / 10;
  const db = SILENT_DB * (1 - u / UNITY) ** 2;
  return Math.round(db * 10) / 10;
}

export function dbToFader(db: number): number {
  if (db >= 0) return Math.round((UNITY + (Math.min(db, MAX_DB) / MAX_DB) * (1 - UNITY)) * 127);
  if (db <= SILENT_DB) return 0;
  return Math.round(UNITY * (1 - Math.sqrt(db / SILENT_DB)) * 127);
}

/** Manopola del pan: 64 è il centro. */
export const knobToPan = (value: number): number => (value < 64 ? (value - 64) / 64 : Math.min(1, (value - 64) / 63));
export const panToKnob = (pan: number): number => Math.round(pan < 0 ? 64 + pan * 64 : 64 + pan * 63);

// ------------------------------------------------------------------ colori

/** La tavolozza dei pad: la velocity di un Note On sceglie il colore (0 = spento). */
export const PALETTE: readonly number[] = [
  0x000000, 0x1e1e1e, 0x7f7f7f, 0xffffff, 0xff4c4c, 0xff0000, 0x590000, 0x190000,
  0xffbd6c, 0xff5400, 0x591d00, 0x271b00, 0xffff4c, 0xffff00, 0x595900, 0x191900,
  0x88ff4c, 0x54ff00, 0x1d5900, 0x142b00, 0x4cff4c, 0x00ff00, 0x005900, 0x001900,
  0x4cff5e, 0x00ff19, 0x00590d, 0x001902, 0x4cff88, 0x00ff55, 0x00591d, 0x001f12,
  0x4cffb7, 0x00ff99, 0x005935, 0x001912, 0x4cc3ff, 0x00a9ff, 0x004152, 0x001019,
  0x4c88ff, 0x0055ff, 0x001d59, 0x000819, 0x4c4cff, 0x0000ff, 0x000059, 0x000019,
  0x874cff, 0x5400ff, 0x190064, 0x0f0030, 0xff4cff, 0xff00ff, 0x590059, 0x190019,
  0xff4c87, 0xff0054, 0x59001d, 0x220013, 0xff1500, 0x993500, 0x795100, 0x436400,
  0x033900, 0x005735, 0x00547f, 0x0000ff, 0x00454f, 0x2500cc, 0x7f7f7f, 0x202020,
  0xff0000, 0xbdff2d, 0xafed06, 0x64ff09, 0x108b00, 0x00ff87, 0x00a9ff, 0x002aff,
  0x3f00ff, 0x7a00ff, 0xb21a7d, 0x402100, 0xff4a00, 0x88e106, 0x72ff15, 0x00ff00,
  0x3bff26, 0x59ff71, 0x38ffcc, 0x5b8aff, 0x3151c6, 0x877fe9, 0xd31dff, 0xff005d,
  0xff7f00, 0xb9b000, 0x90ff00, 0x835d07, 0x392b00, 0x144c10, 0x0d5038, 0x15152a,
  0x16205a, 0x693c1c, 0xa8000a, 0xde513d, 0xd86a1c, 0xffe126, 0x9ee12f, 0x67b50f,
  0x1e1e30, 0xdcff6b, 0x80ffbd, 0x9a99ff, 0x8e66ff, 0x404040, 0x757575, 0xe0ffff,
  0xa00000, 0x350000, 0x1ad000, 0x074200, 0xb9b000, 0x3f3100, 0xb35f00, 0x4b1502,
];

/** I colori fissi, come quelli che Live usa sull'APC40 mkII. */
export const COLOR = {
  off: 0,
  dim: 1,
  white: 3,
  red: 5,
  amber: 9,
  green: 21,
} as const;

/** Come anima un pad RGB, come fa Live (pushbase/colors.py): il primo colore sul canale 0, il
 *  secondo sul canale dell'animazione, e l'alternanza la fa il controller (a mano lo si ingolfa
 *  fino a bloccarlo). Canali 6..10 pulsa, 11..15 lampeggia, per velocità 4, 6, 12, 24, 48. */
export const ANIMATION = { pulse: 6, blink: 11 } as const;
const SPEEDS = [4, 6, 12, 24, 48] as const;

/** Lo stato di un LED RGB in un numero solo: colore, e per le animazioni secondo colore e canale. */
export const rgbLed = (color: number, animation?: { kind: number; color: number; speed: (typeof SPEEDS)[number] }): number =>
  animation ? color + 128 * animation.color + 16384 * (animation.kind + SPEEDS.indexOf(animation.speed)) : color;

/** I messaggi di un LED: uno (colore fisso o pulsante a un colore) o due (animazione). */
export function ledMessages(status: number, note: number, value: number): number[][] {
  const channel2 = value >> 14;
  if (!channel2) return [[status, note, value & 0x7f]];
  return [[status, note, value & 0x7f], [(status & 0xf0) | channel2, note, (value >> 7) & 0x7f]];
}

/** In coda, come in Live: lampeggia tra verde e spento (Blink(GREEN, BLACK, 24): canale 14). */
export const TRIGGERED = (color: number) => rgbLed(color, { kind: ANIMATION.blink, color: 0, speed: 24 });

const rgb = (c: number) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff] as const;

/** I colori abbastanza luminosi da riconoscersi su un pad (i più scuri sembrano spenti). */
const BRIGHT = PALETTE.map((c, i) => [i, rgb(c)] as const).filter(([i, [r, g, b]]) => i > 3 && Math.max(r, g, b) >= 0x99);

const cache = new Map<string, number>();

/** Il colore della tavolozza più vicino a "#rrggbb" (il colore di una clip), portato alla
 *  luminosità piena: sui pad conta la tinta, non quanto è scuro. */
export function paletteIndex(hex: string): number {
  const known = cache.get(hex);
  if (known !== undefined) return known;
  const n = Number.parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(n)) return COLOR.white;
  const [r, g, b] = rgb(n);
  const top = Math.max(r, g, b, 1);
  const [R, G, B] = [r, g, b].map(v => (v * 255) / top);
  let best: number = COLOR.white, distance = Infinity;
  for (const [i, [pr, pg, pb]] of BRIGHT) {
    // pesi della luminosità percepita: il verde conta di più
    const d = 2 * (R - pr) ** 2 + 4 * (G - pg) ** 2 + 3 * (B - pb) ** 2;
    if (d < distance) [best, distance] = [i, d];
  }
  cache.set(hex, best);
  return best;
}
