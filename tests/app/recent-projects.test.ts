import { describe, expect, it } from 'vitest';
import { MAX_RECENT, recentName, RecentProjects } from '../../src/app/recent-projects';
import { oneAtATime } from '../../src/core/async';

/** A fake folder: two handles are the same folder if they have the same name. */
const folder = (name: string) => ({ name, isSameEntry: async (o: { name: string }) => o.name === name }) as unknown as FileSystemDirectoryHandle;

describe('recent projects', () => {
  it('the most recent at the top, without duplicates, at most eight; they\'re removed and cleared', async () => {
    let changes = 0;
    const recent = new RecentProjects(() => changes++);
    await oneAtATime(['a', 'b', 'c'], async n => { await recent.add(folder(n)); });
    await recent.add(folder('a')); // reopened: it goes back to the top
    expect(recent.list.map(recentName)).toEqual(['a', 'c', 'b']);
    await oneAtATime(Array.from({ length: 10 }, (_, i) => `x${i}`), async n => { await recent.add(folder(n)); });
    expect(recent.list).toHaveLength(MAX_RECENT);
    expect(recentName(recent.list[0])).toBe('x9');
    await recent.remove(folder('x9'));
    expect(recentName(recent.list[0])).toBe('x8');
    await recent.clear();
    expect(recent.list).toEqual([]);
    expect(changes).toBeGreaterThan(0);
  });

  it('the desktop app remembers paths: the same folder whatever the case and the separators', async () => {
    const recent = new RecentProjects();
    await recent.add(folder('browser'));
    await recent.add('C:\\Musica\\Abisso NEW');
    await recent.add('C:\\Musica\\Cripta\\');
    await recent.add('c:/musica/abisso new');
    expect(recent.list.map(recentName)).toEqual(['abisso new', 'Cripta', 'browser']);
    await recent.remove('C:\\MUSICA\\CRIPTA');
    expect(recent.list.map(recentName)).toEqual(['abisso new', 'browser']);
  });
});
