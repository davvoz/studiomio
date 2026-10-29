/* Il pannello della Drum Machine: a sinistra i 16 pad in griglia 4×4 (il primo in basso a
 * sinistra, come sui controller), a destra i controlli del pad scelto e l'uscita. Un clic su
 * un pad lo sceglie e lo suona; trascinarlo su un altro li scambia (con Ctrl lo copia). Un file
 * audio lasciato su un pad ci diventa il suo sample (più file: sui pad dopo). Un pad con uno
 * strumento (Kick, Snare, Hat e Piatti) mostra accanto il pannello di quello strumento, che
 * lavora sui parametri del pad come se fosse lo strumento da solo. */
import type { SampleId } from '../../../core/id';
import { paramActive, paramSpec, resolveParams, type DeviceType } from '../../../devices/device-type';
import { pieceOfNote } from '../../../devices/instruments/cymbals/cymbals';
import {
  DRUM_MODELS, DRUM_PADS, innerPrefix, innerPresetParams, MODEL, modelDefaults, padInstrument, padNames, padNote, padOfNote, padParam,
  padsOf, padSlot, type DrumPad, type PadInstrument, type PadKey,
} from '../../../devices/instruments/drums/drums';
import type { ParamSpec } from '../../../devices/params';
import { sampleAt, type DeviceSamples, type DeviceSettings, type ParamValues } from '../../../model/device';
import { SEPARATOR, showContextMenu } from '../../context-menu';
import { el } from '../../dom';
import { pitchName } from '../../piano-roll/pitch-axis';
import { controlFor, setActive, type ParamControl } from '../controls';
import { CymbalsDisplay } from '../cymbals/cymbals-display';
import type { DeviceDisplay, DisplayContext } from '../displays';
import { kickDisplay } from '../kick/kick-display';
import { snareDisplay } from '../snare/snare-display';

/** Il colore dei pad per famiglia di suono. */
const MODEL_COLORS: Readonly<Record<string, string>> = {
  kick: '#ff9d2e', boom: '#ff7a2e', snare: '#f2d14b', clap: '#f2d14b', rim: '#e8c06a',
  hatClosed: '#4fd1e0', hatOpen: '#4fd1e0', cymbal: '#7fb6ff', tom: '#7bd88f', cowbell: '#c79bff', shaker: '#c79bff',
  sample: '#ef6fa6', kickInst: '#ff9d2e', snareInst: '#f2d14b', cymbalsInst: '#4fd1e0',
};

/** I pannelli degli strumenti che un pad può suonare, per tipo. */
const INNER_DISPLAYS: Readonly<Record<string, (ctx: DisplayContext) => DeviceDisplay>> = {
  kick: kickDisplay,
  snare: snareDisplay,
  cymbals: ctx => new CymbalsDisplay(ctx),
};

/** Le chiavi che cominciano con `prefix`, senza (i parametri o i sample di uno strumento di un pad). */
function stripped<V>(record: Readonly<Record<string, V>>, prefix: string): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [k, v] of Object.entries(record)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  return out;
}

const withPrefix = <V>(record: Readonly<Record<string, V>>, prefix: string): Record<string, V> =>
  Object.fromEntries(Object.entries(record).map(([k, v]) => [prefix + k, v]));

const sameRecord = <V>(a: Readonly<Record<string, V>> | undefined, b: Readonly<Record<string, V>>): boolean =>
  !!a && Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([k, v]) => a[k] === v);

/** I modelli nel menu: prima i suoni, poi gli strumenti. */
const SOUND_MODELS = DRUM_MODELS.flatMap((m, i) => (padInstrument(i) ? [] : [{ m, i }]));
const INSTRUMENT_MODELS = DRUM_MODELS.flatMap((m, i) => (padInstrument(i) ? [{ m, i }] : []));

/** I file che si possono lasciare su un pad. */
const isAudio = (f: File) => f.type.startsWith('audio/') || /\.(wav|aiff?|flac|mp3|ogg|m4a)$/i.test(f.name);

