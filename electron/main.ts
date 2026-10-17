// Processo principale di Electron: apre la finestra dell'app, serve i file di `dist/` e
// controlla gli aggiornamenti su GitHub Releases. L'app vera e propria (src/) non cambia.
import { app, BrowserWindow, dialog, protocol, session, shell } from 'electron';
import updater from 'electron-updater';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { releaseNotesText } from './release-notes.js';

const { autoUpdater } = updater;

// L'app è servita da un protocollo interno invece che da file://: così è un'origine sicura,
// con worker, AudioWorklet e fetch che funzionano come nel browser.
const SCHEME = 'app';
const ORIGIN = `${SCHEME}://studiomio`;
const ROOT = join(import.meta.dirname, '..', 'dist');

// Come in vite.config.ts: senza COOP + COEP niente SharedArrayBuffer.
const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
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
  });
  win.removeMenu();
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  // Solo l'app gira nella finestra: i link esterni si aprono nel browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) event.preventDefault();
  });

  // F12 apre gli strumenti per sviluppatori, utili per capire un problema da un utente.
  win.webContents.on('before-input-event', (_, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });

  void win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

/** Cerca una nuova versione all'avvio: la scarica in background e propone di riavviare. */
function checkForUpdates(win: BrowserWindow): void {
  if (!app.isPackaged) return;
  // le novità di tutte le versioni saltate, non solo dell'ultima
  autoUpdater.fullChangelog = true;
  autoUpdater.on('update-downloaded', async ({ version, releaseNotes }) => {
    const notes = releaseNotesText(releaseNotes);
    const install = 'Riavvia ora per installarla, oppure verrà installata quando chiudi l\'app.';
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Aggiornamento disponibile',
      message: `La versione ${version} di studiomio è pronta.`,
      detail: notes ? `${notes}\n\n${install}` : install,
      buttons: ['Riavvia ora', 'Più tardi'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  // Senza rete o senza release l'app funziona come sempre: l'errore si ignora.
  autoUpdater.on('error', err => console.warn('aggiornamenti:', err.message));
  autoUpdater.checkForUpdates().catch(() => {});
}

// Una sola istanza: un secondo avvio riporta in primo piano la finestra già aperta.
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
    // MIDI (APC40), cartelle dei progetti e il resto: concessi solo all'app stessa.
    const ours = (url: string) => url.startsWith(ORIGIN);
    session.defaultSession.setPermissionRequestHandler((wc, _permission, callback) => callback(ours(wc.getURL())));
    session.defaultSession.setPermissionCheckHandler((_wc, _permission, origin) => ours(origin));
    win = createWindow();
    checkForUpdates(win);
  });

  app.on('window-all-closed', () => app.quit());
}
