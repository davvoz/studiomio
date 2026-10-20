/* Il pannello del Sampler. In alto la forma d'onda (con il sample da scegliere o caricare) e
 * gli inviluppi disegnati; sotto le schede del sample (con i controlli del modo scelto),
 * dell'intonazione, del filtro e dell'uscita; a destra l'LFO. Il modo (Classic, One-Shot, Slice)
 * sta nell'intestazione del dispositivo. Un file audio dal disco o un sample dal browser lasciato
 * sul pannello diventa il sample. */
import type { SampleId } from '../../../core/id';
import { paramActive, paramSpec, resolveParams } from '../../../devices/device-type';
import {
  ENV_NAMES, FIRST_SLICE_NOTE, MODE, SAMPLE_SLOT, SENSITIVITY, SLICE, SLICE_COUNT, sliceValues,
} from '../../../devices/instruments/sampler/sampler';
import type { ParamSpec } from '../../../devices/params';
import { sampleAt, type DeviceSettings, type ParamValues } from '../../../model/device';
import { acceptBrowserDrops } from '../../browser/browser-drag';
import { SEPARATOR, showContextMenu } from '../../context-menu';
import { el } from '../../dom';
import { controlFor, setActive, type ParamControl } from '../controls';
import type { DeviceDisplay, DisplayContext } from '../displays';
import { EnvView } from '../prisma/env-view';
import { findTransients } from './slices';
import { WaveView } from './wave-view';

/** I file che si possono lasciare sul pannello. */
const isAudio = (f: File) => f.type.startsWith('audio/') || /\.(wav|aiff?|flac|mp3|ogg|m4a)$/i.test(f.name);

/** I controlli della scheda del sample, nel loro ordine; poi quelli che si vedono in ogni modo. */
const SAMPLE_ORDER = ['start', 'end', 'sliceBy', 'sliceGrid', SENSITIVITY, 'loop', 'loopStart', 'loopEnd', 'xfade', 'loopRelease', 'trigger', 'reverse'];
const SAMPLE_CONTROLS: Readonly<Record<number, readonly string[]>> = {
  [MODE.classic]: ['start', 'end', 'loop', 'loopStart', 'loopEnd', 'xfade', 'loopRelease', 'reverse'],
  [MODE.oneShot]: ['start', 'end', 'trigger', 'reverse'],
  [MODE.slice]: ['sliceBy', 'sliceGrid', SENSITIVITY, 'trigger', 'reverse'],
};
/** Le scelte che stanno meglio in un menu che in fila di pulsanti. */
const MENUS = new Set(['loop', 'loopRelease', 'sliceBy', 'sliceGrid', 'root', 'voiceMode', 'fType', 'lfoShape', 'lfoDiv']);
/** I controlli che, quando non contano, si tolgono invece di attenuarsi (stanno allo stesso posto). */
const SWAPPED = new Set(['lfoRate', 'lfoDiv', 'sliceGrid', SENSITIVITY]);

/** Velocity delle note di prova (le fette). */
const AUDITION_VELOCITY = 110;

/** L'inviluppo che si guarda (resta fra un pannello e l'altro). */
const view = { env: 1 };

export class SamplerDisplay implements DeviceDisplay {
  readonly element = el('div', { className: 'smp' });
  readonly head: HTMLElement;
  private readonly controls = new Map<string, { control: ParamControl; spec: ParamSpec }>();
  private readonly wave: WaveView;
  private readonly envView: EnvView;
  private readonly envTabs: HTMLButtonElement[] = [];
  private readonly envKnobs = el('div', { className: 'device-controls smp-knobs' });
  private readonly sampleChoice = el<HTMLSelectElement>('select', { className: 'smp-sample', title: 'Il sample (tra quelli del progetto)' });
  private readonly info = el('span', { className: 'smp-info muted' });
  private readonly detect = el<HTMLButtonElement>('button', { className: 'mini smp-detect', textContent: 'Rileva', title: 'Trova le fette ai transienti (con la sensibilità scelta)' });
  private values: Record<string, number>;
  private params: ParamValues | null = null;
  private settings: DeviceSettings;
  private enabled = true;
  /** Il pannello è stato nel documento: quando ne esce smette di guardare le voci. */
  private shown = false;
  private hadAudio = false;

