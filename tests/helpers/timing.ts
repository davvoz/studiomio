import { it } from 'vitest';

/** A test that measures speed: it runs only with `npm test` on this computer. Skipped with the
 *  coverage on (`npm run coverage`), where the code is instrumented and slower, and on GitHub's
 *  shared machines (CI), where the same code runs twice as slow on some days: there the measure
 *  would fail on the machine, not on the code. */
export const itTimed = it.skipIf(process.env.COVERAGE === '1' || process.env.CI === 'true');
