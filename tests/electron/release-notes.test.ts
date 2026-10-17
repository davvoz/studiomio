import { describe, expect, it } from 'vitest';
import { htmlToText, releaseNotesText } from '../../electron/release-notes';

// come GitHub rende la sezione del CHANGELOG.md nel feed delle release
const v018 = '<h3>Novità</h3>\n<ul>\n<li>I dispositivi si comprimono (▾/▸)</li>\n<li>Import &amp; export più veloci</li>\n</ul>';
const v017 = '<h3>Correzioni</h3>\n<ul>\n<li>Il reverse non &quot;salta&quot; più</li>\n</ul>';

describe('htmlToText', () => {
  it('titoli su una riga, voci con il punto elenco, entità decodificate', () => {
    expect(htmlToText(v018)).toBe('Novità\n• I dispositivi si comprimono (▾/▸)\n• Import & export più veloci');
  });

  it('in un elenco largo il testo nel <p> resta sulla riga del punto', () => {
    expect(htmlToText('<ul>\n<li>\n<p>Prima</p>\n</li>\n<li>\n<p>Seconda</p>\n</li>\n</ul>')).toBe('• Prima\n• Seconda');
  });

  it('a capo, spazi ed entità numeriche', () => {
    expect(htmlToText('<p>una<br>due   tre&#39;s &#x2014; fine</p>')).toBe('una\ndue tre\'s — fine');
  });
});

describe('releaseNotesText', () => {
  it('niente note, niente testo', () => {
    expect(releaseNotesText(null)).toBe('');
    expect(releaseNotesText(undefined)).toBe('');
    expect(releaseNotesText('')).toBe('');
    expect(releaseNotesText([])).toBe('');
  });

  it('una sola versione: senza titolo, è già nel messaggio', () => {
    expect(releaseNotesText(v017)).toBe('Correzioni\n• Il reverse non "salta" più');
    expect(releaseNotesText([{ version: '0.1.8', note: v018 }, { version: '0.1.7', note: '' }]))
      .toBe(htmlToText(v018));
  });

  it('più versioni: ognuna con il suo numero, separate da una riga vuota', () => {
    expect(releaseNotesText([{ version: '0.1.8', note: v018 }, { version: '0.1.7', note: v017 }])).toBe(
      `0.1.8\n${htmlToText(v018)}\n\n0.1.7\n${htmlToText(v017)}`,
    );
  });

  it('troppe righe: si taglia con i puntini', () => {
    const long = `<ul>${Array.from({ length: 30 }, (_, i) => `<li>voce ${i}</li>`).join('')}</ul>`;
    const lines = releaseNotesText(long).split('\n');
    expect(lines).toHaveLength(21);
    expect(lines.at(-2)).toBe('• voce 19');
    expect(lines.at(-1)).toBe('…');
  });
});