/** Il pad diventa un pad Sample (con i valori del modello, se non lo era già). */
const asSamplePad = (pad: DrumPad, index: number): Record<string, number> =>
  pad.model === MODEL.sample ? {} : modelDefaults(index, MODEL.sample);

/** I controlli del pad, nell'ordine in cui compaiono (il suono ha il suo menu). */
const PAD_CONTROLS: readonly PadKey[] = ['tune', 'decay', 'start', 'reverse', 'tone', 'snap', 'level', 'pan', 'choke'];
/** Quelli di un pad con uno strumento: il resto è nel pannello dello strumento. */
const INSTRUMENT_CONTROLS: readonly PadKey[] = ['piece', 'level', 'pan', 'choke'];

/** Tutti i valori di un pad, per copiarlo o scambiarlo. */
const padValues = (pad: DrumPad, index: number): Record<string, number> =>
  Object.fromEntries(Object.entries(pad).map(([key, v]) => [padParam(index, key as PadKey), v]));

/** Velocity dei colpi di prova. */
const AUDITION_VELOCITY = 110;

export class DrumDisplay implements DeviceDisplay {
  readonly element = el('div', { className: 'drum-display' });
  private readonly padButtons: HTMLButtonElement[];
  private readonly model = el<HTMLSelectElement>('select', { className: 'drum-model', title: 'Il suono del pad (o lo strumento che suona)' },
    el('optgroup', { label: 'Suoni' }, ...SOUND_MODELS.map(({ m, i }) => el('option', { value: String(i), textContent: m.label }))),
    el('optgroup', { label: 'Strumenti' }, ...INSTRUMENT_MODELS.map(({ m, i }) => el('option', { value: String(i), textContent: m.label }))));
  /** I preset dello strumento del pad. */
  private readonly innerPreset = el<HTMLSelectElement>('select', { className: 'drum-inner-preset', title: 'Un preset dello strumento del pad' });
  /** Il pannello dello strumento del pad scelto, se ne ha uno. */
  private readonly innerBox = el('div', { className: 'drum-inner' });
  private inner: { key: string; display: DeviceDisplay; prefix: string; type: DeviceType; settings: DeviceSettings } | null = null;
  /** Le note suonate dal pad scelto, per il pannello del suo strumento (le legge lui). */
  private innerPlayed: number[] = [];
  private readonly padTitle = el('div', { className: 'drum-pad-title' });
  private readonly hint = el('div', { className: 'drum-hint muted' });
  /** Il sample del pad (solo per il modello Sample): scelto tra quelli del progetto o caricato. */
  private readonly sampleChoice = el<HTMLSelectElement>('select', { className: 'drum-sample', title: 'Il sample del pad (tra quelli del progetto)' });
  private readonly loadButton = el<HTMLButtonElement>('button', { className: 'mini', textContent: 'Carica…', title: 'Carica un file audio sul pad' });
  private readonly sampleRow = el('div', { className: 'drum-sample-row' }, this.sampleChoice, this.loadButton);
  private settings: DeviceSettings;
  private enabled = true;
  private readonly controls = el('div', { className: 'device-controls' });
  private readonly padControls = new Map<string, { spec: ParamSpec; control: ParamControl }>();
  private values: Record<string, number> = {};
  private params: ParamValues | null = null;
  private pads: DrumPad[] = [];
  private selected = 0;
  /** Il pannello è stato nel documento: quando ne esce (chiuso per sempre, ricostruito) smette di guardare le note. */
  private shown = false;

