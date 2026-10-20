/* L'editor delle zone del Sampler, come quello di Live: in alto la tastiera, sotto una riga per
 * zona con la barra dei suoi tasti (alta quanto le sue velocity) e un punto sulla nota base. Le
 * barre si trascinano tutte (con la nota base) o per un bordo; un clic sulla tastiera suona il
 * tasto. La rotella fa lo zoom sui tasti attorno al puntatore (Maiusc+rotella scorre, sui nomi
 * scorre le righe); doppio clic sul vuoto torna a tutta la tastiera. Le righe delle zone che
 * suonano si accendono e i tasti suonati lampeggiano. */
import { noteName, zoneMap, zoneParam, type ZoneKey, type ZoneMap } from '../../../devices/instruments/sampler/sampler';
import type { ParamValues } from '../../../model/device';
import { ACCENT, BACKGROUND, drag, fit, GRID, LABEL } from '../prisma/canvas';

/** La tastiera in alto, le righe e la colonna dei nomi. */
const KEYS_H = 16, ROW_H = 14, NAME_W = 118;
/** Quanto si allarga la presa sui bordi di una barra, e la barra più stretta che ha i bordi. */
const EDGE = 4, MIN_EDGES = 14;
/** Lo zoom più stretto, in tasti. */
const MIN_KEYS = 12;
/** Quanto resta acceso un tasto suonato (ms). */
const FLASH = 180;

export interface ZoneRow {
  readonly index: number;
  readonly name: string;
}

export interface ZoneHost {
  values(): Readonly<Record<string, number>>;
  /** Le zone che hanno un sample, in ordine. */
  rows(): readonly ZoneRow[];
  selected(): number;
  select(zone: number): void;
  set(values: ParamValues, final: boolean): void;
  audition(pitch: number): void;
  /** Le zone che suonano adesso. */
  sounding(): ReadonlySet<number>;
  /** Le note suonate dall'ultima volta. */
  played(): readonly number[];
  /** Doppio clic sulla riga vuota in fondo: carica dei file in zone nuove. */
  add(): void;
  /** Mostra la nota base (non in Slice). */
  pitched(): boolean;
  menu(x: number, y: number): void;
}

type Hit =
  | { readonly kind: 'key'; readonly key: number }
  | { readonly kind: 'name'; readonly zone: number }
  | { readonly kind: 'lo' | 'hi' | 'move'; readonly zone: number }
  | { readonly kind: 'row'; readonly zone: number }
  | { readonly kind: 'empty' };

const isBlack = (k: number) => [1, 3, 6, 8, 10].includes(k % 12);

export class ZoneView {
  readonly canvas = document.createElement('canvas');
  private k0 = 0;
  private k1 = 128;
  /** La prima riga che si vede. */
  private top = 0;
  private hot: Hit | null = null;
  private enabled = true;
  private readonly flashes = new Map<number, number>();
  private lit: ReadonlySet<number> = new Set();
  /** La zona scelta all'ultimo disegno: quando cambia, la sua riga si porta in vista. */
  private revealed = -1;

  constructor(private readonly host: ZoneHost) {
    const c = this.canvas;
    c.className = 'smp-zones';
    c.title = 'Trascina una barra (o un suo bordo) · clic sulla tastiera: suona · rotella: zoom · doppio clic: tutta la tastiera · file audio: zone nuove dal tasto';
    c.addEventListener('pointerdown', e => this.press(e));
    c.addEventListener('pointermove', e => {
      if (e.buttons) return;
      const h = this.hit(e.clientX, e.clientY);
      const changed = JSON.stringify(h) !== JSON.stringify(this.hot);
      this.hot = h;
      c.style.cursor = h.kind === 'lo' || h.kind === 'hi' ? 'ew-resize' : h.kind === 'move' ? 'grab' : h.kind === 'key' || h.kind === 'name' ? 'pointer' : 'default';
      if (changed) this.paint();
    });
    c.addEventListener('pointerleave', () => {
      this.hot = null;
      this.paint();
    });
    c.addEventListener('dblclick', e => {
      const h = this.hit(e.clientX, e.clientY);
      if (h.kind === 'empty' && this.rowAt(e.clientY) >= this.host.rows().length) this.host.add();
      else if (h.kind === 'empty' || h.kind === 'row') this.zoomAll();
    });
    c.addEventListener('wheel', e => this.wheel(e), { passive: false });
    c.addEventListener('contextmenu', e => {
      e.preventDefault();
      const h = this.hit(e.clientX, e.clientY);
      if ('zone' in h) this.host.select(h.zone);
      this.host.menu(e.clientX, e.clientY);
    });
  }

