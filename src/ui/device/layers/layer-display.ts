/* The panel of the layered instruments (the Kick, the Snare). On the left the hit as it is: the
 * waveform computed with the same engine that plays (with the loaded samples) and, above, the curve
 * of the pitch falling to the note; a click plays it. On the right the layer tabs
 * in the order they're heard, then the note and the output. The layers that can play a sample
 * have the sample choice: an audio file (or a browser sample) dropped on their tab
 * becomes their sample. Each instrument says what its panel is like (LayerLayout). */
import type { SampleId } from '../../../core/id';
import { paramActive, paramSpec, resolveParams } from '../../../devices/device-type';
import type { InstrumentCore, SampleData, SamplePlayer } from '../../../devices/dsp/core';
import type { ParamSpec } from '../../../devices/params';
import { sampleAt, type DeviceSettings, type ParamValues } from '../../../model/device';
import { acceptBrowserDrops } from '../../browser/browser-drag';
import { el } from '../../dom';
import { controlFor, setActive, type ParamControl } from '../controls';
import type { DeviceDisplay, DisplayContext } from '../displays';

/** The files that can be dropped on a tab. */
const isAudio = (f: File) => f.type.startsWith('audio/') || /\.(wav|aiff?|flac|mp3|ogg|m4a)$/i.test(f.name);

export interface LayerCard {
  readonly title: string;
  /** The choice of the source (or the switch), in the tab's header. */
  readonly source?: string;
  /** The sample's slot, for the layers that can play one. */
  readonly slot?: string;
  readonly params: readonly string[];
}

/** A layer that can play a sample: its slot, the source parameter with the
 *  "Sample" value, and the times to lengthen (given the values) so the sample is heard. */
export interface SampleLayer {
  readonly slot: string;
  readonly source: string;
  readonly sample: number;
  readonly times?: (values: Readonly<Record<string, number>>) => ParamValues;
}

/** The pitch to draw: where it arrives (Hz) and where it is at `t` seconds. */
export interface PitchCurve {
  readonly base: number;
  at(t: number): number;
}

export interface LayerLayout {
  /** The instrument's name, for the messages. */
  readonly name: string;
  readonly cards: readonly LayerCard[];
  readonly samples: readonly SampleLayer[];
  /** The controls that, when they don't count (they depend on the source), are removed instead of dimmed. */
  readonly swapped: ReadonlySet<string>;
  /** The choices that sit better in a menu. */
  readonly menus: ReadonlySet<string>;
  /** The parameters that, changed, make the hit heard. */
  readonly audition: ReadonlySet<string>;
  /** The note the test hit plays. */
  readonly rootNote: number;
  /** The frequency scale of the pitch curve. */
  readonly lowHz: number;
  readonly highHz: number;
  /** The engine computing the hit to draw. */
  core(sampleRate: number): InstrumentCore & SamplePlayer;
  /** How long the hit to draw lasts (in seconds). */
  seconds(values: Readonly<Record<string, number>>): number;
  /** The body's pitch curve, or null if the body doesn't have one (a sample). */
  pitch(values: Readonly<Record<string, number>>): PitchCurve | null;
  /** At the top right, on the hit. */
  hint(values: Readonly<Record<string, number>>): string;
}

const AUDITION_VELOCITY = 120;
const ACCENT = '#ff9d2e';
const CURVE = '#7fb6ff';

/** A sharp canvas, resized to its place. */
function fit(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return null;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) Object.assign(c, { width: Math.round(w * dpr), height: Math.round(h * dpr) });
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

export class LayerDisplay implements DeviceDisplay {
  readonly element = el('div', { className: 'lay' });
  private readonly wave = el<HTMLCanvasElement>('canvas', { className: 'lay-wave', title: 'The hit: waveform and pitch (click: play)' });
  private readonly controls = new Map<string, { control: ParamControl; spec: ParamSpec }>();
  private readonly sampleRows = new Map<string, { row: HTMLElement; choice: HTMLSelectElement }>();
  private values: Record<string, number>;
  private params: ParamValues | null = null;
  private enabled = true;
  private dirty = true;
  /** The samples the hit was drawn with: if they change (loaded later), it's redrawn. */
  private drawnWith: (SampleData | undefined)[] = [];
  /** The computed hit and how long the drawing lasts. */
  private rendered: Float32Array = new Float32Array(0);
  private seconds = 1;
  private shown = false;

  constructor(private readonly ctx: DisplayContext, private readonly layout: LayerLayout) {
    this.values = resolveParams(ctx.type, ctx.settings.params);
    this.wave.addEventListener('pointerdown', e => {
      if (e.button === 0) this.audition();
    });
    const left = el('div', { className: 'lay-left' }, this.wave);
    this.element.append(left, el('div', { className: 'lay-cards' }, ...layout.cards.map(c => this.card(c))));
    this.update(ctx.settings, true);
    new ResizeObserver(() => { this.dirty = true; }).observe(this.wave);
    requestAnimationFrame(this.frame);
  }

