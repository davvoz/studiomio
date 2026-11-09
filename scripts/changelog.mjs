// CHANGELOG.md in releases:
//   node scripts/changelog.mjs check          "Unreleased" must have at least one entry
//   node scripts/changelog.mjs release        the "Unreleased" entries go to the package.json
//                                             version, with today's date
//   node scripts/changelog.mjs notes 0.1.8    prints the entries of that version (text of the
//                                             GitHub release)
// check and release run by themselves with npm version (preversion and version in package.json).
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../CHANGELOG.md', import.meta.url);
const UNRELEASED = 'Unreleased';

const [command, arg] = process.argv.slice(2);
const lines = readFileSync(FILE, 'utf8').split(/\r?\n/);

/** The lines of the "## [name]" section, up to the next section. */
function section(name) {
  const start = lines.findIndex(line => line.startsWith(`## [${name}]`));
  if (start < 0) return null;
  const next = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  return { start, body: lines.slice(start + 1, next < 0 ? lines.length : next) };
}

/** The real entries: without empty lines and without the subsection titles. */
const entries = body => body.filter(line => line.trim() && !line.startsWith('#'));

function fail(message) {
  console.error(`CHANGELOG.md: ${message}`);
  process.exit(1);
}

const unreleased = section(UNRELEASED);
switch (command) {
  case 'check':
    if (!unreleased) fail(`the "## [${UNRELEASED}]" section is missing.`);
    if (!entries(unreleased.body).length)
      fail(`no entries under "${UNRELEASED}": write the release notes and commit them.`);
    break;

  case 'release': {
    if (!unreleased) fail(`the "## [${UNRELEASED}]" section is missing.`);
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    if (section(version)) fail(`version ${version} already exists.`);
    const today = new Date().toLocaleDateString('sv'); // YYYY-MM-DD, local time
    lines.splice(unreleased.start, 1, `## [${UNRELEASED}]`, '', `## [${version}] - ${today}`);
    writeFileSync(FILE, lines.join('\n'));
    console.log(`CHANGELOG.md: entries assigned to ${version}.`);
    break;
  }

  case 'notes': {
    const found = arg && section(arg);
    if (!found) fail(`the section for version ${arg ?? '(none)'} is missing.`);
    // in GitHub releases every newline is a newline: indented lines continue the entry above
    const joined = found.body.reduce((out, line) => {
      if (/^\s+\S/.test(line) && out.length && out.at(-1).trim()) out[out.length - 1] += ` ${line.trim()}`;
      else out.push(line);
      return out;
    }, []);
    console.log(joined.join('\n').trim());
    break;
  }

  default:
    fail('usage: node scripts/changelog.mjs check | release | notes <version>');
}
