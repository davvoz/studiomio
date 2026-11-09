/* The Hat and Cymbals panel. On the left the six pieces as pads (a click chooses the piece and
 * plays it; an audio file or a browser sample dropped on a pad becomes its sample) and,
 * below, the hit of the chosen piece as it is, computed with the same engine that plays. Next to it the
 * controls of the chosen piece, then those of all the pieces. */
import { pickAbove } from '../../../core/math';
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

/** The files that can be dropped on a pad. */
const isAudio = (f: File) => f.type.startsWith('audio/') || /\.(wav|aiff?|flac|mp3|ogg|m4a)$/i.test(f.name);

/** The controls of the chosen piece (the source is in the header). */
const PIECE_CONTROLS: readonly PieceKey[] = ['tune', 'decay', 'tone', 'noise', 'bell', 'level', 'pan'];
const GLOBAL_CONTROLS = ['metal', 'variation', 'width', 'drive', 'velocity', 'volume'];
/** The controls that, when they don't count (they depend on the source), are removed instead of dimmed. */
const SWAPPED: ReadonlySet<PieceKey> = new Set(['noise', 'bell']);
/** The hi-hats in yellow, the cymbals in light blue. */
const COLORS = ['#f2d14b', '#e8c06a', '#f2b84b', '#7fb6ff', '#4fd1e0', '#c79bff'];

const AUDITION_VELOCITY = 110;
/** How much of the hit is drawn, at most and at least (in seconds). */
const MAX_VIEW = 4;
const MIN_VIEW = 0.12;

/** A sharp canvas, resized to its place. */
function fit(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return null;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) Object.assign(c, { width: Math.round(w * dpr), height: Math.round(h * dpr) });
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

/** The chosen piece (it stays from one panel to the next). */
const view = { piece: 0 };

export class CymbalsDisplay implements DeviceDisplay {
  readonly element = el('div', { className: 'cym' });
  private readonly pads: HTMLButtonElement[];
  private readonly wave = el<HTMLCanvasElement>('canvas', { className: 'cym-wave', title: 'The hit of the chosen piece (click: play)' });
  private readonly title = el('span', { className: 'cym-card-title' });
  private readonly sourceSlot = el('div', { className: 'cym-source' });
  private readonly sampleChoice = el<HTMLSelectElement>('select', { className: 'cym-sample', title: 'The piece\'s sample (among the project\'s)' });
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
    const load = el<HTMLButtonElement>('button', { className: 'mini', textContent: 'Load…', title: 'Load an audio file on the piece (or drag it onto its pad)' });
    load.onclick = () => this.pickFile(view.piece);
    this.sampleRow = el('div', { className: 'cym-sample-row' }, this.sampleChoice, load);
    const global = el('div', { className: 'cym-knobs' }, ...GLOBAL_CONTROLS.map(id => this.control(id)));
    this.element.append(
      el('div', { className: 'cym-left' }, el('div', { className: 'cym-pads' }, ...this.pads), el('div', { className: 'cym-wave-box' }, this.wave)),
      el('div', { className: 'cym-card' }, el('div', { className: 'cym-card-head' }, this.title, this.sourceSlot), this.sampleRow, this.knobs),
      el('div', { className: 'cym-card' }, el('div', { className: 'cym-card-head' }, el('span', { className: 'cym-card-title', textContent: 'All the pieces' })), global));
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

  /** The chosen piece (for automated tests). */
  get selectedPiece(): number {
    return view.piece;
  }

  /** Chooses the piece to edit (the Drum Machine: the one its pad plays). */
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
      this.sampleChoice.replaceChildren(el('option', { value: '', textContent: '— no sample —' }),
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
    void b.offsetWidth; // restarts the animation
    b.classList.add('hit');
  }

  private pad(i: number): HTMLButtonElement {
    const p = PIECES[i];
    const b = el<HTMLButtonElement>('button', { className: 'cym-pad', title: 'Click: choose and play · drop an audio file here: it becomes its sample' },
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

  /** The piece becomes a Sample piece, if it wasn't already. */
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
      console.warn(`Hats and Cymbals: can't load "${file.name}"`, err);
    }
  }

  private pickFile(i: number): void {
    const input = el<HTMLInputElement>('input', { type: 'file', accept: 'audio/*' });
    input.onchange = () => { const f = input.files?.[0]; if (f) void this.load(i, f); };
    input.click();
  }

  // ---------------------------------------------------------------- the hit

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

  /** The hit of the chosen piece, computed with the real engine (at reduced rate: enough to draw it). */
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
    const step = pickAbove(this.seconds, [[2, 0.5], [0.8, 0.25], [0.3, 0.1]], 0.025);
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
      g.fillText('No sample: drag a file onto the pad', 8, 16);
    }
  }
}
