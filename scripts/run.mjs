// Runs one of the app's TypeScript scripts with modules resolved by Vite (same imports as src/):
//   node scripts/run.mjs scripts/build-acid-live.ts <arguments…>
// The script exports `main(args)`.
import { resolve } from 'node:path';
import { runnerImport } from 'vite';

const [entry, ...args] = process.argv.slice(2);
if (!entry) {
  console.error('usage: node scripts/run.mjs <script.ts> [arguments…]');
  process.exit(1);
}
const { module } = await runnerImport(resolve(entry));
await module.main(args);
