/* The browser, on the left as in Live: the search at the top, the sources (categories and places) in a
 * column, their content as a tree next to it, the sample preview at the bottom. A click chooses
 * an item (and plays the sample, with 🎧 on), a double click or Enter loads it where you're
 * working, dragging it takes it to a track, a slot or the device chain. The
 * browser doesn't know what a track is: loading and preview belong to the app (`BrowserViewDeps`).
 * This is the DOM: the tree is in browser-tree, the keys and the menu in browser-actions, the search's
 * rows in browser-search, the remembered settings in browser-settings, the waveform in browser-wave. */
import type { BrowserCatalog } from '../../browser/catalog';
import type { BrowserItem, BrowserPayload, BrowserSource } from '../../browser/item';
import type { AudioData } from '../../dsp/types';
import { showContextMenu, type MenuItem } from '../context-menu';
import { el } from '../dom';
import { browserKey, itemMenu, type BrowserAction } from './browser-actions';
import { endBrowserDrag, startBrowserDrag } from './browser-drag';
import { searchRows } from './browser-search';
import { clampWidth, loadSettings, saveSettings, type BrowserSettings } from './browser-settings';
import { BrowserTree, message, type Row } from './browser-tree';
import { paintWave } from './browser-wave';

/** Previewing samples (the app does it with its audio context). */
export interface BrowserPreview {
  /** The audio of an item to preview (a project sample, a file), or null. */
  audio(payload: BrowserPayload): Promise<AudioData | null>;
  play(audio: AudioData): void;
  stop(): void;
}

export interface BrowserViewDeps {
  readonly catalog: BrowserCatalog;
  /** Loads the item where you're working (double click, Enter). */
  readonly load: (item: BrowserItem) => void;
  /** Lets the user choose a disk folder and adds it to the places; null if they give up. */
  readonly addFolder: () => Promise<BrowserSource | null>;
  readonly preview?: BrowserPreview;
  readonly say: (text: string) => void;
}

const ICONS: Readonly<Record<BrowserItem['icon'], string>> = {
  instrument: '♫', effect: '≋', preset: '◦', 'user-preset': '★', rack: '▦', sample: '∿', folder: '▤',
};

export class BrowserView {
  readonly element = el('aside', { className: 'browser' });
  private readonly searchInput = el<HTMLInputElement>('input', {
    type: 'search', className: 'browser-search', placeholder: 'Search (Ctrl+F)', spellcheck: false,
  });
  private readonly sourceList = el('nav', { className: 'browser-sources' });
  private readonly list = el('div', { className: 'browser-list', tabIndex: 0 });
  private readonly previewToggle = el<HTMLButtonElement>('button', { className: 'mini browser-preview-toggle', textContent: '🎧' });
  private readonly previewName = el('span', { className: 'browser-preview-name muted', textContent: 'Choose a sample to hear it' });
  private readonly wave = el<HTMLCanvasElement>('canvas', { className: 'browser-wave' });
  private settings: BrowserSettings;
  private readonly tree = new BrowserTree(() => this.renderList());
  private selected: string | null = null;
  private rows: Row[] = [];
  /** The search results (null: no search, the tree is shown). */
  private hits: Row[] | null = null;
  private searchRun = 0;
  private previewRun = 0;
  private readonly unsubscribe = new Map<string, () => void>();