  zoomAll(): void {
    this.k0 = 0;
    this.k1 = 128;
    this.paint();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Il tasto sotto il puntatore (per i file lasciati sopra), o null sulla colonna dei nomi. */
  keyAt(clientX: number): number | null {
    const r = this.canvas.getBoundingClientRect(), x = clientX - r.left;
    if (x < NAME_W) return null;
    return Math.max(0, Math.min(127, Math.floor(this.k0 + ((x - NAME_W) / this.keysWidth) * (this.k1 - this.k0))));
  }

  /** La zona della riga sotto il puntatore, o null. */
  zoneAt(clientY: number): number | null {
    return this.host.rows()[this.rowAt(clientY)]?.index ?? null;
  }

  /** A ogni fotogramma: le zone che suonano e i tasti suonati. */
  tick(): void {
    const now = performance.now();
    for (const p of this.host.played()) this.flashes.set(p, now);
    for (const [p, t] of this.flashes) if (now - t > FLASH) this.flashes.delete(p);
    const lit = this.host.sounding();
    if (this.flashes.size || lit.size || this.lit.size) {
      this.lit = lit;
      this.paint();
    }
  }

  // ---------------------------------------------------------------- misure

  private get keysWidth(): number {
    return Math.max(1, this.canvas.clientWidth - NAME_W);
  }

  private xOf(key: number): number {
    return NAME_W + ((key - this.k0) / (this.k1 - this.k0)) * this.keysWidth;
  }

  private rowAt(clientY: number): number {
    const y = clientY - this.canvas.getBoundingClientRect().top;
    return y < KEYS_H ? -1 : this.top + Math.floor((y - KEYS_H) / ROW_H);
  }

  private visibleRows(): number {
    return Math.max(1, Math.floor((this.canvas.clientHeight - KEYS_H) / ROW_H));
  }

  private hit(clientX: number, clientY: number): Hit {
    const r = this.canvas.getBoundingClientRect(), x = clientX - r.left, y = clientY - r.top;
    if (y < KEYS_H) {
      const key = this.keyAt(clientX);
      return key === null ? { kind: 'empty' } : { kind: 'key', key };
    }
    const row = this.host.rows()[this.rowAt(clientY)];
    if (!row) return { kind: 'empty' };
    if (x < NAME_W) return { kind: 'name', zone: row.index };
    const z = zoneMap(this.host.values(), row.index);
    const xa = this.xOf(z.lo), xb = this.xOf(z.hi + 1);
    if (xb - xa >= MIN_EDGES) {
      if (Math.abs(x - xa) <= EDGE) return { kind: 'lo', zone: row.index };
      if (Math.abs(x - xb) <= EDGE) return { kind: 'hi', zone: row.index };
    }
    return x >= xa - 1 && x <= xb + 1 ? { kind: 'move', zone: row.index } : { kind: 'row', zone: row.index };
  }

  // ---------------------------------------------------------------- gesti

  private press(e: PointerEvent): void {
    if (e.button !== 0) return;
    const h = this.hit(e.clientX, e.clientY);
    if (h.kind === 'key') return this.host.audition(h.key);
    if (h.kind === 'empty') return;
    this.host.select(h.zone);
    if (h.kind === 'name' || h.kind === 'row') return;
    e.preventDefault();
    const z0 = zoneMap(this.host.values(), h.zone);
    const perKey = this.keysWidth / (this.k1 - this.k0);
    let last: ParamValues | null = null;
    drag(e, this.canvas, dx => {
      const next = this.moved(h.kind as 'lo' | 'hi' | 'move', z0, Math.round(dx / perKey));
      if (JSON.stringify(next) === JSON.stringify(last)) return;
      last = next;
      this.host.set(next, false);
    }, () => { if (last) this.host.set(last, true); });
  }

  /** I valori dopo aver spostato di `d` tasti un bordo della zona, o tutta (con la nota base). */
  private moved(kind: 'lo' | 'hi' | 'move', z: ZoneMap, d: number): ParamValues {
    const id = (key: ZoneKey) => zoneParam(z.index, key);
    if (kind === 'lo') return { [id('lo')]: Math.max(0, Math.min(z.hi, z.lo + d)), [id('hi')]: z.hi };
    if (kind === 'hi') return { [id('lo')]: z.lo, [id('hi')]: Math.max(z.lo, Math.min(127, z.hi + d)) };
    const k = Math.max(-z.lo, Math.min(127 - z.hi, d));
    return { [id('lo')]: z.lo + k, [id('hi')]: z.hi + k, [id('root')]: Math.max(0, Math.min(127, z.root + k)) };
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    if (e.clientX - r.left < NAME_W) {
      // sui nomi: le righe
      const max = Math.max(0, this.host.rows().length + 1 - this.visibleRows());
      this.top = Math.max(0, Math.min(max, this.top + Math.sign(e.deltaY)));
      return this.paint();
    }
    const span = this.k1 - this.k0;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const d = ((e.shiftKey ? e.deltaY : e.deltaX) / this.keysWidth) * span;
      this.k0 = Math.max(0, Math.min(128 - span, this.k0 + d));
      this.k1 = this.k0 + span;
    } else {
      const at = this.k0 + ((e.clientX - r.left - NAME_W) / this.keysWidth) * span;
      const next = Math.max(MIN_KEYS, Math.min(128, span * Math.pow(1.0015, e.deltaY)));
      this.k0 = Math.max(0, Math.min(128 - next, at - ((at - this.k0) / span) * next));
      this.k1 = this.k0 + next;
    }
    this.paint();
  }

