/* Come un controllo da 0 a 127 diventa volume o pan, come in Live: il fader del volume ha lo
 * 0 dB all'85% della corsa e +6 dB in cima; per il pan 64 è il centro. Vale per i fader
 * dell'APC40 mkII e per quelli disegnati sulla griglia dei Launchpad. Conti puri. */

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

/** Manopola (o fader) del pan: 64 è il centro. */
export const knobToPan = (value: number): number => (value < 64 ? (value - 64) / 64 : Math.min(1, (value - 64) / 63));
export const panToKnob = (pan: number): number => Math.round(pan < 0 ? 64 + pan * 64 : 64 + pan * 63);