  update(settings: DeviceSettings, enabled: boolean): void {
    this.enabled = enabled;
    if (settings.params !== this.params) {
      this.params = settings.params;
      this.values = resolveParams(this.ctx.type, settings.params);
    }
    for (const { control, spec } of this.controls.values()) {
      control.set(this.values[spec.id]);
      const active = paramActive(spec, this.values);
      if (this.layout.swapped.has(spec.id)) control.element.hidden = !active;
      else setActive(control, active);
    }
    for (const [slot, { row, choice }] of this.sampleRows) {
      const layer = this.layer(slot);
      row.hidden = this.values[layer.source] !== layer.sample || !this.ctx.samples;
      if (!row.hidden) {
        const all = this.ctx.samples?.list() ?? [];
        choice.replaceChildren(el('option', { value: '', textContent: '— no sample —' }),
          ...all.map(s => el('option', { value: s.id, textContent: s.name })));
        choice.value = sampleAt(settings, slot) ?? '';
      }
    }
    this.dirty = true;
  }

  private audition(): void {
    this.ctx.audition(this.layout.rootNote, AUDITION_VELOCITY);
  }

  private layer(slot: string): SampleLayer {
    return this.layout.samples.find(x => x.slot === slot)!;
  }

  // ---------------------------------------------------------------- tabs

  private card(c: LayerCard): HTMLElement {
    const head = el('div', { className: 'lay-card-head' }, el('span', { className: 'lay-card-title', textContent: c.title }));
    if (c.source) head.append(this.control(c.source));
    const knobs = el('div', { className: 'lay-knobs' }, ...c.params.map(id => this.control(id)));
    const card = el('div', { className: 'lay-card' }, head);
    if (c.slot) card.append(this.sampleRow(c.slot));
    card.append(knobs);
    if (c.slot) this.acceptSamples(card, c.slot);
    return card;
  }

  private control(id: string): HTMLElement {
    const spec = paramSpec(this.ctx.type, id)!;
    const control = controlFor(spec, this.values[id], (v, final) => this.set(id, v, final), { menu: this.layout.menus.has(id) });
    this.controls.set(id, { control, spec });
    return control.element;
  }

  /** A changed parameter. Choosing a sample as the source, the times lengthen as much as needed
   *  to hear it (a sample lasts longer than a click). */
  private set(id: string, v: number, final: boolean): void {
    const layer = this.layout.samples.find(x => x.source === id);
    const times = layer && v === layer.sample ? layer.times?.(this.values) ?? {} : {};
    this.ctx.setParams({ [id]: v, ...times }, final);
    if (final && this.layout.audition.has(id)) this.audition();
  }

  /** The layer's sample: chosen among the project's or loaded from disk. */
  private sampleRow(slot: string): HTMLElement {
    const choice = el<HTMLSelectElement>('select', { className: 'lay-sample', title: 'The sample (among the project\'s)' });
    choice.onchange = () => {
      this.assign(slot, (choice.value || null) as SampleId | null);
    };
    const load = el<HTMLButtonElement>('button', { className: 'mini', textContent: 'Load…', title: 'Load an audio file (or drag it onto the tab)' });
    load.onclick = () => {
      const input = el<HTMLInputElement>('input', { type: 'file', accept: 'audio/*' });
      input.onchange = () => { const f = input.files?.[0]; if (f) void this.load(slot, f); };
      input.click();
    };
    const row = el('div', { className: 'lay-sample-row' }, choice, load);
    this.sampleRows.set(slot, { row, choice });
    return row;
  }

  /** The layer's source becomes Sample (with the times to hear it), if it wasn't already. */
  private asSample(slot: string): ParamValues {
    const layer = this.layer(slot);
    return this.values[layer.source] === layer.sample ? {} : { [layer.source]: layer.sample, ...layer.times?.(this.values) };
  }

  private assign(slot: string, id: SampleId | null): void {
    this.ctx.samples?.assign({ [slot]: id }, id ? this.asSample(slot) : {});
    if (id) this.audition();
  }

  private async load(slot: string, file: File): Promise<void> {
    try {
      await this.ctx.samples?.load(slot, file, this.asSample(slot));
      this.audition();
    } catch (err) {
      console.warn(`${this.layout.name}: can't load "${file.name}"`, err);
    }
  }

