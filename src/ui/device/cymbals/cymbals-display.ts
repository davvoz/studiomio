/* Il pannello di Hat e Piatti. A sinistra i sei pezzi come pad (un clic sceglie il pezzo e lo
 * suona; un file audio o un sample del browser lasciato su un pad diventa il suo sample) e,
 * sotto, il colpo del pezzo scelto com'è, calcolato con lo stesso motore che suona. Accanto i
 * controlli del pezzo scelto, poi quelli di tutti i pezzi. */
import type { SampleId } from '../../../core/id';
import { paramActive, paramSpec, resolveParams } from '../../../devices/device-type';
import { PIECES, pieceOfNote, pieceParam, pieceSlot, SOURCE, type PieceKey } from '../../../devices/instruments/cymbals/cymbals';
import { CymbalsCore } from '../../../devices/instruments/cymbals/cymbals-core';
import type { SampleData } from '../../../devices/dsp/core';
import type { ParamSpec } from '../../../devices/params';
import { sampleAt, type DeviceSettings, type ParamValues } from '../../../model/device';
import { acceptBrowserDrops } from '../../browser/browser-drag';
import { el } from '../../dom';
import { pitchName } from '../../piano-roll/pitch-axis';
import { controlFor, setActive, type ParamControl } from '../controls';
import type { DeviceDisplay, DisplayContext } from '../displays';

/** I file che si possono lasciare su un pad. */
const isAudio = (f: File) => f.type.startsWith('audio/') || /\.(wav|aiff?|flac|mp3|ogg|m4a)$/i.test(f.name);

/** I controlli del pezzo scelto (la sorgente sta nell'intestazione). */
const PIECE_CONTROLS: readonly PieceKey[] = ['tune', 'decay', 'tone', 'noise', 'bell', 'level', 'pan'];
const GLOBAL_CONTROLS = ['metal', 'variation', 'width', 'drive', 'velocity', 'volume'];
/** I controlli che, quando non contano (dipendono dalla sorgente), si tolgono invece di attenuarsi. */
const SWAPPED: ReadonlySet<PieceKey> = new Set(['noise', 'bell']);
/** Gli hi-hat in giallo, i piatti in azzurro. */
const COLORS = ['#f2d14b', '#e8c06a', '#f2b84b', '#7fb6ff', '#4fd1e0', '#c79bff'];

const AUDITION_VELOCITY = 110;
/** Quanto si disegna del colpo, al massimo e al minimo (in secondi). */
const MAX_VIEW = 4;
const MIN_VIEW = 0.12;

/** Un canvas nitido, ridimensionato al suo posto. */
function fit(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return null;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) Object.assign(c, { width: Math.round(w * dpr), height: Math.round(h * dpr) });
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

/** Il pezzo scelto (resta fra un pannello e l'altro). */
const view = { piece: 0 };

export class CymbalsDisplay implements DeviceDisplay {
  readonly element = el('div', { className: 'cym' });
  private readonly pads: HTMLButtonElement[];
  private readonly wave = el<HTMLCanvasElement>('canvas', { className: 'cym-wave', title: 'Il colpo del pezzo scelto (clic: suona)' });
  private readonly title = el('span', { className: 'cym-card-title' });
  private readonly sourceSlot = el('div', { className: 'cym-source' });
  private readonly sampleChoice = el<HTMLSelectElement>('select', { className: 'cym-sample', title: 'Il sample del pezzo (tra quelli del progetto)' });
  private readonly sampleRow: HTMLElement;
  private readonly knobs = el('div', { className: 'cym-knobs' });
  private readonly controls = new Map<string, { control: ParamControl; spec: ParamSpec }>();
  private values: Record<string, number>;
  private params: ParamValues | null = null;
  private settings: DeviceSettings;
  private enabled = true;
  private dirty = true;
  private drawnWith: SampleData | undefined;
  private drawnPiece = -1;
  private rendered = new Float32Array(0);
  private seconds = 1;
  private shown = false;

  constructor(private readonly ctx: DisplayContext) {
    this.settings = ctx.settings;
    this.values = resolveParams(ctx.type, ctx.settings.params);
    this.pads = PIECES.map((_, i) => this.pad(i));
    this.wave.addEventListener('pointerdown', e => { if (e.button === 0) this.play(view.piece); });
    this.sampleChoice.onchange = () => this.assign(view.piece, (this.sampleChoice.value || null) as SampleId | null);
    const load = el<HTMLButtonElement>('button', { className: 'mini', textContent: 'Carica…', title: 'Carica un file audio sul pezzo (o trascinalo sul suo pad)' });
    load.onclick = () => this.pickFile(view.piece);
    this.sampleRow = el('div', { className: 'cym-sample-row' }, this.sampleChoice, load);
    const global = el('div', { className: 'cym-knobs' }, ...GLOBAL_CONTROLS.map(id => this.control(id)));
    this.element.append(
      el('div', { className: 'cym-left' }, el('div', { className: 'cym-pads' }, ...this.pads), el('div', { className: 'cym-wave-box' }, this.wave)),
      el('div', { className: 'cym-card' }, el('div', { className: 'cym-card-head' }, this.title, this.sourceSlot), this.sampleRow, this.knobs),
      el('div', { className: 'cym-card' }, el('div', { className: 'cym-card-head' }, el('span', { className: 'cym-card-title', textContent: 'Tutti i pezzi' })), global));
    this.select(Math.min(view.piece, PIECES.length - 1));
    new ResizeObserver(() => { this.dirty = true; }).observe(this.wave);
    requestAnimationFrame(this.frame);
  }

