/* Il browser, a sinistra come in Live: la ricerca in alto, le fonti (categorie e luoghi) in una
 * colonna, il loro contenuto ad albero accanto, l'anteprima dei sample in fondo. Un clic sceglie
 * una voce (e ascolta il sample, con 🎧 acceso), il doppio clic o Invio la carica dove si sta
 * lavorando, trascinarla la porta su una traccia, uno slot o la catena dei dispositivi. Il
 * browser non sa cosa sia una traccia: carica e anteprima sono dell'app (`BrowserViewDeps`). */
import type { BrowserCatalog } from '../../browser/catalog';
import { childrenOf, type BrowserItem, type BrowserPayload, type BrowserSource } from '../../browser/item';
import { searchSources } from '../../browser/search';
import type { AudioData } from '../../dsp/types';
import { showContextMenu, SEPARATOR, type MenuItem } from '../context-menu';
import { el } from '../dom';
import { endBrowserDrag, startBrowserDrag } from './browser-drag';

/** L'ascolto dei sample (l'app lo fa con il suo contesto audio). */
export interface BrowserPreview {
  /** L'audio di una voce da ascoltare (un sample del progetto, un file), o null. */
  audio(payload: BrowserPayload): Promise<AudioData | null>;
  play(audio: AudioData): void;
  stop(): void;
}

export interface BrowserViewDeps {
  readonly catalog: BrowserCatalog;
  /** Carica la voce dove si sta lavorando (doppio clic, Invio). */
  readonly load: (item: BrowserItem) => void;
  /** Fa scegliere una cartella del disco e la aggiunge ai luoghi; null se si rinuncia. */
  readonly addFolder: () => Promise<BrowserSource | null>;
  readonly preview?: BrowserPreview;
  readonly say: (text: string) => void;
}

/** Ciò che il browser ricorda tra un avvio e l'altro. */
interface BrowserSettings {
  open: boolean;
  width: number;
  source: string;
  preview: boolean;
}

const SETTINGS_KEY = 'studiomio.browser';
const MIN_WIDTH = 250, MAX_WIDTH = 640;
const DEFAULTS: BrowserSettings = { open: true, width: 330, source: 'instruments', preview: true };

/** Una riga della lista: una voce (a una profondità, e da dove viene se è un risultato della
 *  ricerca) oppure un avviso (caricamento, lista vuota, permesso da dare). */
type Row =
  | { readonly item: BrowserItem; readonly depth: number; readonly path?: readonly string[] }
  | { readonly note: string; readonly depth: number; readonly action?: { readonly label: string; readonly run: () => void } };

/** Il contenuto di una cartella: le voci, oppure a che punto è. */
type Loaded = readonly BrowserItem[] | 'loading' | 'locked' | Error;

const ICONS: Readonly<Record<BrowserItem['icon'], string>> = {
  instrument: '♫', effect: '≋', preset: '◦', 'user-preset': '★', rack: '▦', sample: '∿', folder: '▤',
};

export class BrowserView {
  readonly element = el('aside', { className: 'browser' });
  private readonly searchInput = el<HTMLInputElement>('input', {
    type: 'search', className: 'browser-search', placeholder: 'Cerca (Ctrl+F)', spellcheck: false,
  });
  private readonly sourceList = el('nav', { className: 'browser-sources' });
  private readonly list = el('div', { className: 'browser-list', tabIndex: 0 });
  private readonly previewToggle = el<HTMLButtonElement>('button', { className: 'mini browser-preview-toggle', textContent: '🎧' });
  private readonly previewName = el('span', { className: 'browser-preview-name muted', textContent: 'Scegli un sample per ascoltarlo' });
  private readonly wave = el<HTMLCanvasElement>('canvas', { className: 'browser-wave' });
  private settings: BrowserSettings;
  /** Il contenuto delle cartelle già lette: "fonte:id" per il primo livello, l'id della voce per le altre. */
  private readonly loaded = new Map<string, Loaded>();
  private readonly expanded = new Set<string>();
  private selected: string | null = null;
  private rows: Row[] = [];
  /** I risultati della ricerca (null: niente ricerca, si vede l'albero). */
  private hits: Row[] | null = null;
  private searchRun = 0;
  private previewRun = 0;
  private readonly unsubscribe = new Map<string, () => void>();

