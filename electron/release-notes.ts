// Le novità di un aggiornamento come testo per la finestra di dialogo. electron-updater le
// prende dal feed delle release di GitHub, in HTML: una stringa, o una per versione con
// autoUpdater.fullChangelog (le versioni tra quella installata e la nuova).

export type ReleaseNotes =
  | string
  | ReadonlyArray<{ readonly version: string; readonly note: string | null }>
  | null
  | undefined;

/** Oltre queste righe la finestra diventa troppo alta: il resto è nelle release su GitHub. */
const MAX_LINES = 20;

/** Il testo delle novità, vuoto se non ce ne sono; con più versioni ognuna ha il suo titolo. */
export function releaseNotesText(notes: ReleaseNotes): string {
  if (!notes) return '';
  const versions = typeof notes === 'string'
    ? [{ version: '', text: htmlToText(notes) }]
    : notes.map(({ version, note }) => ({ version, text: htmlToText(note ?? '') }));
  const filled = versions.filter(v => v.text);
  const lines = filled
    .map(({ version, text }) => (filled.length > 1 ? `${version}\n${text}` : text))
    .join('\n\n')
    .split('\n');
  return lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), '…'].join('\n') : lines.join('\n');
}

/** Dall'HTML delle release (titoli, paragrafi, elenchi) a righe di testo con i punti elenco. */
export function htmlToText(html: string): string {
  const lines = html
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>|<\/(p|h\d|li|ul|ol|div)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(lt|gt|quot|apos|nbsp|amp);/g, (_, name: string) => ENTITIES[name])
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  // in un elenco "largo" il testo della voce è in un <p>: il punto resta da solo su una riga
  return lines.reduce<string[]>((out, line) => {
    if (out.at(-1) === '•') out[out.length - 1] = `• ${line}`;
    else out.push(line);
    return out;
  }, []).join('\n');
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', amp: '&' };
