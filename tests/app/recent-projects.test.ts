import { describe, expect, it } from 'vitest';
import { MAX_RECENT, RecentProjects } from '../../src/app/recent-projects';

/** Una cartella finta: due handle sono la stessa cartella se hanno lo stesso nome. */
const folder = (name: string) => ({ name, isSameEntry: async (o: { name: string }) => o.name === name }) as unknown as FileSystemDirectoryHandle;

describe('progetti recenti', () => {
  it('la più recente in cima, senza doppioni, al massimo otto; si tolgono e si svuotano', async () => {
    let changes = 0;
    const recent = new RecentProjects(() => changes++);
    for (const n of ['a', 'b', 'c']) await recent.add(folder(n));
    await recent.add(folder('a')); // riaperta: torna in cima
    expect(recent.list.map(h => h.name)).toEqual(['a', 'c', 'b']);
    for (let i = 0; i < 10; i++) await recent.add(folder(`x${i}`));
    expect(recent.list).toHaveLength(MAX_RECENT);
    expect(recent.list[0].name).toBe('x9');
    await recent.remove(folder('x9'));
    expect(recent.list[0].name).toBe('x8');
    await recent.clear();
    expect(recent.list).toEqual([]);
    expect(changes).toBeGreaterThan(0);
  });
});
