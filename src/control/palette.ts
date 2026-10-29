/* La tavolozza dei pad RGB dei controller: l'APC40 mkII e i Launchpad (X, Mini MK3, Pro MK3,
 * MK2) hanno la stessa, 128 colori scelti dalla velocity di un Note On (o dal valore di un CC).
 * Dalla tavolozza di Live (script novation/colors e APC40_MkII), con il colore di una clip
 * portato al pad della tinta più vicina. Dati e conti puri. */

/** La tavolozza: l'indice è il valore da mandare (0 = spento). */
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

/** Il bianco: dove un colore non si legge. */
const WHITE = 3;

const rgb = (c: number) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff] as const;

/** I colori abbastanza luminosi da riconoscersi su un pad (i più scuri sembrano spenti). */
const BRIGHT = PALETTE.map((c, i) => [i, rgb(c)] as const).filter(([i, [r, g, b]]) => i > 3 && Math.max(r, g, b) >= 0x99);

/** I colori della tavolozza di studiomio (model/colors), ognuno sul suo pad scelto a mano come
 *  fa Live: tutti diversi, e il carico e il tenue della stessa tinta si distinguono. */
export const FIXED: ReadonlyMap<string, number> = new Map([
  // carichi
  ['#f03c46', 5], ['#ff6a14', 9], ['#ffd60a', 13], ['#a8e01e', 74], ['#2ec944', 21], ['#00c98d', 77], ['#00b4e6', 37],
  ['#3f7cff', 41], ['#9a5cff', 81], ['#e632d8', 53], ['#ff3c82', 57], ['#c0702e', 126], ['#e8eaed', 3],
  // tenui
  ['#ef6b6b', 4], ['#ff9d2e', 96], ['#ffd64a', 12], ['#d4e157', 113], ['#9ad85b', 16], ['#4fcf9a', 32], ['#4bc3d6', 36],
  ['#5b8def', 40], ['#9b7bf0', 48], ['#e36bd0', 52], ['#ff7aa8', 56], ['#c8a27a', 8], ['#8fa3b8', 119],
]);

const cache = new Map<string, number>(FIXED);

/** Il pad di un colore "#rrggbb" (di una clip, una traccia, una scena): quello fisso per i colori
 *  della tavolozza, se no il più vicino portato alla luminosità piena: sui pad conta la tinta,
 *  non quanto è scuro. */
export function paletteIndex(hex: string): number {
  const known = cache.get(hex.toLowerCase());
  if (known !== undefined) return known;
  const n = Number.parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(n)) return WHITE;
  const [r, g, b] = rgb(n);
  const top = Math.max(r, g, b, 1);
  const [R, G, B] = [r, g, b].map(v => (v * 255) / top);
  let best = WHITE, distance = Infinity;
  for (const [i, [pr, pg, pb]] of BRIGHT) {
    // pesi della luminosità percepita: il verde conta di più
    const d = 2 * (R - pr) ** 2 + 4 * (G - pg) ** 2 + 3 * (B - pb) ** 2;
    if (d < distance) [best, distance] = [i, d];
  }
  cache.set(hex.toLowerCase(), best);
  return best;
}
