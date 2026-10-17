// Il CHANGELOG.md nelle release:
//   node scripts/changelog.mjs check          "Unreleased" deve avere almeno una voce
//   node scripts/changelog.mjs release        le voci di "Unreleased" vanno alla versione
//                                             di package.json, con la data di oggi
//   node scripts/changelog.mjs notes 0.1.8    stampa le voci di quella versione (testo della
//                                             release su GitHub)
// check e release girano da soli con npm version (preversion e version in package.json).
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../CHANGELOG.md', import.meta.url);
const UNRELEASED = 'Unreleased';

const [command, arg] = process.argv.slice(2);
const lines = readFileSync(FILE, 'utf8').split(/\r?\n/);

/** Le righe della sezione "## [nome]", fino alla sezione successiva. */
function section(name) {
  const start = lines.findIndex(line => line.startsWith(`## [${name}]`));
  if (start < 0) return null;
  const next = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  return { start, body: lines.slice(start + 1, next < 0 ? lines.length : next) };
}

/** Le voci vere: senza righe vuote e senza i titoli delle sottosezioni. */
const entries = body => body.filter(line => line.trim() && !line.startsWith('#'));

function fail(message) {
  console.error(`CHANGELOG.md: ${message}`);
  process.exit(1);
}

const unreleased = section(UNRELEASED);
switch (command) {
  case 'check':
    if (!unreleased) fail(`manca la sezione "## [${UNRELEASED}]".`);
    if (!entries(unreleased.body).length)
      fail(`nessuna voce sotto "${UNRELEASED}": scrivi le novità della release e committale.`);
    break;

  case 'release': {
    if (!unreleased) fail(`manca la sezione "## [${UNRELEASED}]".`);
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    if (section(version)) fail(`la versione ${version} c'è già.`);
    const today = new Date().toLocaleDateString('sv'); // AAAA-MM-GG, ora locale
    lines.splice(unreleased.start, 1, `## [${UNRELEASED}]`, '', `## [${version}] - ${today}`);
    writeFileSync(FILE, lines.join('\n'));
    console.log(`CHANGELOG.md: voci assegnate alla ${version}.`);
    break;
  }

  case 'notes': {
    const found = arg && section(arg);
    if (!found) fail(`manca la sezione della versione ${arg ?? '(nessuna)'}.`);
    // nelle release GitHub ogni a capo è un a capo: le righe rientrate continuano la voce sopra
    const joined = found.body.reduce((out, line) => {
      if (/^\s+\S/.test(line) && out.length && out.at(-1).trim()) out[out.length - 1] += ` ${line.trim()}`;
      else out.push(line);
      return out;
    }, []);
    console.log(joined.join('\n').trim());
    break;
  }

  default:
    fail('uso: node scripts/changelog.mjs check | release | notes <versione>');
}