  // ---------------------------------------------------------------- disegno

  paint(): void {
    const g = fit(this.canvas);
    if (!g) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    g.fillStyle = BACKGROUND;
    g.fillRect(0, 0, w, h);
    g.globalAlpha = this.enabled ? 1 : 0.5;
    const rows = this.host.rows(), values = this.host.values(), selected = this.host.selected(), shown = this.visibleRows();
    if (selected !== this.revealed) {
      this.revealed = selected;
      const at = rows.findIndex(r => r.index === selected);
      if (at >= 0 && at < this.top) this.top = at;
      else if (at >= this.top + shown) this.top = at - shown + 1;
    }
    this.top = Math.max(0, Math.min(this.top, rows.length + 1 - shown));
    const lo = Math.floor(this.k0), hi = Math.min(127, Math.ceil(this.k1));
    const keyW = this.keysWidth / (this.k1 - this.k0);

    // le colonne dei tasti neri e le ottave, sotto le righe
    for (let k = lo; k <= hi; k++) {
      const x = this.xOf(k);
      if (isBlack(k)) {
        g.fillStyle = 'rgba(0,0,0,0.22)';
        g.fillRect(x, KEYS_H, keyW, h - KEYS_H);
      }
      if (k % 12 === 0) {
        g.fillStyle = GRID;
        g.fillRect(Math.round(x), KEYS_H, 1, h - KEYS_H);
      }
    }

    // le righe delle zone
    g.font = '10.5px system-ui, sans-serif';
    g.textBaseline = 'middle';
    const pitched = this.host.pitched();
    rows.slice(this.top, this.top + shown).forEach((row, i) => {
      const y = KEYS_H + i * ROW_H, z = zoneMap(values, row.index), on = row.index === selected;
      const hot = this.hot && 'zone' in this.hot && this.hot.zone === row.index;
      if (on || this.lit.has(row.index)) {
        g.fillStyle = this.lit.has(row.index) ? 'rgba(255,157,46,0.16)' : 'rgba(255,255,255,0.06)';
        g.fillRect(0, y, w, ROW_H);
      }
      // la barra, alta quanto le velocity
      const xa = Math.max(NAME_W, this.xOf(z.lo)), xb = Math.min(w, this.xOf(z.hi + 1));
      if (xb > xa) {
        const inner = ROW_H - 3, yb = y + ROW_H - 1.5;
        const y0 = yb - (z.vhi / 127) * inner, y1 = yb - ((z.vlo - 1) / 127) * inner;
        g.fillStyle = on ? ACCENT : hot ? 'rgba(255,157,46,0.7)' : 'rgba(255,157,46,0.45)';
        g.fillRect(xa, y0, Math.max(2, xb - xa - 1), Math.max(2, y1 - y0));
        const range = z.lo === z.hi ? noteName(z.lo) : `${noteName(z.lo)}–${noteName(z.hi)}`;
        const textEnd = xa + 8 + g.measureText(range).width, dot = this.xOf(z.root + 0.5);
        // il nome dei tasti, se ci sta e non copre il punto della nota base
        if (textEnd < xb && !(pitched && dot > xa && dot < textEnd + 3)) {
          g.fillStyle = on ? '#141414' : 'rgba(255,255,255,0.85)';
          g.fillText(range, xa + 4, y + ROW_H / 2 + 0.5);
        }
      }
      if (pitched && z.root >= this.k0 && z.root < this.k1) {
        g.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.75)';
        g.beginPath();
        g.arc(this.xOf(z.root + 0.5), y + ROW_H / 2, Math.min(3, Math.max(1.5, keyW / 3)), 0, 2 * Math.PI);
        g.fill();
      }
      // il nome sopra tutto, con il fondo della colonna
      g.fillStyle = on ? '#262b31' : BACKGROUND;
      g.fillRect(0, y, NAME_W, ROW_H);
      g.fillStyle = on ? ACCENT : 'rgba(255,255,255,0.8)';
      g.fillText(clip(g, `${row.index + 1}  ${row.name}`, NAME_W - 10), 5, y + ROW_H / 2 + 0.5);
    });
    // la riga vuota in fondo: si caricano zone nuove
    const free = rows.length - this.top;
    if (free >= 0 && free < shown) {
      const y = KEYS_H + free * ROW_H;
      g.fillStyle = BACKGROUND;
      g.fillRect(0, y, NAME_W, ROW_H);
      g.fillStyle = LABEL;
      g.fillText(rows.length ? '+ zone (doppio clic o file)' : 'Trascina qui dei file audio', 5, y + ROW_H / 2 + 0.5);
    }
    g.fillStyle = GRID;
    g.fillRect(NAME_W - 1, KEYS_H, 1, h - KEYS_H);
    // più righe di quante se ne vedono: dove si è
    if (rows.length + 1 > shown) {
      const span = h - KEYS_H, total = rows.length + 1;
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.fillRect(NAME_W - 4, KEYS_H + (this.top / total) * span, 2, Math.max(6, (shown / total) * span));
    }

