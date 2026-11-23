// node scripts/check-startup.mjs [app executable]
// Starts the desktop app as a user does and checks that it really comes up: the window opens, the
// app inside it starts, and no error is thrown while it loads (the devices' AudioWorklet included).
// Without an argument it starts the development build (`electron .`, after npm run build and
// npm run electron:build); the release passes the packaged app (release/win-unpacked/studiomio.exe).
// It never touches the user's installed studiomio: its own data folder, thrown away at the end.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9339;
const TIMEOUT = 90_000;   // a cold start on a shared CI machine
const SETTLE = 5000;      // after the app is up: the devices load in the background
const POLL = 250;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class StartupError extends Error {}

/** The app's process: the given executable, or Electron with this folder. */
function launch(executable, userData) {
  const dev = !executable;
  const program = executable ?? createRequire(import.meta.url)('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [...(dev ? ['.'] : []), `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`];
  return spawn(program, args, { env, stdio: 'inherit' });
}

/** Waits until `probe` gives a value, failing if the app closes or the time is up. */
async function until(what, probe, alive) {
  const end = Date.now() + TIMEOUT;
  while (Date.now() < end) {
    if (!alive()) throw new StartupError(`the app closed by itself while waiting for ${what}`);
    const value = await probe().catch(() => undefined);
    if (value) return value;
    await sleep(POLL);
  }
  throw new StartupError(`${what}: not within ${TIMEOUT / 1000} s`);
}

/** The app's page, as the DevTools protocol lists it. */
async function appPage() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json`);
  const pages = await response.json();
  return pages.find(p => p.type === 'page' && p.url.startsWith('app://'))?.webSocketDebuggerUrl;
}

/** A DevTools connection to the page: `send` a command, `errors` thrown or logged as errors. */
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new StartupError('no connection to the page')), { once: true });
  });
  const pending = new Map();
  const errors = [];
  let next = 0;
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id !== undefined) pending.get(message.id)?.(message);
    else if (message.method === 'Runtime.exceptionThrown') errors.push(exceptionText(message.params.exceptionDetails));
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(consoleText(message.params.args));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, message => {
      pending.delete(id);
      if (message.error) reject(new StartupError(`${method}: ${message.error.message}`));
      else resolve(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { send, errors, close: () => socket.close() };
}

const exceptionText = details => details.exception?.description ?? details.text;
const consoleText = args => args.map(a => a.value ?? a.description ?? a.type).join(' ');

/** True when the app is up: src/main.ts ran to the end and drew the interface. */
const STARTED = `Boolean(window.studiomio?.surfaces) && document.getElementById('app')?.childElementCount > 0`;

async function check(page, alive) {
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  // from the beginning with the listeners on: errors thrown before the connection count too
  await page.send('Page.reload', { ignoreCache: true });
  await until('the app inside the window', async () => {
    const { result } = await page.send('Runtime.evaluate', { expression: STARTED });
    return result.value === true;
  }, alive);
  await sleep(SETTLE);
  if (!alive()) throw new StartupError('the app closed by itself after starting');
  // the same message may come twice: Runtime.enable also replays those of the first load
  const errors = [...new Set(page.errors)];
  if (errors.length) throw new StartupError(`errors while starting:\n${errors.map(e => `  ${e}`).join('\n')}`);
}

async function main() {
  const userData = await mkdtemp(join(tmpdir(), 'studiomio-startup-'));
  const app = launch(process.argv[2], userData);
  let running = true;
  app.on('exit', () => { running = false; });
  const alive = () => running;
  let page;
  try {
    const url = await until('the app window', appPage, alive);
    page = await connect(url);
    await check(page, alive);
    console.log('startup: the app starts, without errors');
  } finally {
    page?.close();
    app.kill();
    await new Promise(resolve => (running ? app.once('exit', resolve) : resolve()));
    await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }).catch(() => {});
  }
}

main().catch(e => {
  console.error(`startup: FAILED: ${e instanceof StartupError ? e.message : e.stack}`);
  process.exit(1);
});
