/* Le velocità a tempo delle modulazioni (LFO di Neuro, Phaser): battiti per giro. */
export const TEMPO_RATES: readonly (readonly [label: string, beats: number])[] = [
  ['8 battute', 32], ['4 battute', 16], ['2 battute', 8], ['1 battuta', 4], ['1/2', 2], ['1/4.', 1.5], ['1/4', 1],
  ['1/4T', 2 / 3], ['1/8.', 0.75], ['1/8', 0.5], ['1/8T', 1 / 3], ['1/16', 0.25], ['1/16T', 1 / 6], ['1/32', 0.125],
];

/** L'indice di una velocità dal suo nome ("1/4", "2 battute"…). */
export const TEMPO_RATE = Object.fromEntries(TEMPO_RATES.map(([l], i) => [l, i])) as Readonly<Record<string, number>>;
