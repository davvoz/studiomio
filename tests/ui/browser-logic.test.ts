import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserItem, BrowserSource } from '../../src/browser/item';
import type { MenuAction, MenuItem } from '../../src/ui/context-menu';
import { browserKey, itemMenu } from '../../src/ui/browser/browser-actions';
import { searchRows } from '../../src/ui/browser/browser-search';
import { BROWSER_DEFAULTS, clampWidth, loadSettings, saveSettings } from '../../src/ui/browser/browser-settings';
import { BrowserTree, message, rootKey, type ListRow, type Row } from '../../src/ui/browser/browser-tree';
import { columnPeaks, paintWave } from '../../src/ui/browser/browser-wave';
import { fakeContext } from '../helpers/canvas';

const flush = () => new Promise(r => setTimeout(r, 0));
const instrument = { kind: 'instrument', type: 'analog', preset: null } as const;
const item = (id: string, extra: Partial<BrowserItem> = {}): BrowserItem => ({ id, name: id, icon: 'preset', ...extra });
const folder = (id: string, children: BrowserItem[] | Error): BrowserItem =>
  item(id, { icon: 'folder', children: () => (children instanceof Error ? Promise.reject(children) : Promise.resolve(children)) });
const source = (id: string, items: BrowserItem[] | Error, extra: Partial<BrowserSource> = {}): BrowserSource => ({
  id, label: id.toUpperCase(), section: 'places',
  items: () => (items instanceof Error ? Promise.reject(items) : Promise.resolve(items)), ...extra,
});
const text = (rows: readonly Row[]) => rows.map(r => ('item' in r ? `${'  '.repeat(r.depth)}${r.item.id}` : `${'  '.repeat(r.depth)}(${r.note})`));
const actions = (items: MenuItem[]) => items.filter((i): i is MenuAction => typeof i !== 'string' && 'run' in i);
const label = (i: MenuItem) => (typeof i === 'string' ? '—' : (i as MenuAction).label);

describe('browser tree', () => {
  it('reads a source the first time it shows it, then the open folders under their items', async () => {
    let changed = 0;
    const tree = new BrowserTree(() => changed++);
    const s = source('s', [folder('s/a', [item('s/a/1'), folder('s/a/2', [])]), folder('s/b', new Error('gone')), item('s/c')]);
    const unlock = vi.fn();
    expect(text(tree.rows(s, unlock))).toEqual(['(Reading…)']);
    await flush();
    expect(changed).toBe(1);
    expect(text(tree.rows(s, unlock))).toEqual(['s/a', 's/b', 's/c']);
    tree.toggle('s/a');
    tree.toggle('s/b');
    expect(tree.isOpen('s/a')).toBe(true);
    tree.rows(s, unlock);
    await flush();
    tree.toggle('s/a/2');
    tree.rows(s, unlock);
    await flush();
    expect(text(tree.rows(s, unlock))).toEqual(['s/a', '  s/a/1', '  s/a/2', '    (Empty)', 's/b', '  (Can\'t read it: gone)', 's/c']);
    tree.toggle('s/a');
    expect(tree.isOpen('s/a')).toBe(false);
  });

  it('an empty source says its own notice; one that can\'t be read says why', async () => {
    const tree = new BrowserTree(() => {});
    const empty = source('e', [], { empty: 'Nothing yet' }), plain = source('p', []);
    const broken = { ...source('x', []), items: () => Promise.reject('no disk') } as BrowserSource;
    for (const s of [empty, plain, broken]) tree.rows(s, () => {});
    await flush();
    expect(text(tree.rows(empty, () => {}))).toEqual(['(Nothing yet)']);
    expect(text(tree.rows(plain, () => {}))).toEqual(['(Empty)']);
    expect(text(tree.rows(broken, () => {}))).toEqual(['(Can\'t read it: no disk)']);
  });

  it('a locked source asks for the permission; invalidating rereads it', async () => {
    let locked = true;
    const tree = new BrowserTree(() => {});
    const s = source('l', [item('l/k')], { locked: async () => locked });
    const unlock = vi.fn();
    tree.rows(s, unlock);
    await flush();
    const [note] = tree.rows(s, unlock);
    expect('note' in note && note.note).toBe('Reading this folder needs your permission.');
    if ('note' in note) note.action?.run();
    expect(unlock).toHaveBeenCalledWith(s);
    locked = false;
    tree.invalidate('l');
    tree.rows(s, unlock);
    await flush();
    expect(text(tree.rows(s, unlock))).toEqual(['l/k']);
  });

  it('invalidating drops the source\'s folders, not another source\'s', async () => {
    const reads: string[] = [];
    const tree = new BrowserTree(() => {});
    const make = (id: string) => ({ ...source(id, []), items: () => { reads.push(id); return Promise.resolve([folder(`${id}/f`, [item(`${id}/f/x`)])]); } });
    const a = make('a'), ab = make('ab');
    for (const s of [a, ab]) tree.rows(s, () => {});
    await flush();
    tree.invalidate('a');
    tree.rows(a, () => {});
    tree.rows(ab, () => {});
    expect(reads).toEqual(['a', 'ab', 'a']);
    expect(rootKey('a')).toBe('source:a');
    expect(message(new Error('x'))).toBe('x');
    expect(message(3)).toBe('3');
  });
});

