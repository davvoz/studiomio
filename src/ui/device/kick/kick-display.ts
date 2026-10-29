/* Il pannello del Kick. A sinistra il colpo com'è: la forma d'onda calcolata con lo stesso motore
 * che suona (con i sample caricati) e, sopra, la curva dell'intonazione che cade fino alla nota;
 * un clic lo suona. A destra le schede degli strati nell'ordine in cui si sentono (Snap, Corpo,
 * Coda, Rumble), poi la nota e l'uscita. Snap e Corpo possono essere un sample: un file audio (o
 * un sample del browser) lasciato sulla loro scheda ci diventa il loro sample. */
import type { SampleId } from '../../../core/id';
import { paramActive, paramSpec, resolveParams } from '../../../devices/device-type';
import {
  BODY_SLOT, FIRST_NOTE, kickNote, noteHz, ROOT_NOTE, SNAP_SLOT, SNAP_SOURCE, SOURCE,
} from '../../../devices/instruments/kick/kick';
import { KickCore } from '../../../devices/instruments/kick/kick-core';
import type { SampleData } from '../../../devices/dsp/core';
import type { ParamSpec } from '../../../devices/params';
import { sampleAt, type DeviceSettings, type ParamValues } from '../../../model/device';
import { acceptBrowserDrops } from '../../browser/browser-drag';
import { el } from '../../dom';
import { controlFor, setActive, type ParamControl } from '../controls';
import type { DeviceDisplay, DisplayContext } from '../displays';

/** I file che si possono lasciare su una scheda. */
const isAudio = (f: File) => f.type.startsWith('audio/') || /\.(wav|aiff?|flac|mp3|ogg|m4a)$/i.test(f.name);

interface Card {
  readonly title: string;
  /** La scelta della sorgente, nell'intestazione della scheda. */
  readonly source?: string;
  /** Il posto del sample, per gli strati che possono suonarne uno. */
  readonly slot?: string;
  readonly params: readonly string[];
}

const CARDS: readonly Card[] = [
  { title: 'Snap', source: 'snapSource', slot: SNAP_SLOT, params: ['snapLevel', 'snapTone', 'snapTune', 'snapDecay'] },
  {
    title: 'Corpo', source: 'bodySource', slot: BODY_SLOT,
    params: ['bodyLevel', 'pitch', 'pitchTime', 'pitchCurve', 'shape', 'sampleTune', 'sampleStart', 'attack', 'hold', 'decay'],
  },
  { title: 'Coda', params: ['tailLevel', 'tailDecay', 'tailDrive'] },
  { title: 'Rumble', source: 'rumbleOn', params: ['rumble', 'rumbleTime', 'rumbleTone', 'rumbleDrive', 'rumbleDuck'] },
  { title: 'Nota', params: ['note', 'fine', 'follow'] },
  { title: 'Uscita', params: ['drive', 'driveType', 'lowCut', 'velocity', 'volume'] },
];

/** I controlli che, quando non contano (dipendono dalla sorgente), si tolgono invece di attenuarsi. */
const SWAPPED = new Set(['pitch', 'pitchTime', 'pitchCurve', 'shape', 'sampleTune', 'sampleStart', 'snapTone', 'snapTune']);
/** Le scelte che stanno meglio in un menu. */
const MENUS = new Set(['note', 'driveType', 'snapSource', 'bodySource']);

/** Velocity del colpo di prova. */
const AUDITION_VELOCITY = 120;
/** Quanto si disegna del colpo, al massimo e al minimo (in secondi). */
const MAX_VIEW = 2.5;
const MIN_VIEW = 0.3;
/** La scala delle frequenze della curva dell'intonazione. */
const LOW_HZ = 25;
const HIGH_HZ = 1200;
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

export class KickDisplay implements DeviceDisplay {
  readonly element = el('div', { className: 'kick' });
  private readonly wave = el<HTMLCanvasElement>('canvas', { className: 'kick-wave', title: 'Il colpo: forma d\'onda e intonazione (clic: suona)' });
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

