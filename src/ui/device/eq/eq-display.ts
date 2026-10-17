/* Il pannello dell'EQ: il grafico con spettro, curva e punti delle bande (si trascinano:
 * orizzontale = frequenza, verticale = guadagno, rotella = Q), sotto le bande e i controlli
 * di quella scelta. Ogni gesto è un passo di annullamento. */
import { paramActive, paramSpec, resolveParams } from '../../../devices/device-type';
import { BAND_TYPES, bandParam, bandsOf, EQ_BANDS, MAX_FREQ, MAX_GAIN, MIN_FREQ, SLOPES, type BandKey, type EqBand } from '../../../devices/effects/eq/eq';
import { formatParam, paramFromUnit, paramToUnit, type ParamSpec } from '../../../devices/params';
import type { DeviceSettings, ParamValues } from '../../../model/device';
import { SEPARATOR, showContextMenu, type MenuItem } from '../../context-menu';
import { el } from '../../dom';
import { controlFor, setActive, type ParamControl } from '../controls';
import type { DeviceDisplay, DisplayContext, SpectrumTap } from '../displays';
import { BAND_COLORS, EqGraph, type Spectrum } from './eq-graph';
import { SPECTRUM_BOTTOM } from './eq-scale';

/** Quanto tempo (ms) ha richiesto in media un disegno del grafico: per le prove. */
export const eqDrawStats = { frames: 0, ms: 0 };

