/* How a 0 to 127 control becomes volume or pan, as in Live: the volume fader has
 * 0 dB at 85% of its travel and +6 dB at the top; for pan 64 is the centre. It applies to the
 * APC40 mkII's faders and to those drawn on the Launchpads' grid. Pure maths. */

/** The fader like Live's: 0 is silence, 0 dB at about 85% of the travel, +6 dB at the top. */
const UNITY = 0.85;
const MAX_DB = 6;
/** Below this level the engine is silent (see dbToGain). */
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

/** Pan knob (or fader): 64 is the centre. */
export const knobToPan = (value: number): number => (value < 64 ? (value - 64) / 64 : Math.min(1, (value - 64) / 63));
export const panToKnob = (pan: number): number => Math.round(pan < 0 ? 64 + pan * 64 : 64 + pan * 63);