  constructor(private readonly ctx: DisplayContext) {
    this.settings = ctx.settings;
    this.read(ctx.settings.params);
    this.padButtons = Array.from({ length: DRUM_PADS }, (_, i) => this.padButton(i));
    // il primo pad in basso a sinistra: le righe vanno dall'alto (pad 13-16) al basso (1-4)
    const grid = el('div', { className: 'drum-pads' });
    for (let row = 3; row >= 0; row--) grid.append(...this.padButtons.slice(row * 4, row * 4 + 4));
    this.model.onchange = () => {
      this.ctx.setParams(modelDefaults(this.selected, Number(this.model.value)), true);
      this.play(this.selected);
    };
    this.sampleChoice.onchange = () => {
      const id = (this.sampleChoice.value || null) as SampleId | null;
      this.ctx.samples?.assign({ [padSlot(this.selected)]: id }, {});
      if (id) this.play(this.selected);
    };
    this.loadButton.onclick = () => this.pickFile(this.selected);
    this.innerPreset.onchange = () => {
      const instrument = padInstrument(this.pads[this.selected].model);
      const preset = instrument?.type.presets.find(x => x.name === this.innerPreset.value);
      this.innerPreset.value = '';
      if (!instrument || !preset) return;
      this.ctx.setParams(innerPresetParams(this.selected, instrument.type, preset), true);
      this.play(this.selected);
    };
    this.sampleRow.hidden = !ctx.samples;
    const global = (id: string) => this.control(paramSpec(ctx.type, id)!);
    this.element.append(grid, el('div', { className: 'drum-editor' },
      el('div', { className: 'drum-pad-head' }, this.padTitle, this.model, this.innerPreset, this.sampleRow, this.hint),
      el('div', { className: 'drum-controls' }, this.controls, el('div', { className: 'eq-sep' }), global('velocity'), global('volume'))),
    this.innerBox);
    this.update(ctx.settings, true);
    this.select(0);
    requestAnimationFrame(this.frame);
  }

  /** A ogni fotogramma si accendono i pad delle note appena suonate. */
  private readonly frame = () => {
    if (this.element.isConnected) this.shown = true;
    else if (this.shown) return;
    for (const pitch of this.ctx.playedNotes()) {
      const i = padOfNote(pitch);
      if (i >= 0) this.flash(i);
      const instrument = i === this.selected ? padInstrument(this.pads[i].model) : undefined;
      if (instrument) this.innerPlayed.push(instrument.note(this.pads[i].piece));
    }
    requestAnimationFrame(this.frame);
  };

  update(settings: DeviceSettings, enabled: boolean): void {
    this.settings = settings;
    this.enabled = enabled;
    const model = this.pads[this.selected]?.model;
    if (settings.params !== this.params) this.read(settings.params);
    // un altro suono sul pad scelto: altri controlli (e un altro strumento)
    if (this.pads[this.selected].model !== model) this.select(this.selected);
    else this.refresh();
  }

  /** I nomi dei sample caricati, per posto. */
  private sampleNames(): Map<string, string> {
    const all = this.ctx.samples?.list() ?? [];
    return new Map(Object.entries(this.settings.samples ?? {}).flatMap(([slot, id]) => {
      const s = all.find(x => x.id === id);
      return s ? [[slot, s.name] as const] : [];
    }));
  }

  private read(params: ParamValues): void {
    this.params = params;
    this.values = resolveParams(this.ctx.type, params);
    this.pads = padsOf(this.values);
  }

  /** Il pad scelto (per i test automatici). */
  get selectedPad(): number {
    return this.selected;
  }

  private refresh(): void {
    const names = padNames(this.values, this.sampleNames());
    this.padButtons.forEach((b, i) => {
      const model = DRUM_MODELS[this.pads[i].model];
      b.querySelector('.drum-pad-name')!.textContent = names[i];
      b.style.setProperty('--pad', MODEL_COLORS[model?.id] ?? 'var(--accent)');
      b.classList.toggle('selected', i === this.selected);
    });
    const pad = this.pads[this.selected];
    this.padTitle.textContent = `Pad ${this.selected + 1} · ${pitchName(padNote(this.selected))}`;
    this.model.value = String(pad.model);
    const isSample = pad.model === MODEL.sample, current = sampleAt(this.settings, padSlot(this.selected));
    this.sampleRow.classList.toggle('off', !isSample);
    if (isSample) {
      const all = this.ctx.samples?.list() ?? [];
      this.sampleChoice.replaceChildren(el('option', { value: '', textContent: '— nessun sample —' }),
        ...all.map(s => el('option', { value: s.id, textContent: s.name })));
      this.sampleChoice.value = current ?? '';
    }
    const instrument = padInstrument(pad.model);
    this.hint.textContent = isSample && !current ? 'Trascina un file audio sul pad, o Carica…' : DRUM_MODELS[pad.model]?.hint ?? '';
    // il suggerimento di uno strumento è lungo: sta nel titolo
    this.hint.hidden = !!instrument;
    this.model.title = instrument ? DRUM_MODELS[pad.model].hint : 'Il suono del pad (o lo strumento che suona)';
    this.innerPreset.hidden = !instrument;
    for (const { spec, control } of this.padControls.values()) {
      control.set(this.values[spec.id]);
      setActive(control, paramActive(spec, this.values));
    }
    this.updateInner();
  }

