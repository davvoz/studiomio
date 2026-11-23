// npm run lint [paths…]: the SonarCloud rules on the code (default: src scripts electron tests).
// The first time it installs its own tools here (tools/lint/node_modules). Only warnings: it
// fails only if the linter itself can't run.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../..', import.meta.url));
const shell = process.platform === 'win32';

if (!existsSync(`${here}node_modules/eslint`)) {
  console.log('lint: installing the lint tools in tools/lint (once)…');
  const install = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: here, stdio: 'inherit', shell });
  if (install.status !== 0) process.exit(install.status ?? 1);
}

const paths = process.argv.slice(2);
const eslint = spawnSync(process.execPath, [
  `${here}node_modules/eslint/bin/eslint.js`, '--no-config-lookup', '-c', `${here}eslint.config.mjs`,
  ...(paths.length ? paths : ['src', 'scripts', 'electron', 'tests']),
], { cwd: root, stdio: 'inherit' });
process.exit(eslint.status ?? 1);
