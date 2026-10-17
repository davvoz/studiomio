import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/** La versione dell'app (da package.json), mostrata nella barra di stato. */
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

// COOP + COEP rendono la pagina "cross-origin isolated": senza queste intestazioni il
// browser non concede SharedArrayBuffer (memoria condivisa tra interfaccia, worker e WASM).
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
    // i benchmark (lenti) girano solo con `npm run bench`
    include: process.env.BENCH ? ['tests/**/*.perf.ts'] : ['tests/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