  private select(i: number): void {
    this.selected = i;
    for (const id of [...this.padControls.keys()]) if (/^p\d+[a-z]/.test(id)) this.padControls.delete(id);
    const instrument = padInstrument(this.pads[i].model);
    const keys = instrument ? INSTRUMENT_CONTROLS.filter(k => paramActive(paramSpec(this.ctx.type, padParam(i, k))!, this.values)) : PAD_CONTROLS;
    this.controls.replaceChildren(...keys.map(k => this.control(paramSpec(this.ctx.type, padParam(i, k))!)));
    this.innerPreset.replaceChildren(el('option', { value: '', textContent: 'Preset…' }),
      ...(instrument?.type.presets ?? []).map(x => el('option', { value: x.name, textContent: x.name })));
    this.refresh();
    this.ctx.controlsChanged();
  }

  /** Il pannello dello strumento del pad scelto: rifatto se cambiano pad o strumento, se no aggiornato. */
  private updateInner(): void {
    const i = this.selected, pad = this.pads[i], instrument = padInstrument(pad.model);
    const key = instrument ? `${i}:${instrument.type.type}` : '';
    if (this.inner?.key !== key) {
      this.inner = instrument ? this.makeInner(i, key, instrument) : null;
      this.innerPlayed = [];
      this.innerBox.replaceChildren(...(this.inner ? [this.inner.display.element] : []));
      this.innerBox.hidden = !this.inner;
      this.prefixControls();
      return;
    }
    if (!this.inner) return;
    const settings = this.innerSettings(this.inner.prefix, this.inner.type, this.inner.settings);
    if (settings !== this.inner.settings) {
      this.inner.settings = settings;
      this.inner.display.update(settings, this.enabled);
      this.prefixControls();
    }
    if (this.inner.display instanceof CymbalsDisplay) this.inner.display.selectPiece(pad.piece);
  }

  /** I parametri e i sample dello strumento, senza il prefisso; quelli di prima se non sono cambiati. */
  private innerSettings(prefix: string, type: DeviceType, before?: DeviceSettings): DeviceSettings {
    const params = stripped(this.settings.params, prefix), samples: DeviceSamples = stripped(this.settings.samples ?? {}, prefix);
    const same = before && sameRecord(before.params, params) && sameRecord(before.samples ?? {}, samples);
    return same ? before : { type: type.type, preset: null, params, ...(Object.keys(samples).length ? { samples } : {}) };
  }

  /** Il pannello dello strumento del pad `i`, con un contesto che mette e toglie il prefisso. */
  private makeInner(i: number, key: string, instrument: PadInstrument): NonNullable<DrumDisplay['inner']> {
    const ctx = this.ctx, type = instrument.type, prefix = innerPrefix(i, type.type);
    const samples = ctx.samples;
    const settings = this.innerSettings(prefix, type);
    const inner: DisplayContext = {
      type,
      settings,
      sampleRate: ctx.sampleRate,
      setParams: (values, final) => ctx.setParams(withPrefix(values, prefix), final),
      controlsChanged: () => {
        this.prefixControls();
        ctx.controlsChanged();
      },
      openSpectrum: () => ctx.openSpectrum(),
      audition: (pitch, velocity) => {
        // un pezzo di Hat e Piatti scelto nel suo pannello: il pad suona quello
        const piece = instrument === padInstrument(MODEL.cymbalsInst) ? pieceOfNote(pitch) : -1;
        if (piece >= 0 && piece !== this.pads[i].piece) ctx.setParams({ [padParam(i, 'piece')]: piece }, true);
        ctx.audition(padNote(i), velocity);
        this.flash(i);
      },
      playedNotes: () => this.innerPlayed.splice(0),
      ...(samples ? {
        samples: {
          list: () => samples.list(),
          load: (slot, file, values) => samples.load(prefix + slot, file, withPrefix(values, prefix)),
          assign: (changes, values) => samples.assign(withPrefix(changes, prefix), withPrefix(values, prefix)),
          ...(samples.audio ? { audio: (slot: string) => samples.audio!(prefix + slot) } : {}),
        },
      } : {}),
    };
    const display = INNER_DISPLAYS[type.type](inner);
    if (display instanceof CymbalsDisplay) display.selectPiece(this.pads[i].piece);
    return { key, display, prefix, type, settings };
  }

