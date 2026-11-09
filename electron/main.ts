// Electron main process: opens the app window, serves the files in `dist/`, keeps the
// user's preset and rack files, logs where the app hangs and checks for updates
// on GitHub Releases. The app itself (src/) doesn't change.
import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell, type IpcMainInvokeEvent } from 'electron';
import updater from 'electron-updater';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { loadPresets, removePreset, savePreset, type StoredPreset } from './presets.js';
import { loadRacks, removeRack, saveRack, type StoredRack } from './racks.js';
import { releaseNotesText } from './release-notes.js';

const { autoUpdater } = updater;

// The app is served from an internal protocol instead of file://: that way it's a secure origin,
// with workers, AudioWorklet and fetch working as in the browser.
const SCHEME = 'app';
const ORIGIN = `${SCHEME}://studiomio`;
const ROOT = join(import.meta.dirname, '..', 'dist');

// As in vite.config.ts: without COOP + COEP there's no SharedArrayBuffer.
const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  // when the window doesn't respond we can ask where the code is running (see watchHangs)
  'Document-Policy': 'include-js-call-stacks-in-crash-reports',
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wav': 'audio/wav',
};

app.commandLine.appendSwitch('enable-features', 'DocumentPolicyIncludeJSCallStacksInCrashReports');

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
}]);

async function serve(request: Request): Promise<Response> {
  const path = decodeURIComponent(new URL(request.url).pathname);
  const file = normalize(join(ROOT, path === '/' ? 'index.html' : path));
  if (!file.startsWith(ROOT + sep)) return new Response(null, { status: 403 });
  try {
    const body = await readFile(file);
    return new Response(body, {
      headers: { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', ...ISOLATION },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#121417',
    autoHideMenuBar: true,
    webPreferences: { preload: join(import.meta.dirname, 'preload.cjs') },
  });
  win.removeMenu();
  // the app blocks closing if there are unsaved changes: here we ask whether to quit anyway
  win.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Quit without saving', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
      title: 'Unsaved changes', message: 'There are unsaved changes.', detail: 'If you quit now they will be lost.',
    });
    if (choice === 0) event.preventDefault();
  });
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  // Only the app runs in the window: external links open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) event.preventDefault();
  });

  // F12 opens the developer tools, useful to understand a user's problem.
  win.webContents.on('before-input-event', (_, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });

  watchHangs(win);
  void win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

/** When the window stops responding (a computation that never ends) or closes by itself,
 *  logs in Documents/studiomio/Blocchi where the code was running: it tells what to fix. */
function watchHangs(win: BrowserWindow): void {
  const dir = join(app.getPath('documents'), 'studiomio', 'Blocchi');
  const note = async (what: string, detail: string) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${stamp}.txt`), [what, `studiomio ${app.getVersion()} · ${new Date().toString()}`, '', detail, ''].join('\n'));
  };
  win.on('unresponsive', () => {
    // if no code is running at that moment the promise never arrives: wait briefly
    const stack = Promise.race([
      win.webContents.mainFrame.collectJavaScriptCallStack().then(s => s || '(stack not available)'),
      new Promise<string>(resolve => setTimeout(() => resolve('(no code running)'), 5000)),
    ]);
    void stack.then(s => note('The window is not responding.', s)).catch(e => console.warn('hangs:', e));
  });
  win.webContents.on('render-process-gone', (_, details) => {
    void note('The window closed by itself.', JSON.stringify(details, null, 2)).catch(e => console.warn('hangs:', e));
  });
}

/** The user's presets and racks: files in Documents, so they survive uninstalling the app
 *  or clearing its data, and can be copied by hand to another computer. */
function handlePresets(): void {
  const root = join(app.getPath('documents'), 'studiomio', 'Preset');
  const rackRoot = join(app.getPath('documents'), 'studiomio', 'Rack');
  const text = (v: unknown): string => {
    if (typeof v !== 'string' || !v) throw new TypeError('expected text');
    return v;
  };
  const preset = (v: unknown): StoredPreset => {
    const { type, name, params } = (v ?? {}) as Record<string, unknown>;
    if (!params || typeof params !== 'object') throw new TypeError('expected parameters');
    return { type: text(type), name: text(name), params: params as Record<string, number> };
  };
  const rack = (v: unknown): StoredRack => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new TypeError('expected a rack');
    return { ...(v as Record<string, unknown>), name: text((v as Record<string, unknown>).name) };
  };
  const reveal = async (dir: string) => {
    await mkdir(dir, { recursive: true });
    const error = await shell.openPath(dir);
    if (error) throw new Error(error);
  };
  // answers only the app, not pages from another origin
  const handle = (channel: string, run: (...args: unknown[]) => Promise<unknown>) =>
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!event.senderFrame?.url.startsWith(ORIGIN)) throw new Error('origin not allowed');
      return run(...args);
    });
  handle('presets:load', () => loadPresets(root));
  handle('presets:save', (folder, p) => savePreset(root, text(folder), preset(p)));
  handle('presets:remove', (type, name) => removePreset(root, text(type), text(name)));
  handle('presets:reveal', () => reveal(root));
  handle('racks:load', () => loadRacks(rackRoot));
  handle('racks:save', r => saveRack(rackRoot, rack(r)));
  handle('racks:remove', name => removeRack(rackRoot, text(name)));
  handle('racks:reveal', () => reveal(rackRoot));
}

/** Looks for a new version at startup: downloads it in the background and offers to restart. */
function checkForUpdates(win: BrowserWindow): void {
  if (!app.isPackaged) return;
  // the notes of all the skipped versions, not just the latest
  autoUpdater.fullChangelog = true;
  autoUpdater.on('update-downloaded', async ({ version, releaseNotes }) => {
    const notes = releaseNotesText(releaseNotes);
    const install = 'Restart now to install it, or it will be installed when you close the app.';
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update available',
      message: `studiomio version ${version} is ready.`,
      detail: notes ? `${notes}\n\n${install}` : install,
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  // Without network or without releases the app works as always: the error is ignored.
  autoUpdater.on('error', err => console.warn('updates:', err.message));
  autoUpdater.checkForUpdates().catch(() => {});
}

// A single instance: a second launch brings the already open window to the front.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win: BrowserWindow | null = null;
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  void app.whenReady().then(() => {
    protocol.handle(SCHEME, serve);
    handlePresets();
    // MIDI (APC40), project folders and the rest: granted only to the app itself.
    const ours = (url: string) => url.startsWith(ORIGIN);
    session.defaultSession.setPermissionRequestHandler((wc, _permission, callback) => callback(ours(wc.getURL())));
    session.defaultSession.setPermissionCheckHandler((_wc, _permission, origin) => ours(origin));
    win = createWindow();
    checkForUpdates(win);
  });

  app.on('window-all-closed', () => app.quit());
}
