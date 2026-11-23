import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/** The app's version (from package.json), shown in the status bar. */
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

// COOP + COEP make the page "cross-origin isolated": without these headers the
// browser doesn't grant SharedArrayBuffer (memory shared between interface, workers and WASM).
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: 'index.html', bench: 'bench.html' } },
  },
  test: {
    // the (slow) benchmarks run only with `npm run bench`
    include: process.env.BENCH ? ['tests/**/*.perf.ts'] : ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    // `npm run coverage` (SonarCloud reads coverage/lcov.info): which code the tests run
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text-summary'],
      include: ['src/**/*.ts', 'electron/**/*.ts', 'scripts/**/*.ts'],
      exclude: ['src/dsp/wasm/pkg/**'],
      // the report is written even if a test fails: SonarCloud still gets the coverage
      reportOnFailure: true,
    },
  },
});
