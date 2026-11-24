/* Which handle is under the pointer: the nearest within a radius. */

/** The item nearest to the pointer (`distance` measures it), if closer than `radius`; null if none.
 *  At equal distance the first one wins; with `inclusive` the last one, and the radius itself counts. */
export function nearest<T>(items: Iterable<T>, distance: (item: T) => number, radius: number, inclusive = false): T | null {
  let best: T | null = null, bestD = radius;
  for (const item of items) {
    const d = distance(item);
    if (inclusive ? d <= bestD : d < bestD) {
      best = item;
      bestD = d;
    }
  }
  return best;
}
