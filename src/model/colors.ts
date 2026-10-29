import type { Color } from './clip';

/** Colori carichi, per tinta: rosso, arancio, giallo, lime, verde, smeraldo, ciano, blu, viola,
 *  magenta, rosa, marrone, bianco. Tutti abbastanza chiari per il nome scuro sulla clip. */
const STRONG: readonly Color[] = [
  '#f03c46', '#ff6a14', '#ffd60a', '#a8e01e', '#2ec944', '#00c98d', '#00b4e6',
  '#3f7cff', '#9a5cff', '#e632d8', '#ff3c82', '#c0702e', '#e8eaed',
];

/** Gli stessi, tenui (sono i colori delle prime versioni). */
const SOFT: readonly Color[] = [
  '#ef6b6b', '#ff9d2e', '#ffd64a', '#d4e157', '#9ad85b', '#4fcf9a', '#4bc3d6',
  '#5b8def', '#9b7bf0', '#e36bd0', '#ff7aa8', '#c8a27a', '#8fa3b8',
];

/** Colori di tracce, clip e scene: una tavolozza fissa come quella di Live, così ognuno ha il
 *  suo colore sui pad dei controller (control/palette). Due righe da 13: carichi sopra, tenui
 *  sotto. */
export const PALETTE: readonly Color[] = [...STRONG, ...SOFT];

/** Le tracce nuove prendono i colori a rotazione, prima i carichi, senza bianco e grigio. */
const ROTATION: readonly Color[] = [...STRONG.slice(0, -1), ...SOFT.slice(0, -1)];

export const paletteColor = (index: number): Color => ROTATION[((index % ROTATION.length) + ROTATION.length) % ROTATION.length];
