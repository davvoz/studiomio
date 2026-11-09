import { describe, expect, it } from 'vitest';
import { htmlToText, releaseNotesText } from '../../electron/release-notes';

// how GitHub renders the CHANGELOG.md section in the releases feed
const v018 = '<h3>New</h3>\n<ul>\n<li>Devices collapse (▾/▸)</li>\n<li>Faster import &amp; export</li>\n</ul>';
const v017 = '<h3>Fixes</h3>\n<ul>\n<li>Reverse no longer &quot;jumps&quot;</li>\n</ul>';

describe('htmlToText', () => {
  it('titles on one line, items with the bullet, entities decoded', () => {
    expect(htmlToText(v018)).toBe('New\n• Devices collapse (▾/▸)\n• Faster import & export');
  });

  it('in a loose list the text in the <p> stays on the bullet\'s line', () => {
    expect(htmlToText('<ul>\n<li>\n<p>First</p>\n</li>\n<li>\n<p>Second</p>\n</li>\n</ul>')).toBe('• First\n• Second');
  });

  it('line breaks, spaces and numeric entities', () => {
    expect(htmlToText('<p>one<br>two   three&#39;s &#x2014; end</p>')).toBe('one\ntwo three\'s — end');
  });
});

describe('releaseNotesText', () => {
  it('no notes, no text', () => {
    expect(releaseNotesText(null)).toBe('');
    expect(releaseNotesText(undefined)).toBe('');
    expect(releaseNotesText('')).toBe('');
    expect(releaseNotesText([])).toBe('');
  });

  it('a single version: without title, it\'s already in the message', () => {
    expect(releaseNotesText(v017)).toBe('Fixes\n• Reverse no longer "jumps"');
    expect(releaseNotesText([{ version: '0.1.8', note: v018 }, { version: '0.1.7', note: '' }]))
      .toBe(htmlToText(v018));
  });

  it('several versions: each with its number, separated by an empty line', () => {
    expect(releaseNotesText([{ version: '0.1.8', note: v018 }, { version: '0.1.7', note: v017 }])).toBe(
      `0.1.8\n${htmlToText(v018)}\n\n0.1.7\n${htmlToText(v017)}`,
    );
  });

  it('too many lines: it\'s cut with an ellipsis', () => {
    const long = `<ul>${Array.from({ length: 30 }, (_, i) => `<li>item ${i}</li>`).join('')}</ul>`;
    const lines = releaseNotesText(long).split('\n');
    expect(lines).toHaveLength(21);
    expect(lines.at(-2)).toBe('• item 19');
    expect(lines.at(-1)).toBe('…');
  });
});