  update(settings: DeviceSettings, enabled: boolean): void {
    this.settings = settings;
    this.enabled = enabled;
    if (settings.params !== this.params) {
      this.params = settings.params;
      this.values = resolveParams(this.ctx.type, settings.params);
    }
    this.refresh();
  }

  /** Il pezzo scelto (per i test automatici). */
  get selectedPiece(): number {
    return view.piece;
  }

  /** Sceglie il pezzo da modificare (la Drum Machine: quello che suona il suo pad). */
  selectPiece(i: number): void {
    if (i !== view.piece && PIECES[i]) this.select(i);
  }

  private refresh(): void {
    const i = view.piece;
    this.pads.forEach((b, k) => {
      b.classList.toggle('selected', k === i);
      b.classList.toggle('sample', this.values[pieceParam(k, 'source')] === SOURCE.sample);
    });
    this.title.textContent = `${PIECES[i].label} · ${pitchName(PIECES[i].note)}`;
    const swapped = new Set([...SWAPPED].map(k => pieceParam(i, k)));
    for (const { control, spec } of this.controls.values()) {
      control.set(this.values[spec.id]);
      const active = paramActive(spec, this.values);
      if (swapped.has(spec.id)) control.element.hidden = !active;
      else setActive(control, active);
    }
    const isSample = this.values[pieceParam(i, 'source')] === SOURCE.sample;
    this.sampleRow.hidden = !isSample || !this.ctx.samples;
    if (!this.sampleRow.hidden) {
      const all = this.ctx.samples?.list() ?? [];
      this.sampleChoice.replaceChildren(el('option', { value: '', textContent: '— nessun sample —' }),
        ...all.map(s => el('option', { value: s.id, textContent: s.name })));
      this.sampleChoice.value = sampleAt(this.settings, pieceSlot(i)) ?? '';
    }
    this.dirty = true;
  }

  private select(i: number): void {
    view.piece = i;
    for (const id of [...this.controls.keys()]) if (!GLOBAL_CONTROLS.includes(id)) this.controls.delete(id);
    this.sourceSlot.replaceChildren(this.control(pieceParam(i, 'source'), true));
    this.knobs.replaceChildren(...PIECE_CONTROLS.map(k => this.control(pieceParam(i, k))));
    this.refresh();
    this.ctx.controlsChanged();
  }

  private control(id: string, menu = false): HTMLElement {
    const spec = paramSpec(this.ctx.type, id)!;
    const control = controlFor(spec, this.values[id], (v, final) => this.ctx.setParams({ [id]: v }, final), { menu: menu || id === 'metal' });
    this.controls.set(id, { control, spec });
    return control.element;
  }

  private play(i: number): void {
    this.ctx.audition(PIECES[i].note, AUDITION_VELOCITY);
    this.flash(i);
  }

  private flash(i: number): void {
    const b = this.pads[i];
    b.classList.remove('hit');
    void b.offsetWidth; // fa ripartire l'animazione
    b.classList.add('hit');
  }