  constructor(private readonly deps: BrowserViewDeps) {
    this.settings = loadSettings();
    const resize = el('div', { className: 'browser-resize', title: 'Trascina per allargare o stringere il browser' });
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

  /** Ctrl+F: apre il browser e porta il cursore nella ricerca. */
  focusSearch(): void {
    this.show(true);
    this.searchInput.focus();
    this.searchInput.select();
  }

  /** La fonte scelta a sinistra (per i test automatici). */
  get source(): BrowserSource | undefined {
    return this.deps.catalog.source(this.settings.source) ?? this.deps.catalog.sources[0];
  }

  /** Sceglie una fonte a sinistra e mostra il suo contenuto. */
  selectSource(id: string): void {
    if (!this.deps.catalog.source(id)) return;
    this.save({ source: id });
    this.selected = null;
    this.renderSources();
    if (this.searchInput.value.trim()) this.runSearch();
  }

  // ---------------------------------------------------------------- fonti

  private renderSources(): void {
    const { catalog } = this.deps;
    const current = this.source;
    // ogni fonte si rilegge quando cambia (un preset salvato, un sample importato)
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
          showContextMenu(e.clientX, e.clientY, [{ label: 'Togli dal browser', run: () => void this.deps.catalog.removeFolder(s.id) }]);
        };
        b.title = `${s.label} (tasto destro: togli dal browser)`;
      }
      return b;
    };
    const section = (title: string, sources: readonly BrowserSource[]) =>
      [el('div', { className: 'browser-section', textContent: title }), ...sources.map(button)];
    const add = el<HTMLButtonElement>('button', { className: 'browser-source browser-add', textContent: '+ Cartella…', title: 'Aggiungi ai luoghi una cartella di sample del disco' });
    add.onclick = () => void this.deps.addFolder().then(s => s && this.selectSource(s.id)).catch(e => {
      if (!(e instanceof DOMException && e.name === 'AbortError')) this.deps.say(`Non è stato possibile aggiungere la cartella: ${message(e)}`);
    });
    this.sourceList.replaceChildren(
      ...section('Categorie', catalog.sources.filter(s => s.section === 'categories')),
      ...section('Luoghi', catalog.sources.filter(s => s.section === 'places')), add);
    this.renderList();
  }

  /** Il contenuto di una fonte va riletto. */
  private invalidate(sourceId: string): void {
    for (const key of [...this.loaded.keys()]) if (key === rootKey(sourceId) || key.startsWith(`${sourceId}/`)) this.loaded.delete(key);
    if (this.source?.id === sourceId) {
      if (this.searchInput.value.trim()) this.runSearch();
      else this.renderList();
    }
  }

  // ---------------------------------------------------------------- lista

  /** Il contenuto di una cartella: quello già letto, oppure lo legge e ridisegna. */
  private contents(key: string, read: () => Promise<readonly BrowserItem[]>, source?: BrowserSource): Loaded {
    const known = this.loaded.get(key);
    if (known) return known;
    this.loaded.set(key, 'loading');
    void (async () => {
      try {
        if (source?.locked && await source.locked()) return this.loaded.set(key, 'locked');
        this.loaded.set(key, await read());
      } catch (e) {
        this.loaded.set(key, e instanceof Error ? e : new Error(String(e)));
      }
    })().finally(() => this.renderList());
    return 'loading';
  }

  private treeRows(): Row[] {
    const source = this.source;
    if (!source) return [];
    const rows: Row[] = [];
    const add = (state: Loaded, depth: number, empty: string) => {
      if (state === 'loading') rows.push({ note: 'Lettura…', depth });
      else if (state === 'locked') rows.push({ note: 'Per leggere questa cartella serve il tuo permesso.', depth, action: { label: 'Consenti', run: () => void this.unlock(source) } });
      else if (state instanceof Error) rows.push({ note: `Non si legge: ${state.message}`, depth });
      else if (!state.length) rows.push({ note: empty, depth });
      else for (const item of state) {
        rows.push({ item, depth });
        if (item.children && this.expanded.has(item.id)) add(this.contents(item.id, () => childrenOf(item)), depth + 1, 'Vuota');
      }
    };
    add(this.contents(rootKey(source.id), () => source.items(), source), 0, source.empty ?? 'Vuota');
    return rows;
  }

  private renderList(): void {
    this.rows = this.hits ?? this.treeRows();
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
    const open = this.expanded.has(item.id);
    const r = el('div', {
      className: `browser-row icon-${item.icon}${item.id === this.selected ? ' selected' : ''}${item.payload ? '' : ' folder'}`,
      draggable: !!item.payload,
      title: item.payload ? `${path?.length ? `${path.join(' › ')} › ` : ''}${item.name}: doppio clic o Invio per caricarlo, oppure trascinalo` : item.name,
    },
    el('span', { className: 'twist', textContent: item.children && !path ? (open ? '▾' : '▸') : '' }),
    el('span', { className: 'icon', textContent: ICONS[item.icon] }),
    el('span', { className: 'name', textContent: item.name }),
    ...(path?.length ? [el('span', { className: 'hint', textContent: path.join(' › ') })] : item.hint ? [el('span', { className: 'hint', textContent: item.hint })] : []));
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
      // la freccia, o un clic su una cartella che non si carica, la apre e la chiude
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
    const items: MenuItem[] = [];
    if (item.payload) items.push({ label: 'Carica', shortcut: 'Invio', run: () => this.deps.load(item) });
    if (isAudio(item.payload) && this.deps.preview) items.push({ label: 'Ascolta', run: () => void this.preview(item, true) });
    if (item.children && !flat) items.push(...(items.length ? [SEPARATOR] : []), { label: this.expanded.has(item.id) ? 'Chiudi' : 'Apri', shortcut: this.expanded.has(item.id) ? '◂' : '▸', run: () => this.toggleItem(item) });
    return items;
  }

  /** Le frecce scorrono le voci e aprono o chiudono le cartelle, Invio carica. I tasti usati qui
   *  non arrivano alle scorciatoie dell'app (Invio altrimenti ferma il trasporto). */
  private key(e: KeyboardEvent): void {
    const items = this.rows.flatMap((r, i) => ('item' in r ? [{ row: r, i }] : []));
    const at = items.findIndex(x => x.row.item.id === this.selected);
    const current = at >= 0 ? items[at].row : undefined;
    const go = (k: number) => {
      const next = items[Math.max(0, Math.min(items.length - 1, k))];
      if (next) this.select(next.row.item, true);
    };
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    switch (e.key) {
      case 'ArrowDown': handled(); return go(at + 1);
      case 'ArrowUp': handled(); return at <= 0 && !current ? go(0) : at === 0 ? this.searchInput.focus() : go(at - 1);
      case 'Home': handled(); return go(0);
      case 'End': handled(); return go(items.length - 1);
      case 'ArrowRight':
        handled();
        if (current?.item.children && !current.path) {
          if (!this.expanded.has(current.item.id)) this.toggleItem(current.item);
          else go(at + 1);
        }
        return;
      case 'ArrowLeft': {
        handled();
        if (!current || current.path) return;
        if (current.item.children && this.expanded.has(current.item.id)) return this.toggleItem(current.item);
        // alla cartella che la contiene
        const parent = items.slice(0, at).reverse().find(x => x.row.depth < current.depth);
        if (parent) this.select(parent.row.item, true);
        return;
      }
      case 'Enter':
        handled();
        if (current?.item.payload) this.deps.load(current.item);
        else if (current?.item.children) this.toggleItem(current.item);
        return;
    }
  }

  private toggleItem(item: BrowserItem): void {
    if (this.expanded.has(item.id)) this.expanded.delete(item.id);
    else this.expanded.add(item.id);
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
    if (!(await source.unlock?.())) return this.deps.say(`Senza permesso il browser non legge "${source.label}".`);
    this.invalidate(source.id);
  }

  // ---------------------------------------------------------------- ricerca

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

  /** Cerca in tutte le fonti, prima in quella scelta; un risultato vecchio arrivato tardi si scarta. */
  private runSearch(): void {
    const query = this.searchInput.value.trim();
    const run = ++this.searchRun;
    const source = this.source;
    if (!query || !source) {
      this.hits = null;
      return this.renderList();
    }
    this.hits = [{ note: 'Ricerca…', depth: 0 }];
    this.renderList();
    void (async () => {
      let rows: Row[];
      try {
        const others = this.deps.catalog.sources.filter(s => s !== source);
        const found = await searchSources([source, ...others], query);
        rows = found.length ? found.map(h => ({ item: h.item, depth: 0, path: h.path })) : [{ note: `Niente per «${query}».`, depth: 0 }];
      } catch (e) {
        rows = [{ note: `Non si legge: ${message(e)}`, depth: 0 }];
      }
      if (run !== this.searchRun) return;
      this.hits = rows;
      this.renderList();
    })();
  }

  // ---------------------------------------------------------------- anteprima

  private setPreview(on: boolean): void {
    this.save({ preview: on });
    this.previewToggle.classList.toggle('on', on);
    this.previewToggle.title = on ? 'Anteprima accesa: un clic su un sample lo fa sentire' : 'Anteprima spenta: accendila per sentire i sample quando li scegli';
    if (!on) this.deps.preview?.stop();
  }

  /** Mostra il sample scelto (nome e forma d'onda) e, con `play`, lo fa sentire. */
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
      if (run === this.previewRun) this.deps.say(`Non si ascolta "${item.name}": ${message(e)}`);
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
    g.clearRect(0, 0, w, h);
    const channels = audio?.channels ?? [];
    const n = channels[0]?.length ?? 0;
    if (!n) return;
    g.fillStyle = getComputedStyle(this.element).getPropertyValue('--accent').trim() || '#ff9d2e';
    const per = n / w, mid = h / 2;
    for (let x = 0; x < w; x++) {
      let lo = 0, hi = 0;
      const from = Math.floor(x * per), to = Math.min(n, Math.max(from + 1, Math.floor((x + 1) * per)));
      // ogni colonna guarda al massimo 64 campioni: un file lungo si disegna lo stesso subito
      const step = Math.max(1, Math.floor((to - from) / 64));
      for (const ch of channels) for (let i = from; i < to; i += step) {
        const v = ch[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      g.fillRect(x, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid));
    }
  }

  // ---------------------------------------------------------------- larghezza e impostazioni

  private bindResize(handle: HTMLElement): void {
    handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = this.element.getBoundingClientRect().width;
      handle.classList.add('dragging');
      const move = (m: PointerEvent) => {
        const width = Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w0 + m.clientX - x0)));
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
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch { /* senza spazio locale si ricorda solo finché l'app è aperta */ }
  }
}

const rootKey = (sourceId: string) => `source:${sourceId}`;

const isAudio = (p: BrowserPayload | undefined): p is Extract<BrowserPayload, { kind: 'sample' | 'file' }> =>
  p?.kind === 'sample' || p?.kind === 'file';

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function loadSettings(): BrowserSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<BrowserSettings>;
    return {
      open: typeof raw.open === 'boolean' ? raw.open : DEFAULTS.open,
      width: typeof raw.width === 'number' ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, raw.width)) : DEFAULTS.width,
      source: typeof raw.source === 'string' ? raw.source : DEFAULTS.source,
      preview: typeof raw.preview === 'boolean' ? raw.preview : DEFAULTS.preview,
    };
  } catch {
    return { ...DEFAULTS };
  }
}
