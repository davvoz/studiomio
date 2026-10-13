import type { Color } from './clip';

/** Colori di tracce e clip, assegnati a rotazione. */
export const PALETTE: readonly Color[] = [
  '#ff9d2e', '#ffd64a', '#9ad85b', '#4fcf9a', '#4bc3d6', '#5b8def',
  '#9b7bf0', '#e36bd0', '#ef6b6b', '#c8a27a', '#8fa3b8', '#d4e157',
];

export const paletteColor = (index: number): Color => PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];