  constructor(private readonly deps: BrowserViewDeps) {
    this.settings = loadSettings();
    const resize = el('div', { className: 'browser-resize', title: 'Drag to widen or narrow the browser' });
    this.bindResize(resize);
    this.previewToggle.onclick = () => this.setPreview(!this.settings.preview);
    this.element.append(
      el('div', { className: 'browser-top' }, this.searchInput),
      el('div', { className: 'browser-body' }, this.sourceList, this.list),
      el('footer', { className: 'browser-preview' }, el('div', { className: 'browser-preview-head' }, this.previewToggle, this.previewName), this.wave),
      resize,
    );
    this.bindSearch();
    this.bindList();
    deps.catalog.onChange(() => this.renderSources());
    this.element.style.width = `${this.settings.width}px`;
    this.element.hidden = !this.settings.open;
    this.setPreview(this.settings.preview);
    this.renderSources();
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  show(open: boolean): void {
    this.element.hidden = !open;
    this.save({ open });
    if (!open) this.deps.preview?.stop();
  }

  toggle(): void {
    this.show(!this.isOpen);
  }

  /** Ctrl+F: opens the browser and brings the cursor into the search. */
  focusSearch(): void {
    this.show(true);
    this.searchInput.focus();
    this.searchInput.select();
  }

  /** The source chosen on the left (for automated tests). */
  get source(): BrowserSource | undefined {
    return this.deps.catalog.source(this.settings.source) ?? this.deps.catalog.sources[0];
  }

  /** Chooses a source on the left and shows its content. */
  selectSource(id: string): void {
    if (!this.deps.catalog.source(id)) return;
    this.save({ source: id });
    this.selected = null;
    this.renderSources();
    if (this.searchInput.value.trim()) this.runSearch();
  }

  // ---------------------------------------------------------------- sources

  private renderSources(): void {
    const { catalog } = this.deps;
    const current = this.source;
    // each source is reread when it changes (a preset saved, a sample imported)
    for (const s of catalog.sources) {
      if (this.unsubscribe.has(s.id) || !s.onChange) continue;
      this.unsubscribe.set(s.id, s.onChange(() => this.invalidate(s.id)));
    }
    for (const [id, off] of this.unsubscribe) if (!catalog.source(id)) { off(); this.unsubscribe.delete(id); }
    const button = (s: BrowserSource) => {
      const b = el<HTMLButtonElement>('button', { className: `browser-source${s === current ? ' on' : ''}`, textContent: s.label, title: s.label });
      b.onclick = () => this.selectSource(s.id);
      if (s.removable) {
        b.oncontextmenu = e => {
          e.preventDefault();
          showContextMenu(e.clientX, e.clientY, [{ label: 'Remove from the browser', run: () => void this.deps.catalog.removeFolder(s.id) }]);
        };
        b.title = `${s.label} (right click: remove from the browser)`;
      }
      return b;
    };
    const section = (title: string, sources: readonly BrowserSource[]) =>
      [el('div', { className: 'browser-section', textContent: title }), ...sources.map(button)];
    const add = el<HTMLButtonElement>('button', { className: 'browser-source browser-add', textContent: '+ Folder…', title: 'Add a disk folder of samples to the places' });
    add.onclick = () => void this.deps.addFolder().then(s => s && this.selectSource(s.id)).catch(e => {
      if (!(e instanceof DOMException && e.name === 'AbortError')) this.deps.say(`Couldn't add the folder: ${message(e)}`);
    });
    this.sourceList.replaceChildren(
      ...section('Categories', catalog.sources.filter(s => s.section === 'categories')),
      ...section('Places', catalog.sources.filter(s => s.section === 'places')), add);
    this.renderList();
  }

  /** A source's content must be reread. */
  private invalidate(sourceId: string): void {
    this.tree.invalidate(sourceId);
    if (this.source?.id === sourceId) {
      if (this.searchInput.value.trim()) this.runSearch();
      else this.renderList();
    }
  }

  // ---------------------------------------------------------------- list

  private renderList(): void {
    const source = this.source;
    this.rows = this.hits ?? (source ? this.tree.rows(source, s => void this.unlock(s)) : []);
    if (this.selected && !this.rows.some(r => 'item' in r && r.item.id === this.selected)) this.selected = null;
    const scroll = this.list.scrollTop;
    this.list.replaceChildren(...this.rows.map((r, i) => this.rowElement(r, i)));
    this.list.scrollTop = scroll;
  }

  private rowElement(row: Row, index: number): HTMLElement {
    if ('note' in row) {
      const note = el('div', { className: 'browser-row browser-note muted', textContent: row.note });
      note.style.setProperty('--depth', String(row.depth));
      if (row.action) note.append(el('button', { className: 'mini', textContent: row.action.label, onclick: row.action.run }));
      return note;
    }
    const { item, depth, path } = row;
    const open = this.tree.isOpen(item.id);
    const where = path?.length ? `${path.join(' › ')} › ` : '';
    const hint = path?.length ? path.join(' › ') : item.hint;
    let twist = '';
    if (item.children && !path) twist = open ? '▾' : '▸';
    const r = el('div', {
      className: `browser-row icon-${item.icon}${item.id === this.selected ? ' selected' : ''}${item.payload ? '' : ' folder'}`,
      draggable: !!item.payload,
      title: item.payload ? `${where}${item.name}: double click or Enter to load it, or drag it` : item.name,
    },
    el('span', { className: 'twist', textContent: twist }),
    el('span', { className: 'icon', textContent: ICONS[item.icon] }),
    el('span', { className: 'name', textContent: item.name }),
    ...(hint ? [el('span', { className: 'hint', textContent: hint })] : []));
    r.dataset.index = String(index);
    r.style.setProperty('--depth', String(depth));
    return r;
  }

  private bindList(): void {
    const rowAt = (target: EventTarget | null) => {
      const r = (target as HTMLElement | null)?.closest<HTMLElement>('.browser-row');
      const row = r?.dataset.index ? this.rows[Number(r.dataset.index)] : undefined;
      return row && 'item' in row ? row : undefined;
    };
    this.list.addEventListener('click', e => {
      const row = rowAt(e.target);
      if (!row) return;
      this.select(row.item);
      // the arrow, or a click on a folder that doesn't load, opens and closes it
      if (row.item.children && !row.path && ((e.target as HTMLElement).classList.contains('twist') || !row.item.payload)) this.toggleItem(row.item);
    });
    this.list.addEventListener('dblclick', e => {
      const row = rowAt(e.target);
      if (!row || (e.target as HTMLElement).classList.contains('twist')) return;
      if (row.item.payload) this.deps.load(row.item);
    });
    this.list.addEventListener('contextmenu', e => {
      const row = rowAt(e.target);
      if (!row) return;
      e.preventDefault();
      this.select(row.item);
      showContextMenu(e.clientX, e.clientY, this.itemMenu(row.item, !!row.path));
    });
    this.list.addEventListener('dragstart', e => {
      const row = rowAt(e.target);
      if (row?.item.payload) startBrowserDrag(e, row.item);
      else e.preventDefault();
    });
    this.list.addEventListener('dragend', () => endBrowserDrag());
    this.list.addEventListener('keydown', e => this.key(e));
  }

  private itemMenu(item: BrowserItem, flat: boolean): MenuItem[] {
    return itemMenu(item, flat, {
      open: this.tree.isOpen(item.id),
      canListen: isAudio(item.payload) && !!this.deps.preview,
      load: () => this.deps.load(item),
      listen: () => void this.preview(item, true),
      toggle: () => this.toggleItem(item),
    });
  }

  /** The arrows scroll the items and open or close the folders, Enter loads. The keys used here
   *  don't reach the app's shortcuts (Enter would otherwise stop the transport). */
  private key(e: KeyboardEvent): void {
    const action = browserKey(e.key, this.rows, this.selected, id => this.tree.isOpen(id));
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    this.act(action);
  }

  private act(action: BrowserAction): void {
    if (action.kind === 'select') this.select(action.item, true);
    else if (action.kind === 'toggle') this.toggleItem(action.item);
    else if (action.kind === 'load') this.deps.load(action.item);
    else if (action.kind === 'search') this.searchInput.focus();
  }

  private toggleItem(item: BrowserItem): void {
    this.tree.toggle(item.id);
    this.renderList();
  }

  private select(item: BrowserItem, reveal = false): void {
    if (this.selected !== item.id) {
      this.selected = item.id;
      for (const r of this.list.querySelectorAll('.browser-row.selected')) r.classList.remove('selected');
      const index = this.rows.findIndex(r => 'item' in r && r.item.id === item.id);
      const element = this.list.children[index] as HTMLElement | undefined;
      element?.classList.add('selected');
      if (reveal) element?.scrollIntoView({ block: 'nearest' });
      void this.preview(item, this.settings.preview);
    }
    this.list.focus({ preventScroll: true });
  }

  private async unlock(source: BrowserSource): Promise<void> {
    if (!(await source.unlock?.())) return this.deps.say(`Without permission the browser doesn't read "${source.label}".`);
    this.invalidate(source.id);
  }

  // ---------------------------------------------------------------- search

  private bindSearch(): void {
    let timer = 0;
    this.searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => this.runSearch(), 140);
    });
    this.searchInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        this.searchInput.value = '';
        this.runSearch();
      } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        const first = this.rows.find(r => 'item' in r);
        if (first && 'item' in first) this.select(first.item, true);
      }
    });
  }

  /** Searches all the sources, the chosen one first; an old result arriving late is discarded. */
  private runSearch(): void {
    const query = this.searchInput.value.trim();
    const run = ++this.searchRun;
    const source = this.source;
    if (!query || !source) {
      this.hits = null;
      return this.renderList();
    }
    this.hits = [{ note: 'Searching…', depth: 0 }];
    this.renderList();
    void (async () => {
      const rows = await searchRows(this.deps.catalog.sources, source, query);
      if (run !== this.searchRun) return;
      this.hits = rows;
      this.renderList();
    })();
  }

  // ---------------------------------------------------------------- preview

  private setPreview(on: boolean): void {
    this.save({ preview: on });
    this.previewToggle.classList.toggle('on', on);
    this.previewToggle.title = on ? 'Preview on: a click on a sample plays it' : 'Preview off: turn it on to hear the samples when you choose them';
    if (!on) this.deps.preview?.stop();
  }

  /** Shows the chosen sample (name and waveform) and, with `play`, plays it. */
  private async preview(item: BrowserItem, play: boolean): Promise<void> {
    const preview = this.deps.preview;
    const run = ++this.previewRun;
    preview?.stop();
    if (!preview || !isAudio(item.payload)) return;
    this.previewName.textContent = item.name;
    this.previewName.classList.remove('muted');
    let audio: AudioData | null = null;
    try {
      audio = await preview.audio(item.payload);
    } catch (e) {
      if (run === this.previewRun) this.deps.say(`Can't preview "${item.name}": ${message(e)}`);
    }
    if (run !== this.previewRun) return;
    this.drawWave(audio);
    if (audio && play) preview.play(audio);
  }

  private drawWave(audio: AudioData | null): void {
    const c = this.wave, dpr = devicePixelRatio || 1;
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) return;
    paintWave(g, w, h, audio?.channels ?? [], () => getComputedStyle(this.element).getPropertyValue('--accent').trim() || '#ff9d2e');
  }

  // ---------------------------------------------------------------- width and settings

  private bindResize(handle: HTMLElement): void {
    handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = this.element.getBoundingClientRect().width;
      handle.classList.add('dragging');
      const move = (m: PointerEvent) => {
        const width = Math.round(clampWidth(w0 + m.clientX - x0));
        this.element.style.width = `${width}px`;
        this.settings.width = width;
      };
      const up = () => {
        handle.classList.remove('dragging');
        handle.removeEventListener('pointermove', move);
        this.save({});
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up, { once: true });
      handle.addEventListener('pointercancel', up, { once: true });
    });
  }

  private save(patch: Partial<BrowserSettings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
  }
}

const isAudio = (p: BrowserPayload | undefined): p is Extract<BrowserPayload, { kind: 'sample' | 'file' }> =>
  p?.kind === 'sample' || p?.kind === 'file';