describe('browser search', () => {
  it('the chosen source first, each result with where it is; nothing found; a source that can\'t be read', async () => {
    const a = source('a', [item('a/bass', { name: 'Bass', payload: instrument })]);
    const b = source('b', [folder('b/f', [item('b/f/bass', { name: 'Big bass', payload: { kind: 'effect', type: 'eq', preset: null } })])]);
    const rows = await searchRows([a, b], b, 'bass');
    expect(rows.map(r => 'item' in r && [r.item.id, r.path])).toEqual([['b/f/bass', ['B', 'b/f']], ['a/bass', ['A']]]);
    expect(await searchRows([a], a, 'zz')).toEqual([{ note: 'Nothing for «zz».', depth: 0 }]);
    expect(await searchRows([a, source('x', new Error('locked out'))], a, 'bass')).toEqual([{ note: 'Can\'t be read: locked out', depth: 0 }]);
  });
});

describe('browser keys and menu', () => {
  const rows: Row[] = [
    { item: folder('f', []), depth: 0 },
    { item: item('f/1', { payload: instrument }), depth: 1 },
    { item: item('f/2'), depth: 1 },
    { note: 'Reading…', depth: 1 },
    { item: item('g', { payload: instrument }), depth: 0 },
  ];
  const open = new Set(['f']);
  const key = (k: string, selected: string | null, list = rows) => browserKey(k, list, selected, id => open.has(id));
  const chosen = (k: string, selected: string | null) => {
    const a = key(k, selected);
    return a && 'item' in a ? `${a.kind} ${a.item.id}` : a?.kind;
  };

  it('the arrows, Home and End move through the items (skipping the notices)', () => {
    expect(chosen('ArrowDown', null)).toBe('select f');
    expect(chosen('ArrowDown', 'f/2')).toBe('select g');
    expect(chosen('ArrowDown', 'g')).toBe('select g');
    expect(chosen('ArrowUp', null)).toBe('select f');
    expect(chosen('ArrowUp', 'f')).toBe('search');
    expect(chosen('ArrowUp', 'g')).toBe('select f/2');
    expect(chosen('Home', 'g')).toBe('select f');
    expect(chosen('End', null)).toBe('select g');
    expect(key('ArrowDown', null, [{ note: 'Empty', depth: 0 }])).toEqual({ kind: 'none' });
    expect(key('x', 'f')).toBeNull();
  });

  it('→ opens or enters a folder, ← closes it or goes up; Enter loads or opens', () => {
    expect(chosen('ArrowRight', 'f')).toBe('select f/1');
    expect(chosen('ArrowRight', 'g')).toBe('none');
    expect(chosen('ArrowRight', null)).toBe('none');
    const closed = browserKey('ArrowRight', rows, 'f', () => false);
    expect(closed).toEqual({ kind: 'toggle', item: (rows[0] as ListRow).item });
    expect(chosen('ArrowLeft', 'f')).toBe('toggle f');
    expect(chosen('ArrowLeft', 'f/2')).toBe('select f');
    expect(chosen('ArrowLeft', 'g')).toBe('none');
    expect(chosen('ArrowLeft', null)).toBe('none');
    expect(chosen('Enter', 'g')).toBe('load g');
    expect(chosen('Enter', 'f')).toBe('toggle f');
    expect(chosen('Enter', 'f/2')).toBe('none');
  });

  it('search results are flat: → and ← do nothing on them', () => {
    const hits: Row[] = [{ item: folder('d', []), depth: 0, path: ['X'] }];
    expect(key('ArrowRight', 'd', hits)).toEqual({ kind: 'none' });
    expect(key('ArrowLeft', 'd', hits)).toEqual({ kind: 'none' });
  });

  it('the menu: load, listen, open or close (not for a search result)', () => {
    const calls: string[] = [];
    const a = (o: { open?: boolean; canListen?: boolean } = {}) => ({
      open: !!o.open, canListen: !!o.canListen, load: () => calls.push('load'), listen: () => calls.push('listen'), toggle: () => calls.push('toggle'),
    });
    const device = item('d', { payload: instrument, children: () => Promise.resolve([]) });
    const menu = itemMenu(device, false, a({ canListen: true }));
    expect(menu.map(label)).toEqual(['Load', 'Listen', '—', 'Open']);
    actions(menu).forEach(i => i.run());
    expect(calls).toEqual(['load', 'listen', 'toggle']);
    expect(actions(itemMenu(folder('f', []), false, a({ open: true }))).map(i => [i.label, i.shortcut])).toEqual([['Close', '◂']]);
    expect(itemMenu(device, true, a())).toHaveLength(1);
  });
});

