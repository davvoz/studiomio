/* The synced rates of the modulations (Neuro and Analog LFOs, Phaser): beats per cycle. */
export const TEMPO_RATES: readonly (readonly [label: string, beats: number])[] = [
  ['8 bars', 32], ['4 bars', 16], ['2 bars', 8], ['1 bar', 4], ['1/2', 2], ['1/4.', 1.5], ['1/4', 1],
  ['1/4T', 2 / 3], ['1/8.', 0.75], ['1/8', 0.5], ['1/8T', 1 / 3], ['1/16', 0.25], ['1/16T', 1 / 6], ['1/32', 0.125],
];

/** The index of a rate from its name ("1/4", "2 bars"…). */
export const TEMPO_RATE = Object.fromEntries(TEMPO_RATES.map(([l], i) => [l, i])) as Readonly<Record<string, number>>;
