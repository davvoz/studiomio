// An update's release notes as text for the dialog. electron-updater takes them
// from the GitHub releases feed, in HTML: one string, or one per version with
// autoUpdater.fullChangelog (the versions between the installed one and the new one).

export type ReleaseNotes =
  | string
  | ReadonlyArray<{ readonly version: string; readonly note: string | null }>
  | null
  | undefined;

/** Beyond these lines the dialog gets too tall: the rest is in the releases on GitHub. */
const MAX_LINES = 20;

/** The text of the notes, empty if there are none; with several versions each has its own title. */
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

/** From the releases' HTML (titles, paragraphs, lists) to lines of text with bullet points. */
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
    // in a "loose" list the item's text is in a <p>: the bullet stays alone on a line
  return lines.reduce<string[]>((out, line) => {
    if (out.at(-1) === '•') out[out.length - 1] = `• ${line}`;
    else out.push(line);
    return out;
  }, []).join('\n');
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', amp: '&' };