describe('browser settings', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('saved and read back; what\'s missing or wrong takes the default; the width stays in its limits', () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => kept.set(k, v) });
    expect(loadSettings()).toEqual(BROWSER_DEFAULTS);
    saveSettings({ open: false, width: 400, source: 'effects', preview: false });
    expect(loadSettings()).toEqual({ open: false, width: 400, source: 'effects', preview: false });
    kept.set('studiomio.browser', JSON.stringify({ open: 'yes', width: 9999, source: 3 }));
    expect(loadSettings()).toEqual({ ...BROWSER_DEFAULTS, width: 640 });
    kept.set('studiomio.browser', '{not json');
    expect(loadSettings()).toEqual(BROWSER_DEFAULTS);
    expect([clampWidth(10), clampWidth(300), clampWidth(1000)]).toEqual([250, 300, 640]);
  });
});

describe('browser waveform', () => {
  it('the peaks of a range, looking at 64 samples at most, never above 0 or below it', () => {
    const ch = Float32Array.from({ length: 1000 }, (_, i) => (i === 500 ? 0.9 : -0.25 * (i % 2)));
    expect(columnPeaks([ch], 0, 10)).toEqual([-0.25, 0]);
    expect(columnPeaks([new Float32Array([0.5, 0.2])], 0, 2)).toEqual([0, 0.5]);
    const [, hi] = columnPeaks([ch], 0, 1000);
    expect(hi).toBe(0);
  });

  it('a bar per column in the accent colour; without audio only cleared', () => {
    const g = fakeContext(), color = vi.fn(() => '#abc');
    paintWave(g, 4, 10, [], color);
    expect(g.calls).toEqual(['clearRect']);
    expect(color).not.toHaveBeenCalled();
    paintWave(g, 4, 10, [new Float32Array([1, -1, 0.5, 0])], color);
    expect(g.calls.filter(c => c === 'fillRect')).toHaveLength(4);
    expect(g.fillStyle).toBe('#abc');
  });
});
