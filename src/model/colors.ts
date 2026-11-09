import type { Color } from './clip';

/** Strong colours, by hue: red, orange, yellow, lime, green, emerald, cyan, blue, violet,
 *  magenta, pink, brown, white. All light enough for the dark name on the clip. */
const STRONG: readonly Color[] = [
  '#f03c46', '#ff6a14', '#ffd60a', '#a8e01e', '#2ec944', '#00c98d', '#00b4e6',
  '#3f7cff', '#9a5cff', '#e632d8', '#ff3c82', '#c0702e', '#e8eaed',
];

/** The same, pale (they're the colours of the first versions). */
const SOFT: readonly Color[] = [
  '#ef6b6b', '#ff9d2e', '#ffd64a', '#d4e157', '#9ad85b', '#4fcf9a', '#4bc3d6',
  '#5b8def', '#9b7bf0', '#e36bd0', '#ff7aa8', '#c8a27a', '#8fa3b8',
];

/** Colours of tracks, clips and scenes: a fixed palette like Live's, so each has its
 *  colour on the controllers' pads (control/palette). Two rows of 13: strong on top, pale
 *  below. */
export const PALETTE: readonly Color[] = [...STRONG, ...SOFT];

/** New tracks take the colours in rotation, strong first, without white and grey. */
const ROTATION: readonly Color[] = [...STRONG.slice(0, -1), ...SOFT.slice(0, -1)];

export const paletteColor = (index: number): Color => ROTATION[((index % ROTATION.length) + ROTATION.length) % ROTATION.length];