  constructor(private readonly ctx: DisplayContext) {
    this.values = resolveParams(ctx.type, ctx.settings.params);
    this.wave.addEventListener('pointerdown', e => {
      if (e.button === 0) ctx.audition(ROOT_NOTE, AUDITION_VELOCITY);
    });
    const left = el('div', { className: 'kick-left' }, this.wave);
    this.element.append(left, el('div', { className: 'kick-cards' }, ...CARDS.map(c => this.card(c))));
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
      if (SWAPPED.has(spec.id)) control.element.hidden = !active;
      else setActive(control, active);
    }
    for (const [slot, { row, choice }] of this.sampleRows) {
      const source = slot === BODY_SLOT ? this.values.bodySource === SOURCE.sample : this.values.snapSource === SNAP_SOURCE.sample;
      row.hidden = !source || !this.ctx.samples;
      if (!row.hidden) {
        const all = this.ctx.samples?.list() ?? [];
        choice.replaceChildren(el('option', { value: '', textContent: '— nessun sample —' }),
          ...all.map(s => el('option', { value: s.id, textContent: s.name })));
        choice.value = sampleAt(settings, slot) ?? '';
      }
    }
    this.dirty = true;
  }

  // ---------------------------------------------------------------- schede

  private card(c: Card): HTMLElement {
    const head = el('div', { className: 'kick-card-head' }, el('span', { className: 'kick-card-title', textContent: c.title }));
    if (c.source) head.append(this.control(c.source));
    const knobs = el('div', { className: 'kick-knobs' }, ...c.params.map(id => this.control(id)));
    const card = el('div', { className: 'kick-card' }, head);
    if (c.slot) card.append(this.sampleRow(c.slot));
    card.append(knobs);
    if (c.slot) this.acceptSamples(card, c.slot);
    return card;
  }

  private control(id: string): HTMLElement {
    const spec = paramSpec(this.ctx.type, id)!;
    const control = controlFor(spec, this.values[id], (v, final) => this.set(id, v, final), { menu: MENUS.has(id) });
    this.controls.set(id, { control, spec });
    return control.element;
  }

  /** Un parametro cambiato. Scegliendo un sample come sorgente, i tempi si allungano quanto basta
   *  a sentirlo (un sample di cassa dura più di un click). */
  private set(id: string, v: number, final: boolean): void {
    this.ctx.setParams({ [id]: v, ...this.sampleTimes(id, v) }, final);
    if (final && (id === 'bodySource' || id === 'snapSource' || id === 'note')) this.ctx.audition(ROOT_NOTE, AUDITION_VELOCITY);
  }

  private sampleTimes(id: string, v: number): ParamValues {
    const x = this.values;
    if (id === 'bodySource' && v === SOURCE.sample) return { ...(x.hold < 150 ? { hold: 300 } : {}), ...(x.decay < 0.6 ? { decay: 1 } : {}) };
    if (id === 'snapSource' && v === SNAP_SOURCE.sample) return x.snapDecay < 120 ? { snapDecay: 250 } : {};
    return {};
  }

  /** Il sample dello strato: scelto tra quelli del progetto o caricato dal disco. */
  private sampleRow(slot: string): HTMLElement {
    const choice = el<HTMLSelectElement>('select', { className: 'kick-sample', title: 'Il sample (tra quelli del progetto)' });
    choice.onchange = () => {
      this.assign(slot, (choice.value || null) as SampleId | null);
    };
    const load = el<HTMLButtonElement>('button', { className: 'mini', textContent: 'Carica…', title: 'Carica un file audio (o trascinalo sulla scheda)' });
    load.onclick = () => {
      const input = el<HTMLInputElement>('input', { type: 'file', accept: 'audio/*' });
      input.onchange = () => { const f = input.files?.[0]; if (f) void this.load(slot, f); };
      input.click();
    };
    const row = el('div', { className: 'kick-sample-row' }, choice, load);
    this.sampleRows.set(slot, { row, choice });
    return row;
  }

  /** La sorgente dello strato diventa Sample (con i tempi per sentirlo), se non lo era già. */
  private asSample(slot: string): ParamValues {
    const [id, value] = slot === BODY_SLOT ? ['bodySource', SOURCE.sample] as const : ['snapSource', SNAP_SOURCE.sample] as const;
    return this.values[id] === value ? {} : { [id]: value, ...this.sampleTimes(id, value) };
  }

  private assign(slot: string, id: SampleId | null): void {
    this.ctx.samples?.assign({ [slot]: id }, id ? this.asSample(slot) : {});
    if (id) this.ctx.audition(ROOT_NOTE, AUDITION_VELOCITY);
  }

  private async load(slot: string, file: File): Promise<void> {
    try {
      await this.ctx.samples?.load(slot, file, this.asSample(slot));
      this.ctx.audition(ROOT_NOTE, AUDITION_VELOCITY);
    } catch (err) {
      console.warn(`Kick: impossibile caricare "${file.name}"`, err);
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
    const audio = [BODY_SLOT, SNAP_SLOT].map(slot => this.ctx.samples?.audio?.(slot));
    if (audio.some((a, i) => a !== this.drawnWith[i])) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.drawnWith = audio;
    this.renderHit(audio);
    this.paint();
  };

  /** Quanto dura il colpo da disegnare: fin dove si sente il più lungo degli strati. */
  private viewSeconds(): number {
    const v = this.values;
    const body = (v.attack + v.hold) / 1000 + v.decay * 0.6, tail = v.tailLevel > 0 ? v.tailDecay * 0.6 : 0;
    const rumble = v.rumbleOn === 1 && v.rumble > 0 ? v.rumbleTime * 0.7 : 0;
    return Math.max(MIN_VIEW, Math.min(MAX_VIEW, Math.max(body, tail, rumble)));
  }

  /** Il colpo, calcolato con il motore vero (a frequenza ridotta: per disegnarlo basta). */
  private renderHit(audio: (SampleData | undefined)[]): void {
    const rate = 24000, seconds = this.viewSeconds(), n = Math.round(seconds * rate);
    const core = new KickCore(rate);
    core.setParams({ ...this.values, velocity: 0 });
    core.setSample(BODY_SLOT, audio[0] ?? null);
    core.setSample(SNAP_SLOT, audio[1] ?? null);
    core.noteOn(1, ROOT_NOTE, 127);
    const left = new Float32Array(n), right = new Float32Array(n);
    for (let f = 0; f < n; f += 256) core.render(left, right, f, Math.min(n, f + 256));
    this.rendered = left;
    this.seconds = seconds;
  }

  private paint(): void {
    const g = fit(this.wave);
    if (!g) return;
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
    const base = noteHz(kickNote(v.note) + v.fine / 100);
    const yOf = (hz: number) => h - 14 - ((Math.log2(hz / LOW_HZ) / Math.log2(HIGH_HZ / LOW_HZ)) * (h - 26));
    if (v.bodySource === SOURCE.synth) {
      const curve = Math.pow(2, (v.pitchCurve - 50) / 25), k = Math.log(1e-3) / (v.pitchTime / 1000);
      g.strokeStyle = CURVE;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let c = 0; c <= w; c += 2) {
        const t = (c / w) * this.seconds, e = Math.exp(k * t);
        const y = yOf(Math.min(HIGH_HZ, base * Math.pow(2, (v.pitch * Math.pow(e, curve)) / 12)));
        if (c) g.lineTo(c, y);
        else g.moveTo(c, y);
      }
      g.stroke();
      g.lineWidth = 1;
    }
    g.globalAlpha = 1;
    g.setLineDash([3, 3]);
    g.strokeStyle = 'rgba(127,182,255,0.45)';
    const yb = Math.round(yOf(base)) + 0.5;
    g.beginPath(); g.moveTo(0, yb); g.lineTo(w, yb); g.stroke();
    g.setLineDash([]);
    // la nota, in alto
    const note = paramSpec(this.ctx.type, 'note');
    const name = note?.kind === 'choice' ? note.options[v.note] : `${FIRST_NOTE + v.note}`;
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = '600 12px system-ui, sans-serif';
    g.fillText(`${name}${v.fine ? ` ${v.fine > 0 ? '+' : ''}${v.fine} ct` : ''}`, 8, 16);
    g.font = '10px system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.textAlign = 'right';
    g.fillText(v.follow === 1 ? 'segue le note (C1 = la nota)' : 'clic: suona', w - 6, 14);
    g.textAlign = 'left';
  }
}