  private pad(i: number): HTMLButtonElement {
    const p = PIECES[i];
    const b = el<HTMLButtonElement>('button', { className: 'cym-pad', title: 'Clic: scegli e suona · lascia qui un file audio: diventa il suo sample' },
      el('span', { className: 'cym-pad-name', textContent: p.label }), el('span', { className: 'cym-pad-note', textContent: pitchName(p.note) }));
    b.style.setProperty('--pad', COLORS[i]);
    b.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (view.piece !== i) this.select(i);
      this.play(i);
    });
    if (!this.ctx.samples) return b;
    const files = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    b.addEventListener('dragover', e => {
      if (!files(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer!.dropEffect = 'copy';
      b.classList.add('drop');
    });
    b.addEventListener('dragleave', () => b.classList.remove('drop'));
    b.addEventListener('drop', e => {
      if (!files(e)) return;
      e.preventDefault();
      e.stopPropagation();
      b.classList.remove('drop');
      const file = [...e.dataTransfer!.files].find(isAudio);
      if (file) void this.load(i, file);
    });
    acceptBrowserDrops(b, item => {
      const payload = item.payload;
      if (payload?.kind === 'sample') this.assign(i, payload.sample.id);
      else if (payload?.kind === 'file') void payload.file().then(f => this.load(i, f));
    }, { accept: item => item.payload?.kind === 'sample' || item.payload?.kind === 'file' });
    return b;
  }

  /** Il pezzo diventa un pezzo Sample, se non lo era già. */
  private asSample(i: number): ParamValues {
    return this.values[pieceParam(i, 'source')] === SOURCE.sample ? {} : { [pieceParam(i, 'source')]: SOURCE.sample };
  }

  private assign(i: number, id: SampleId | null): void {
    this.ctx.samples?.assign({ [pieceSlot(i)]: id }, id ? this.asSample(i) : {});
    if (view.piece !== i) this.select(i);
    if (id) this.play(i);
  }

  private async load(i: number, file: File): Promise<void> {
    try {
      await this.ctx.samples?.load(pieceSlot(i), file, this.asSample(i));
      if (view.piece !== i) this.select(i);
      this.play(i);
    } catch (err) {
      console.warn(`Hat e Piatti: impossibile caricare "${file.name}"`, err);
    }
  }

  private pickFile(i: number): void {
    const input = el<HTMLInputElement>('input', { type: 'file', accept: 'audio/*' });
    input.onchange = () => { const f = input.files?.[0]; if (f) void this.load(i, f); };
    input.click();
  }

  // ---------------------------------------------------------------- il colpo

  private readonly frame = (): void => {
    if (this.element.isConnected) this.shown = true;
    else if (this.shown) return;
    requestAnimationFrame(this.frame);
    for (const pitch of this.ctx.playedNotes()) {
      const i = pieceOfNote(pitch);
      if (i >= 0) this.flash(i);
    }
    if (this.element.offsetParent === null) return;
    const audio = this.ctx.samples?.audio?.(pieceSlot(view.piece));
    if (audio !== this.drawnWith || view.piece !== this.drawnPiece) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.drawnWith = audio;
    this.drawnPiece = view.piece;
    this.renderHit(audio);
    this.paint();
  };

  /** Il colpo del pezzo scelto, calcolato con il motore vero (a frequenza ridotta: per disegnarlo basta). */
  private renderHit(audio: SampleData | undefined): void {
    const i = view.piece, rate = 24000;
    const seconds = Math.max(MIN_VIEW, Math.min(MAX_VIEW, this.values[pieceParam(i, 'decay')] * 0.8));
    const n = Math.round(seconds * rate), core = new CymbalsCore(rate);
    core.setParams({ ...this.values, velocity: 0, variation: 0 });
    core.setSample(pieceSlot(i), audio ?? null);
    core.noteOn(1, PIECES[i].note, 127);
    const left = new Float32Array(n), right = new Float32Array(n);
    for (let f = 0; f < n; f += 256) core.render(left, right, f, Math.min(n, f + 256));
    for (let k = 0; k < n; k++) left[k] = (left[k] + right[k]) * 0.5;
    this.rendered = left;
    this.seconds = seconds;
  }

  private paint(): void {
    const g = fit(this.wave);
    if (!g) return;
    const w = this.wave.clientWidth, h = this.wave.clientHeight, mid = h / 2;
    g.fillStyle = '#15181c';
    g.fillRect(0, 0, w, h);
    const step = this.seconds > 2 ? 0.5 : this.seconds > 0.8 ? 0.25 : this.seconds > 0.3 ? 0.1 : 0.025;
    g.font = '10px system-ui, sans-serif';
    for (let t = step; t < this.seconds; t += step) {
      const x = Math.round((t / this.seconds) * w) + 0.5;
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.fillText(`${Math.round(t * 1000)}`, x + 2, h - 3);
    }
    const x = this.rendered, per = x.length / w;
    let top = 1e-9;
    for (const s of x) top = Math.max(top, Math.abs(s));
    const scale = (h * 0.45) / top;
    g.globalAlpha = this.enabled ? 1 : 0.4;
    g.fillStyle = COLORS[view.piece];
    for (let c = 0; c < w; c++) {
      let lo = 0, hi = 0;
      for (let i = Math.floor(c * per), end = Math.min(x.length, Math.floor((c + 1) * per)); i < end; i++) {
        if (x[i] < lo) lo = x[i];
        if (x[i] > hi) hi = x[i];
      }
      g.fillRect(c, mid - hi * scale, 1, Math.max(1, (hi - lo) * scale));
    }
    g.globalAlpha = 1;
    if (top < 1e-6) {
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.fillText('Nessun sample: trascina un file sul pad', 8, 16);
    }
  }
}
