import { it } from 'vitest';

const skipped = process.env.COVERAGE === '1' || process.env.CI === 'true';

/** A test that measures speed: it runs only with `npm test` on this computer. Skipped with the
 *  coverage on (`npm run coverage`), where the code is instrumented and slower, and on GitHub's
 *  shared machines (CI), where the same code runs twice as slow on some days: there the measure
 *  would fail on the machine, not on the code. Tried up to three times: the other test files run
 *  at the same time and can slow one measure down, while code that is really slower fails all three. */
export const itTimed = (name: string, fn: () => void | Promise<void>) => it.skipIf(skipped)(name, { retry: 2 }, fn);