    // la tastiera
    g.fillStyle = BACKGROUND;
    g.fillRect(0, 0, w, KEYS_H);
    const now = performance.now();
    for (let k = lo; k <= hi; k++) {
      const x = this.xOf(k), lit = this.flashes.has(k) && now - this.flashes.get(k)! < FLASH;
      const hotKey = this.hot?.kind === 'key' && this.hot.key === k;
      g.fillStyle = lit ? ACCENT : hotKey ? '#d9d9d9' : isBlack(k) ? '#2a2d31' : '#b9bcc0';
      g.fillRect(x, 1, Math.max(1, keyW - 1), KEYS_H - 2);
      if (k % 12 === 0 && keyW * 12 > 34) {
        g.fillStyle = '#141414';
        g.font = '600 8.5px system-ui, sans-serif';
        g.fillText(noteName(k), x + 2, KEYS_H / 2 + 0.5);
      }
    }
    g.fillStyle = BACKGROUND;
    g.fillRect(0, 0, NAME_W, KEYS_H);
    g.fillStyle = LABEL;
    g.font = '10px system-ui, sans-serif';
    g.fillText('Zone', 5, KEYS_H / 2 + 0.5);
    // lo zoom: dove si è sulla tastiera
    if (this.k1 - this.k0 < 127.9) {
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(NAME_W + (this.k0 / 128) * this.keysWidth, h - 2, Math.max(2, ((this.k1 - this.k0) / 128) * this.keysWidth), 2);
    }
    g.globalAlpha = 1;
    g.textBaseline = 'alphabetic';
  }
}

/** Il testo accorciato con "…" per stare in `width`. */
function clip(g: CanvasRenderingContext2D, text: string, width: number): string {
  if (g.measureText(text).width <= width) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`${s}…`).width > width) s = s.slice(0, -1);
  return `${s}…`;
}