/** I controlli della banda scelta, nell'ordine in cui compaiono. */
const BAND_CONTROLS: readonly BandKey[] = ['type', 'freq', 'gain', 'q', 'slope'];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const signedDb = (db: number) => `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;

/** Un punto che si trascina: dove è partito, e i valori mandati per ultimi. */
interface Drag {
  readonly band: number;
  readonly pointerId: number;
  /** Distanza tra il punto della banda e il mouse quando si è preso. */
  readonly dx: number;
  readonly dy: number;
  /** Posizione del punto (si muove meno del mouse con Maiusc). */
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  last: ParamValues | null;
}

export class EqDisplay implements DeviceDisplay {
  readonly element = el('div', { className: 'eq-display' });
  private readonly canvas = el<HTMLCanvasElement>('canvas', { className: 'eq-graph' });
  private readonly graph: EqGraph;
  private readonly bandButtons: HTMLButtonElement[];
  private readonly controls = el('div', { className: 'eq-controls' });
  private readonly bandControls = new Map<string, { spec: ParamSpec; control: ParamControl }>();
  private readonly power = el<HTMLButtonElement>('button', { className: 'mini power', textContent: '⏻', title: 'Accendi/spegni la banda (doppio clic sul punto)' });
  private readonly tap: SpectrumTap;
  private readonly pre: Float32Array<ArrayBuffer>;
  private readonly post: Float32Array<ArrayBuffer>;
  private values: Record<string, number> = {};
  private params: ParamValues | null = null;
  private bands: EqBand[] = [];
  private enabled = true;
  private selected = 0;
  private hover: number | null = null;
  private pointer: { x: number; y: number } | null = null;
  private drag: Drag | null = null;
  private dirty = true;
  /** Lo spettro era disegnato nell'ultimo fotogramma (serve un disegno in più quando si spegne). */
  private spectrumShown = false;

  constructor(private readonly ctx: DisplayContext) {
    this.graph = new EqGraph(this.canvas, ctx.sampleRate);
    this.tap = ctx.openSpectrum();
    this.pre = new Float32Array(this.tap.binCount);
    this.post = new Float32Array(this.tap.binCount);
    this.bandButtons = Array.from({ length: EQ_BANDS }, (_, i) => {
      const b = el<HTMLButtonElement>('button', { className: 'eq-band', textContent: String(i + 1), title: `Banda ${i + 1}` });
      b.style.setProperty('--band', BAND_COLORS[i]);
      b.onclick = () => this.select(i);
      b.ondblclick = () => this.toggle(i);
      return b;
    });
    this.power.onclick = () => this.toggle(this.selected);
    this.element.append(this.canvas, el('div', { className: 'eq-bottom' }, el('div', { className: 'eq-bands' }, ...this.bandButtons), this.controls));
    this.bindGraph();
    this.update(ctx.settings, true);
    this.select(Math.max(0, this.bands.findIndex(b => b.on)), true);
    requestAnimationFrame(this.frame);
  }

  update(settings: DeviceSettings, enabled: boolean): void {
    if (settings.params !== this.params) {
      this.params = settings.params;
      this.values = resolveParams(this.ctx.type, settings.params);
      this.bands = bandsOf(this.values);
    }
    this.enabled = enabled;
    this.refresh();
  }

  /** Bande, interruttore e controlli dai valori attuali. */
  private refresh(): void {
    this.bandButtons.forEach((b, i) => {
      b.classList.toggle('on', this.bands[i].on);
      b.classList.toggle('selected', i === this.selected);
    });
    this.power.classList.toggle('on', !!this.bands[this.selected]?.on);
    for (const { spec, control } of this.bandControls.values()) {
      control.set(this.values[spec.id]);
      setActive(control, paramActive(spec, this.values));
    }
    this.dirty = true;
  }

  // ---------------------------------------------------------------- bande e controlli

  private select(i: number, force = false): void {
    if (i === this.selected && !force) return;
    this.selected = i;
    this.buildControls();
    this.refresh();
  }

  private toggle(i: number): void {
    this.ctx.setParams({ [bandParam(i, 'on')]: this.bands[i].on ? 0 : 1 }, true);
  }

  private spec(i: number, key: BandKey): ParamSpec {
    return paramSpec(this.ctx.type, bandParam(i, key))!;
  }

  /** I controlli della banda scelta e quello dell'uscita, generati dai loro parametri. */
  private buildControls(): void {
    const i = this.selected;
    this.bandControls.clear();
    const make = (spec: ParamSpec) => {
      const control = controlFor(spec, this.values[spec.id], (v, final) => this.ctx.setParams({ [spec.id]: v }, final));
      this.bandControls.set(spec.id, { spec, control });
      return control.element;
    };
    const title = el('div', { className: 'eq-band-title', textContent: `Banda ${i + 1}` });
    title.style.setProperty('--band', BAND_COLORS[i]);
    this.controls.replaceChildren(
      el('div', { className: 'eq-band-head' }, title, this.power),
      ...BAND_CONTROLS.map(k => make(this.spec(i, k))),
      el('div', { className: 'eq-sep' }),
      make(paramSpec(this.ctx.type, 'output')!));
    this.ctx.controlsChanged();
  }

  // ---------------------------------------------------------------- gesti sul grafico

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private bindGraph(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const p = this.local(e), hit = this.graph.hit(this.bands, p.x, p.y);
      if (hit === null) return;
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      this.select(hit);
      const node = this.graph.nodeAt(this.bands[hit]);
      this.drag = { band: hit, pointerId: e.pointerId, dx: p.x - node.x, dy: p.y - node.y, x: node.x, y: node.y, lastX: p.x, lastY: p.y, last: null };
    });
    c.addEventListener('pointermove', e => {
      const p = this.local(e);
      this.pointer = p;
      const d = this.drag;
      if (d && d.pointerId === e.pointerId) this.dragTo(d, p, e.shiftKey);
      else {
        const hit = this.graph.hit(this.bands, p.x, p.y);
        if (hit !== this.hover) this.hover = hit;
        c.style.cursor = hit === null ? 'crosshair' : 'grab';
      }
      this.dirty = true;
    });
    const end = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || d.pointerId !== e.pointerId) return;
      this.drag = null;
      if (d.last) this.ctx.setParams(d.last, true);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => {
      if (this.drag) return;
      this.hover = null;
      this.pointer = null;
      this.dirty = true;
    });
    c.addEventListener('dblclick', e => {
      const p = this.local(e), hit = this.graph.hit(this.bands, p.x, p.y);
      if (hit !== null) return this.toggle(hit);
      this.addAt(p);
    });
    c.addEventListener('wheel', e => {
      const i = this.hover ?? this.selected;
      e.preventDefault();
      const q = this.spec(i, 'q');
      const unit = paramToUnit(q, this.values[q.id]) - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.02);
      this.ctx.setParams({ [q.id]: paramFromUnit(q, unit) }, true);
    }, { passive: false });
    c.addEventListener('contextmenu', e => {
      e.preventDefault();
      const p = this.local(e), hit = this.graph.hit(this.bands, p.x, p.y);
      const i = hit ?? this.selected;
      this.select(i);
      showContextMenu(e.clientX, e.clientY, this.bandMenu(i));
    });
  }

  /** Muove il punto della banda: frequenza in orizzontale, guadagno in verticale (Maiusc: fine). */
  private dragTo(d: Drag, p: { x: number; y: number }, fine: boolean): void {
    const scale = this.graph.geometry;
    if (fine) {
      d.x += (p.x - d.lastX) * 0.1;
      d.y += (p.y - d.lastY) * 0.1;
    } else {
      d.x = p.x - d.dx;
      d.y = p.y - d.dy;
    }
    d.lastX = p.x;
    d.lastY = p.y;
    const band = this.bands[d.band];
    const values: Record<string, number> = { [bandParam(d.band, 'freq')]: clamp(scale.xToFreq(d.x), MIN_FREQ, MAX_FREQ) };
    if (BAND_TYPES[band.type]?.gain) values[bandParam(d.band, 'gain')] = Math.round(clamp(scale.yToDb(d.y), -MAX_GAIN, MAX_GAIN) * 10) / 10;
    d.last = values;
    this.ctx.setParams(values, false);
  }

  /** Doppio clic dove non c'è un punto: accende lì la prima banda spenta. */
  private addAt(p: { x: number; y: number }): void {
    const i = this.bands.findIndex(b => !b.on);
    if (i < 0) return;
    const scale = this.graph.geometry;
    const values: Record<string, number> = { [bandParam(i, 'on')]: 1, [bandParam(i, 'freq')]: clamp(scale.xToFreq(p.x), MIN_FREQ, MAX_FREQ) };
    if (BAND_TYPES[this.bands[i].type]?.gain) values[bandParam(i, 'gain')] = Math.round(clamp(scale.yToDb(p.y), -MAX_GAIN, MAX_GAIN) * 10) / 10;
    this.select(i);
    this.ctx.setParams(values, true);
  }

  private bandMenu(i: number): MenuItem[] {
    const band = this.bands[i];
    const reset = Object.fromEntries((['on', 'type', 'freq', 'gain', 'q', 'slope'] as BandKey[]).map(k => {
      const spec = this.spec(i, k);
      return [spec.id, spec.default];
    }));
    return [
      ...BAND_TYPES.map((t, type) => ({
        label: t.label, checked: band.type === type,
        run: () => this.ctx.setParams({ [bandParam(i, 'type')]: type, [bandParam(i, 'on')]: 1 }, true),
      })),
      SEPARATOR,
      ...(BAND_TYPES[band.type]?.cut ? SLOPES.map((s, slope) => ({
        label: `Pendenza ${s.label}`, checked: band.slope === slope,
        run: () => this.ctx.setParams({ [bandParam(i, 'slope')]: slope }, true),
      })) : []),
      { label: band.on ? `Spegni la banda ${i + 1}` : `Accendi la banda ${i + 1}`, shortcut: 'doppio clic', run: () => this.toggle(i) },
      { label: 'Riporta la banda com\'era', run: () => this.ctx.setParams(reset, true) },
    ];
  }

  // ---------------------------------------------------------------- disegno

  /** Testo della banda sotto il mouse (o trascinata). */
  private label(): string {
    const i = this.drag?.band ?? this.hover;
    if (i === null) return '';
    const band = this.bands[i], type = BAND_TYPES[band.type];
    const fmt = (k: BandKey) => formatParam(this.spec(i, k), this.values[bandParam(i, k)]);
    const parts = [`${i + 1}`, type.label, fmt('freq')];
    if (type.gain) parts.push(signedDb(band.gain));
    parts.push(`Q ${fmt('q')}`);
    if (type.cut) parts.push(fmt('slope'));
    return parts.join(' · ') + (band.on ? '' : ' (spenta)');
  }

  /** Frequenza e guadagno sotto il mouse, quando non è su un punto. */
  private readout(): string {
    if (!this.pointer || this.hover !== null || this.drag) return '';
    const s = this.graph.geometry;
    const freq = formatParam(this.spec(0, 'freq'), s.xToFreq(this.pointer.x));
    return `${freq} · ${signedDb(s.yToDb(this.pointer.y))}`;
  }

  private readonly frame = (): void => {
    if (!this.element.isConnected) {
      this.tap.dispose();
      return;
    }
    requestAnimationFrame(this.frame);
    if (this.element.offsetParent === null) return; // pannello nascosto
    const live = this.tap.read(this.pre, this.post) && this.post.some(v => v > SPECTRUM_BOTTOM - 10);
    if (!this.dirty && !live && !this.spectrumShown) return;
    const spectrum: Spectrum | null = live ? { pre: this.pre, post: this.post, sampleRate: this.tap.sampleRate } : null;
    const t0 = performance.now();
    this.graph.draw({
      bands: this.bands, output: this.values.output ?? 0, enabled: this.enabled,
      selected: this.selected, hover: this.drag?.band ?? this.hover, label: this.label(), readout: this.readout(),
    }, spectrum);
    eqDrawStats.frames++;
    eqDrawStats.ms += performance.now() - t0;
    this.spectrumShown = live;
    this.dirty = false;
  };
}