  constructor(private readonly ctx: DisplayContext) {
    this.settings = ctx.settings;
    this.values = resolveParams(ctx.type, ctx.settings.params);
    const set = (values: ParamValues, final: boolean) => ctx.setParams(values, final);
    this.wave = new WaveView({
      values: () => this.values,
      audio: () => this.audio(),
      name: () => this.sampleName(),
      set,
      playSlice: i => ctx.audition(FIRST_SLICE_NOTE + i, AUDITION_VELOCITY),
      playheads: () => ctx.playheads?.() ?? [],
      menu: (x, y) => this.menu(x, y),
    });
    this.envView = new EnvView(() => this.values, set, env => `Inviluppo ${ENV_NAMES[env - 1].toLowerCase()}`);
    this.envView.canvas.classList.add('smp-env');

    const mode = this.control('mode', v => this.setMode(v));
    mode.classList.add('smp-mode');
    this.head = el('div', { className: 'smp-head' }, mode);

    this.sampleChoice.onchange = () => this.assign((this.sampleChoice.value || null) as SampleId | null);
    const load = el<HTMLButtonElement>('button', { className: 'mini', textContent: 'Carica…', title: 'Carica un file audio', onclick: () => this.pickFile() });
    this.detect.onclick = () => this.findSlices(this.values[SENSITIVITY], true);
    const waveBox = el('div', { className: 'smp-wave-box' },
      el('div', { className: 'smp-wave-bar' }, this.sampleChoice, load, this.info), this.wave.canvas);

    const envCard = this.card('Inviluppi', [el('div', { className: 'smp-tabs' }, ...ENV_NAMES.map((name, i) => {
      const b = el<HTMLButtonElement>('button', { className: 'mini', textContent: name, onclick: () => this.showEnv(i + 1) });
      this.envTabs.push(b);
      return b;
    }))], this.envView.canvas, this.envKnobs);
    envCard.classList.add('smp-env-card');

    const sampleCard = this.card('Sample', [this.detect], this.row(...SAMPLE_ORDER));
    sampleCard.classList.add('smp-sample-card');
    const pitchCard = this.card('Intonazione', [], this.row('root', 'transpose', 'detune', 'keyTrack', 'voiceMode', 'glide', 'pitchEnv'));
    const filterCard = this.card('Filtro', [this.power('fOn'), this.control('fType', undefined, true)],
      this.row('fCutoff', 'fRes', 'fDrive', 'fVar', 'fKey', 'fEnv', 'fVel'));
    const outCard = this.card('Uscita', [], this.row('velocity', 'pan', 'volume'));
    const lfoCard = this.card('LFO', [this.control('lfoShape', undefined, true)],
      el('div', { className: 'smp-lfo-grid' }, ...['lfoSync', 'lfoRate', 'lfoDiv', 'lfoTrig', 'lfoFade', 'lfoPitch', 'lfoCutoff', 'lfoVolume', 'lfoPan']
        .map(id => this.control(id))));
    lfoCard.classList.add('smp-lfo-card');

    this.element.append(
      el('div', { className: 'smp-main' },
        el('div', { className: 'smp-top' }, waveBox, envCard),
        el('div', { className: 'smp-row' }, sampleCard, pitchCard, filterCard, outCard)),
      lfoCard);
    this.bindDrops();
    this.showEnv(view.env);
    this.update(ctx.settings, true);
    const resized = new ResizeObserver(() => this.paint());
    resized.observe(this.wave.canvas);
    resized.observe(this.envView.canvas);
    requestAnimationFrame(this.frame);
  }

  /** A ogni fotogramma: i cursori delle voci, e il sample quando finisce di caricarsi. */
  private readonly frame = () => {
    if (this.element.isConnected) this.shown = true;
    else if (this.shown) return;
    const has = !!this.audio();
    if (has !== this.hadAudio) {
      this.hadAudio = has;
      this.refreshSample();
      this.wave.paint();
    }
    this.wave.tick();
    requestAnimationFrame(this.frame);
  };

  update(settings: DeviceSettings, enabled: boolean): void {
    if (settings.params !== this.params) {
      this.params = settings.params;
      this.values = resolveParams(this.ctx.type, settings.params);
    }
    this.settings = settings;
    this.enabled = enabled;
    const shown = new Set(SAMPLE_CONTROLS[this.values.mode] ?? []);
    for (const [id, { control, spec }] of this.controls) {
      control.set(this.values[id]);
      const active = paramActive(spec, this.values);
      setActive(control, active);
      const sampleControl = Object.values(SAMPLE_CONTROLS).some(ids => ids.includes(id));
      control.element.hidden = (sampleControl && !shown.has(id)) || (SWAPPED.has(id) && !active);
    }
    // la sensibilità conta solo con le fette ai transienti (è un parametro dell'interfaccia)
    const transients = this.values.mode === MODE.slice && this.values.sliceBy === SLICE.transients;
    const sens = this.controls.get(SENSITIVITY);
    if (sens) sens.control.element.hidden = !transients;
    this.detect.hidden = !transients;
    this.refreshSample();
    this.paint();
  }

