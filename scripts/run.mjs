// Esegue uno script TypeScript dell'app con i moduli risolti da Vite (stessi import di src/):
//   node scripts/run.mjs scripts/build-acid-live.ts <argomenti…>
// Lo script esporta `main(args)`.
import { resolve } from 'node:path';
import { runnerImport } from 'vite';

const [entry, ...args] = process.argv.slice(2);
if (!entry) {
  console.error('uso: node scripts/run.mjs <script.ts> [argomenti…]');
  process.exit(1);
}
const { module } = await runnerImport(resolve(entry));
await module.main(args);
