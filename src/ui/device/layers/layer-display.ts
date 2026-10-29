/* Il pannello degli strumenti a strati (il Kick, lo Snare). A sinistra il colpo com'è: la forma
 * d'onda calcolata con lo stesso motore che suona (con i sample caricati) e, sopra, la curva
 * dell'intonazione che cade fino alla nota; un clic lo suona. A destra le schede degli strati
 * nell'ordine in cui si sentono, poi la nota e l'uscita. Gli strati che possono suonare un sample
 * hanno la scelta del sample: un file audio (o un sample del browser) lasciato sulla loro scheda
 * ci diventa il loro sample. Ogni strumento dice com'è fatto il suo pannello (LayerLayout). */
import type { SampleId } from '../../../core/id';
import { paramActive, paramSpec, resolveParams } from '../../../devices/device-type';
import type { InstrumentCore, SampleData, SamplePlayer } from '../../../devices/dsp/core';
import type { ParamSpec } from '../../../devices/params';
import { sampleAt, type DeviceSettings, type ParamValues } from '../../../model/device';
import { acceptBrowserDrops } from '../../browser/browser-drag';
import { el } from '../../dom';
import { controlFor, setActive, type ParamControl } from '../controls';
import type { DeviceDisplay, DisplayContext } from '../displays';

/** I file che si possono lasciare su una scheda. */
const isAudio = (f: File) => f.type.startsWith('audio/') || /\.(wav|aiff?|flac|mp3|ogg|m4a)$/i.test(f.name);

export interface LayerCard {
  readonly title: string;
  /** La scelta della sorgente (o l'interruttore), nell'intestazione della scheda. */
  readonly source?: string;
  /** Il posto del sample, per gli strati che possono suonarne uno. */
  readonly slot?: string;
  readonly params: readonly string[];
}

/** Uno strato che può suonare un sample: il suo posto, il parametro della sorgente con il valore
 *  "Sample", e i tempi da allungare (dati i valori) perché il sample si senta. */
export interface SampleLayer {
  readonly slot: string;
  readonly source: string;
  readonly sample: number;
  readonly times?: (values: Readonly<Record<string, number>>) => ParamValues;
}

/** L'intonazione da disegnare: dove arriva (Hz) e dov'è a `t` secondi. */
export interface PitchCurve {
  readonly base: number;
  at(t: number): number;
}

export interface LayerLayout {
  /** Il nome dello strumento, per i messaggi. */
  readonly name: string;
  readonly cards: readonly LayerCard[];
  readonly samples: readonly SampleLayer[];
  /** I controlli che, quando non contano (dipendono dalla sorgente), si tolgono invece di attenuarsi. */
  readonly swapped: ReadonlySet<string>;
  /** Le scelte che stanno meglio in un menu. */
  readonly menus: ReadonlySet<string>;
  /** I parametri che, cambiati, fanno sentire il colpo. */
  readonly audition: ReadonlySet<string>;
  /** La nota che suona il colpo di prova. */
  readonly rootNote: number;
  /** La scala delle frequenze della curva dell'intonazione. */
  readonly lowHz: number;
  readonly highHz: number;
  /** Il motore che calcola il colpo da disegnare. */
  core(sampleRate: number): InstrumentCore & SamplePlayer;
  /** Quanto dura il colpo da disegnare (in secondi). */
  seconds(values: Readonly<Record<string, number>>): number;
  /** La curva dell'intonazione del corpo, o null se il corpo non ne ha una (un sample). */
  pitch(values: Readonly<Record<string, number>>): PitchCurve | null;
  /** In alto a destra, sul colpo. */
  hint(values: Readonly<Record<string, number>>): string;
}

const AUDITION_VELOCITY = 120;
const ACCENT = '#ff9d2e';
const CURVE = '#7fb6ff';

/** Un canvas nitido, ridimensionato al suo posto. */
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
  private readonly wave = el<HTMLCanvasElement>('canvas', { className: 'lay-wave', title: 'Il colpo: forma d\'onda e intonazione (clic: suona)' });
  private readonly controls = new Map<string, { control: ParamControl; spec: ParamSpec }>();
  private readonly sampleRows = new Map<string, { row: HTMLElement; choice: HTMLSelectElement }>();
  private values: Record<string, number>;
  private params: ParamValues | null = null;
  private enabled = true;
  private dirty = true;
  /** I sample con cui è stato disegnato il colpo: se cambiano (caricati dopo), si ridisegna. */
  private drawnWith: (SampleData | undefined)[] = [];
  /** Il colpo calcolato e quanto dura il disegno. */
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
        choice.replaceChildren(el('option', { value: '', textContent: '— nessun sample —' }),
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

  // ---------------------------------------------------------------- schede

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

  /** Un parametro cambiato. Scegliendo un sample come sorgente, i tempi si allungano quanto basta
   *  a sentirlo (un sample dura più di un click). */
  private set(id: string, v: number, final: boolean): void {
    const layer = this.layout.samples.find(x => x.source === id);
    const times = layer && v === layer.sample ? layer.times?.(this.values) ?? {} : {};
    this.ctx.setParams({ [id]: v, ...times }, final);
    if (final && this.layout.audition.has(id)) this.audition();
  }

  /** Il sample dello strato: scelto tra quelli del progetto o caricato dal disco. */
  private sampleRow(slot: string): HTMLElement {
    const choice = el<HTMLSelectElement>('select', { className: 'lay-sample', title: 'Il sample (tra quelli del progetto)' });
    choice.onchange = () => {
      this.assign(slot, (choice.value || null) as SampleId | null);
    };
    const load = el<HTMLButtonElement>('button', { className: 'mini', textContent: 'Carica…', title: 'Carica un file audio (o trascinalo sulla scheda)' });
    load.onclick = () => {
      const input = el<HTMLInputElement>('input', { type: 'file', accept: 'audio/*' });
      input.onchange = () => { const f = input.files?.[0]; if (f) void this.load(slot, f); };
      input.click();
    };
    const row = el('div', { className: 'lay-sample-row' }, choice, load);
    this.sampleRows.set(slot, { row, choice });
    return row;
  }

  /** La sorgente dello strato diventa Sample (con i tempi per sentirlo), se non lo era già. */
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
      console.warn(`${this.layout.name}: impossibile caricare "${file.name}"`, err);
    }
  }

  /** Un file audio o un sample del browser lasciato sulla scheda diventa il sample dello strato. */
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

  // ---------------------------------------------------------------- il colpo

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

  /** Il colpo, calcolato con il motore vero (a frequenza ridotta: per disegnarlo basta). */
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
    // il tempo: una riga ogni 50, 100 o 250 ms
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
    // la forma d'onda: minimo e massimo per colonna
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
    // l'intonazione del corpo: dall'alto fino alla nota, su una scala di ottave
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
    // la nota, in alto
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