  /** I controlli del pannello dello strumento portano l'id con il prefisso: così la catena li
   *  mappa sulle macro e ci mette le curve come quelli della Drum Machine. */
  private prefixControls(): void {
    const prefix = this.inner?.prefix;
    if (!prefix) return;
    for (const e of this.innerBox.querySelectorAll<HTMLElement>('[data-param]')) {
      if (!e.dataset.param!.startsWith(prefix)) e.dataset.param = prefix + e.dataset.param;
    }
  }

  private control(spec: ParamSpec): HTMLElement {
    const control = controlFor(spec, this.values[spec.id], (v, final) => this.ctx.setParams({ [spec.id]: v }, final));
    this.padControls.set(spec.id, { spec, control });
    return control.element;
  }

  private play(i: number): void {
    this.ctx.audition(padNote(i), AUDITION_VELOCITY);
    this.flash(i);
  }

  private flash(i: number): void {
    const b = this.padButtons[i];
    b.classList.remove('hit');
    void b.offsetWidth; // fa ripartire l'animazione
    b.classList.add('hit');
  }

  private padButton(i: number): HTMLButtonElement {
    const b = el<HTMLButtonElement>('button', { className: 'drum-pad', title: 'Clic: suona · trascina su un altro pad: scambia (Ctrl: copia)' },
      el('span', { className: 'drum-pad-name' }), el('span', { className: 'drum-pad-note', textContent: pitchName(padNote(i)) }));
    b.dataset.pad = String(i);
    b.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      // niente preventDefault: il pad prende il focus, così Esc chiude il pannello
      this.select(i);
      this.play(i);
      this.dragFrom(b, i, e);
    });
    b.addEventListener('contextmenu', e => {
      e.preventDefault();
      this.select(i);
      this.menu(i, e.clientX, e.clientY);
    });
    // file audio dal sistema: diventano i sample del pad (e dei pad dopo)
    const files = (e: DragEvent) => !!this.ctx.samples && !!e.dataTransfer?.types.includes('Files');
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
      void this.loadFiles(i, [...e.dataTransfer!.files].filter(isAudio));
    });
    return b;
  }

  /** Carica i file sui pad da `first` in su, uno per pad; poi suona il primo. */
  private async loadFiles(first: number, files: readonly File[]): Promise<void> {
    const samples = this.ctx.samples;
    if (!samples) return;
    for (const [k, file] of files.entries()) {
      const i = first + k;
      if (i >= DRUM_PADS) break;
      try {
        await samples.load(padSlot(i), file, asSamplePad(this.pads[i], i));
      } catch (err) {
        this.hint.textContent = `Impossibile caricare "${file.name}": ${err instanceof Error ? err.message : err}`;
        return;
      }
    }
    if (files.length) {
      this.select(first);
      this.play(first);
    }
  }

  /** Sceglie un file dal disco per il pad. */
  private pickFile(i: number): void {
    const input = el<HTMLInputElement>('input', { type: 'file', accept: 'audio/*' });
    input.onchange = () => void this.loadFiles(i, [...(input.files ?? [])]);
    input.click();
  }

  /** Trascinare un pad su un altro: rilasciando, i due si scambiano (o, con Ctrl, si copia). */
  private dragFrom(b: HTMLButtonElement, from: number, down: PointerEvent): void {
    b.setPointerCapture(down.pointerId);
    const target = (e: PointerEvent): number | null => {
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.drum-pad');
      const to = over && this.padButtons.includes(over as HTMLButtonElement) ? Number(over.dataset.pad) : null;
      return to === from ? null : to;
    };
    const move = (e: PointerEvent) => {
      const to = target(e);
      this.padButtons.forEach((p, k) => p.classList.toggle('drop', k === to));
    };
    const up = (e: PointerEvent) => {
      b.removeEventListener('pointermove', move);
      this.padButtons.forEach(p => p.classList.remove('drop'));
      const to = e.type === 'pointerup' ? target(e) : null;
      if (to !== null) this.movePad(from, to, e.ctrlKey || e.metaKey);
    };
    b.addEventListener('pointermove', move);
    b.addEventListener('pointerup', up, { once: true });
    b.addEventListener('pointercancel', up, { once: true });
  }

  private movePad(from: number, to: number, copy: boolean): void {
    const a = this.pads[from], b = this.pads[to];
    // con i valori del pad vanno quelli dei suoi strumenti
    const values = copy
      ? { ...padValues(a, to), ...this.innerValues(from, to) }
      : { ...padValues(a, to), ...this.innerValues(from, to), ...padValues(b, from), ...this.innerValues(to, from) };
    const samples = { ...this.padSamples(from, to), ...(copy ? {} : this.padSamples(to, from)) };
    // i sample vanno con i pad
    if (this.ctx.samples && Object.values(samples).some(x => x)) this.ctx.samples.assign(samples, values);
    else this.ctx.setParams(values, true);
    this.select(to);
  }

  /** I parametri degli strumenti del pad `from`, con il prefisso del pad `to`. */
  private innerValues(from: number, to: number): Record<string, number> {
    const src = `p${from + 1}.`, dst = `p${to + 1}.`;
    return Object.fromEntries(Object.entries(this.values).flatMap(([k, v]) => (k.startsWith(src) ? [[dst + k.slice(src.length), v]] : [])));
  }

  /** I sample del pad `from` (il suo e quelli dei suoi strumenti) per i posti del pad `to`; i
   *  posti di `to` che `from` non ha si vuotano. */
  private padSamples(from: number, to: number): Record<string, SampleId | null> {
    const all = this.settings.samples ?? {}, src = `p${from + 1}.`, dst = `p${to + 1}.`;
    const out: Record<string, SampleId | null> = { [padSlot(to)]: sampleAt(this.settings, padSlot(from)) };
    for (const slot of Object.keys(all)) if (slot.startsWith(dst)) out[slot] = null;
    for (const [slot, id] of Object.entries(all)) if (slot.startsWith(src)) out[dst + slot.slice(src.length)] = id;
    return out;
  }

  private menu(i: number, x: number, y: number): void {
    const kit = resolveParams(this.ctx.type, {});
    const fresh = padsOf(kit)[i];
    const samples = this.ctx.samples, loaded = sampleAt(this.settings, padSlot(i));
    const model = ({ m, i: k }: { m: (typeof DRUM_MODELS)[number]; i: number }) => ({
      label: m.label, checked: this.pads[i].model === k,
      run: () => { this.ctx.setParams(modelDefaults(i, k), true); this.play(i); },
    });
    showContextMenu(x, y, [
      ...SOUND_MODELS.map(model),
      SEPARATOR,
      ...INSTRUMENT_MODELS.map(model),
      SEPARATOR,
      ...(samples ? [
        { label: 'Carica un sample…', run: () => this.pickFile(i) },
        { label: 'Togli il sample', disabled: !loaded, run: () => samples.assign({ [padSlot(i)]: null }, {}) },
        SEPARATOR,
      ] : []),
      {
        label: 'Riporta il pad com\'era nel kit di partenza',
        run: () => (samples && loaded ? samples.assign({ [padSlot(i)]: null }, padValues(fresh, i)) : this.ctx.setParams(padValues(fresh, i), true)),
      },
    ]);
  }
}