  /** An audio file or a browser sample dropped on the tab becomes the layer's sample. */
  private acceptSamples(card: HTMLElement, slot: string): void {
    if (!this.ctx.samples) return;
    const files = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    card.addEventListener('dragover', e => {
      if (!files(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer!.dropEffect = 'copy';
      card.classList.add('drop');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drop'));
    card.addEventListener('drop', e => {
      if (!files(e)) return;
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove('drop');
      const file = [...e.dataTransfer!.files].find(isAudio);
      if (file) void this.load(slot, file);
    });
    acceptBrowserDrops(card, item => {
      const p = item.payload;
      if (p?.kind === 'sample') this.assign(slot, p.sample.id);
      else if (p?.kind === 'file') void p.file().then(f => this.load(slot, f));
    }, { accept: item => item.payload?.kind === 'sample' || item.payload?.kind === 'file' });
  }

  // ---------------------------------------------------------------- the hit

  private readonly frame = (): void => {
    if (this.element.isConnected) this.shown = true;
    else if (this.shown) return;
    requestAnimationFrame(this.frame);
    if (this.element.offsetParent === null) return;
    const audio = this.layout.samples.map(x => this.ctx.samples?.audio?.(x.slot));
    if (audio.some((a, i) => a !== this.drawnWith[i])) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.drawnWith = audio;
    this.renderHit(audio);
    this.paint();
  };

  /** The hit, computed with the real engine (at reduced rate: enough to draw it). */
  private renderHit(audio: (SampleData | undefined)[]): void {
    const rate = 24000, seconds = this.layout.seconds(this.values), n = Math.round(seconds * rate);
    const core = this.layout.core(rate);
    core.setParams({ ...this.values, velocity: 0 });
    this.layout.samples.forEach((x, i) => core.setSample(x.slot, audio[i] ?? null));
    core.noteOn(1, this.layout.rootNote, 127);
    const left = new Float32Array(n), right = new Float32Array(n);
    for (let f = 0; f < n; f += 256) core.render(left, right, f, Math.min(n, f + 256));
    for (let i = 0; i < n; i++) left[i] = (left[i] + right[i]) * 0.5;
    this.rendered = left;
    this.seconds = seconds;
  }

  private paint(): void {
    const g = fit(this.wave);
    if (!g) return;
    const { lowHz, highHz } = this.layout;
    const w = this.wave.clientWidth, h = this.wave.clientHeight, v = this.values, mid = h * 0.58, amp = h * 0.4;
    g.fillStyle = '#15181c';
    g.fillRect(0, 0, w, h);
    // the time: a line every 50, 100 or 250 ms
    const step = this.seconds > 1.2 ? 0.25 : this.seconds > 0.5 ? 0.1 : 0.05;
    g.font = '10px system-ui, sans-serif';
    for (let t = step; t < this.seconds; t += step) {
      const x = Math.round((t / this.seconds) * w) + 0.5;
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.fillText(`${Math.round(t * 1000)}`, x + 2, h - 3);
    }
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.beginPath(); g.moveTo(0, mid + 0.5); g.lineTo(w, mid + 0.5); g.stroke();
    // the waveform: minimum and maximum per column
    const x = this.rendered, per = x.length / w;
    let top = 1e-9;
    for (const s of x) top = Math.max(top, Math.abs(s));
    const scale = amp / Math.max(1, top);
    g.globalAlpha = this.enabled ? 1 : 0.4;
    g.fillStyle = ACCENT;
    for (let c = 0; c < w; c++) {
      let lo = 0, hi = 0;
      for (let i = Math.floor(c * per), end = Math.min(x.length, Math.floor((c + 1) * per)); i < end; i++) {
        if (x[i] < lo) lo = x[i];
        if (x[i] > hi) hi = x[i];
      }
      g.fillRect(c, mid - hi * scale, 1, Math.max(1, (hi - lo) * scale));
    }
    // the body's pitch: from the top down to the note, on an octave scale
    const yOf = (hz: number) => h - 14 - ((Math.log2(hz / lowHz) / Math.log2(highHz / lowHz)) * (h - 26));
    const pitch = this.layout.pitch(v);
    if (pitch) {
      g.strokeStyle = CURVE;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let c = 0; c <= w; c += 2) {
        const y = yOf(Math.min(highHz, pitch.at((c / w) * this.seconds)));
        if (c) g.lineTo(c, y);
        else g.moveTo(c, y);
      }
      g.stroke();
      g.lineWidth = 1;
      g.globalAlpha = 1;
      g.setLineDash([3, 3]);
      g.strokeStyle = 'rgba(127,182,255,0.45)';
      const yb = Math.round(yOf(pitch.base)) + 0.5;
      g.beginPath(); g.moveTo(0, yb); g.lineTo(w, yb); g.stroke();
      g.setLineDash([]);
    }
    g.globalAlpha = 1;
    // the note, at the top
    const note = paramSpec(this.ctx.type, 'note');
    const name = note?.kind === 'choice' ? note.options[v.note] : '';
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = '600 12px system-ui, sans-serif';
    g.fillText(`${name}${v.fine ? ` ${v.fine > 0 ? '+' : ''}${v.fine} ct` : ''}`, 8, 16);
    g.font = '10px system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.textAlign = 'right';
    g.fillText(this.layout.hint(v), w - 6, 14);
    g.textAlign = 'left';
  }
}