  // ---------------------------------------------------------------- sample

  private audio() {
    return this.ctx.samples?.audio?.(SAMPLE_SLOT);
  }

  private sampleName(): string | null {
    const id = sampleAt(this.settings, SAMPLE_SLOT);
    return (id && this.ctx.samples?.list().find(s => s.id === id)?.name) || null;
  }

  private refreshSample(): void {
    const all = this.ctx.samples?.list() ?? [];
    const current = sampleAt(this.settings, SAMPLE_SLOT);
    this.sampleChoice.replaceChildren(el('option', { value: '', textContent: '— nessun sample —' }),
      ...all.map(s => el('option', { value: s.id, textContent: s.name })));
    this.sampleChoice.value = current ?? '';
    const a = this.audio();
    if (!a) {
      this.info.textContent = '';
      return;
    }
    const seconds = a.channels[0].length / a.sampleRate;
    const length = seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(2)} s`;
    this.info.textContent = `${length} · ${(a.sampleRate / 1000).toFixed(1)} kHz · ${a.channels.length > 1 ? 'stereo' : 'mono'}`;
  }

  /** Un sample del progetto (null: tolto). In Slice ai transienti, le fette si cercano subito. */
  private assign(id: SampleId | null): void {
    const samples = this.ctx.samples;
    if (!samples) return;
    samples.assign({ [SAMPLE_SLOT]: id }, {});
    if (id) this.afterLoad();
  }

  private async loadFile(file: File): Promise<void> {
    const samples = this.ctx.samples;
    if (!samples) return;
    try {
      await samples.load(SAMPLE_SLOT, file, {});
    } catch (err) {
      this.info.textContent = `Impossibile caricare "${file.name}": ${err instanceof Error ? err.message : err}`;
      return;
    }
    this.afterLoad();
  }

  /** Dopo un sample nuovo: si vede tutto, e in Slice ai transienti le fette sono le sue. */
  private afterLoad(): void {
    this.wave.zoomAll();
    if (this.values.mode === MODE.slice && this.values.sliceBy === SLICE.transients) this.findSlices(this.values[SENSITIVITY], true);
    this.ctx.audition(this.values.mode === MODE.slice ? FIRST_SLICE_NOTE : 60, AUDITION_VELOCITY);
  }

  private pickFile(): void {
    const input = el<HTMLInputElement>('input', { type: 'file', accept: 'audio/*' });
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void this.loadFile(file);
    };
    input.click();
  }

  /** File dal disco e sample (o file) dal browser, lasciati sul pannello. */
  private bindDrops(): void {
    const target = this.element;
    if (!this.ctx.samples) return;
    const files = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    target.addEventListener('dragover', e => {
      if (!files(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer!.dropEffect = 'copy';
      target.classList.add('drop');
    });
    target.addEventListener('dragleave', e => {
      if (!target.contains(e.relatedTarget as Node | null)) target.classList.remove('drop');
    });
    target.addEventListener('drop', e => {
      if (!files(e)) return;
      e.preventDefault();
      e.stopPropagation();
      target.classList.remove('drop');
      const file = [...e.dataTransfer!.files].find(isAudio);
      if (file) void this.loadFile(file);
    });
    acceptBrowserDrops(target, item => {
      const p = item.payload;
      if (p?.kind === 'sample') this.assign(p.sample.id);
      else if (p?.kind === 'file') void p.file().then(f => this.loadFile(f));
    }, { accept: item => item.payload?.kind === 'sample' || item.payload?.kind === 'file' });
  }

  // ---------------------------------------------------------------- fette

  /** Cerca le fette ai transienti con la sensibilità `sens` (0…100) e le salva. */
  private findSlices(sens: number, final: boolean): void {
    const audio = this.audio();
    if (!audio) return;
    const v = this.values;
    const found = findTransients(audio, v.reverse === 1, sens / 100, v.start / 100, v.end / 100);
    this.ctx.setParams({ [SENSITIVITY]: sens, ...sliceValues(found) }, final);
  }

  private setMode(mode: number): void {
    const v = this.values;
    // passando a Slice ai transienti la prima volta, le fette si trovano da sole
    if (mode === MODE.slice && v.sliceBy === SLICE.transients && !v[SLICE_COUNT] && this.audio()) {
      const audio = this.audio()!;
      const found = findTransients(audio, v.reverse === 1, v[SENSITIVITY] / 100, v.start / 100, v.end / 100);
      this.ctx.setParams({ mode, ...sliceValues(found) }, true);
    } else this.ctx.setParams({ mode }, true);
  }

  private menu(x: number, y: number): void {
    const samples = this.ctx.samples, loaded = sampleAt(this.settings, SAMPLE_SLOT);
    const transients = this.values.mode === MODE.slice && this.values.sliceBy === SLICE.transients;
    showContextMenu(x, y, [
      { label: 'Carica un sample…', run: () => this.pickFile() },
      { label: 'Togli il sample', disabled: !loaded || !samples, run: () => this.assign(null) },
      SEPARATOR,
      { label: 'Mostra tutto il sample', run: () => this.wave.zoomAll() },
      ...(transients ? [
        SEPARATOR,
        { label: 'Rileva le fette ai transienti', disabled: !this.audio(), run: () => this.findSlices(this.values[SENSITIVITY], true) },
        { label: 'Togli tutte le fette', disabled: !this.values[SLICE_COUNT], run: () => this.ctx.setParams(sliceValues([]), true) },
      ] : []),
    ]);
  }

  // ---------------------------------------------------------------- inviluppi

  private showEnv(env: number): void {
    view.env = env;
    this.envTabs.forEach((b, i) => b.classList.toggle('on', i + 1 === env));
    for (const id of [...this.controls.keys()]) if (/^e\d[AHDSR]$/.test(id)) this.controls.delete(id);
    this.envKnobs.replaceChildren(...['A', 'H', 'D', 'S', 'R'].map(k => this.control(`e${env}${k}`)));
    this.envView.show(env);
    this.update(this.settings, this.enabled);
    this.ctx.controlsChanged();
  }

  // ---------------------------------------------------------------- controlli

  private card(title: string, head: readonly Node[], ...body: Node[]): HTMLElement {
    return el('div', { className: 'smp-card' },
      el('div', { className: 'smp-card-head' }, el('span', { className: 'smp-card-title', textContent: title }), ...head), ...body);
  }

  private row(...ids: string[]): HTMLElement {
    return el('div', { className: 'device-controls smp-knobs' }, ...ids.map(id => this.control(id)));
  }

  /** Il controllo del parametro `id`; `change` al posto del cambio normale (es. il modo). */
  private control(id: string, change?: (v: number) => void, menu = MENUS.has(id)): HTMLElement {
    const spec = paramSpec(this.ctx.type, id)!;
    const onChange = id === SENSITIVITY
      ? (v: number, final: boolean) => this.findSlices(v, final)
      : id === 'sliceBy'
        ? (v: number) => this.setSliceBy(v)
        : change ? (v: number) => change(v) : (v: number, final: boolean) => this.ctx.setParams({ [id]: v }, final);
    const control = controlFor(spec, this.values[id], onChange, { menu });
    this.controls.set(id, { control, spec });
    return control.element;
  }

  private setSliceBy(sliceBy: number): void {
    const v = this.values, audio = this.audio();
    if (sliceBy === SLICE.transients && !v[SLICE_COUNT] && audio) {
      const found = findTransients(audio, v.reverse === 1, v[SENSITIVITY] / 100, v.start / 100, v.end / 100);
      this.ctx.setParams({ sliceBy, ...sliceValues(found) }, true);
    } else this.ctx.setParams({ sliceBy }, true);
  }

  /** Acceso/spento del filtro, un pulsante nell'intestazione della scheda. */
  private power(id: string): HTMLElement {
    const b = el<HTMLButtonElement>('button', { className: 'mini smp-power', textContent: '⏻', title: 'Accendi/spegni il filtro' });
    b.dataset.param = id;
    b.onclick = () => this.ctx.setParams({ [id]: this.values[id] === 1 ? 0 : 1 }, true);
    this.controls.set(id, { control: { element: b, set: v => b.classList.toggle('on', v === 1) }, spec: paramSpec(this.ctx.type, id)! });
    return b;
  }

  private paint(): void {
    this.wave.setEnabled(this.enabled);
    this.wave.paint();
    this.envView.paint(this.enabled);
  }
}
