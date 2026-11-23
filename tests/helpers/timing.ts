import { it } from 'vitest';

/** A test that measures speed: skipped with the coverage on (`npm run coverage`), where the code
 *  is instrumented and slower and the measure would mean nothing. `npm test` runs it as always. */
export const itTimed = it.skipIf(process.env.COVERAGE === '1');
