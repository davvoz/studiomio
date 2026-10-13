import type { TrackId } from '../../core/id';
import { paramsOf, resolveParams, type InstrumentType } from '../../instruments/instrument-type';
import { INSTRUMENT_TYPES, instrumentType } from '../../instruments/registry';
import { DEFAULT_INSTRUMENT } from '../../model/instrument';
import { MidiTrack } from '../../model/track';
import { loadPreset, setInstrument, setInstrumentParam } from '../../store/edits';
import type { ProjectStore } from '../../store/project-store';
import { controlFor, type ParamControl } from './controls';

export interface DeviceViewDeps {
  readonly store: ProjectStore;
  /** Suona una nota di prova con lo strumento della traccia. */
  readonly audition: (track: TrackId, pitch: number) => void;
}

function el<T extends HTMLElement = HTMLElement>(tag: string, props: Record<string, unknown> = {}, ...children: (Node | string)[]): T {
  const e = Object.assign(document.createElement(tag), props) as T;
  e.append(...children);
  return e;
}

/** Lo strumento di una traccia MIDI: tipo, preset e un controllo per ogni parametro,
 *  costruiti dalla descrizione del tipo. Girare una manopola è una modifica del progetto
 *  (si annulla) e si sente subito, anche mentre suona. */
export class DeviceView {
  readonly element = el('section', { className: 'device-view', hidden: true, tabIndex: -1 });
  private trackId: TrackId | null = null;
  private back: (() => void) | null = null;
  private builtFor: { track: TrackId; type: string } | null = null;
  private readonly controls = new Map<string, ParamControl>();
  private readonly title = el('span', { className: 'device-title' });
  private readonly typeSelect = el<HTMLSelectElement>('select', { title: 'Tipo di strumento' });
  private readonly presetSelect = el<HTMLSelectElement>('select', { title: 'Preset' });
  private readonly backButton = el<HTMLButtonElement>('button', { textContent: '◂ Note', title: 'Torna al piano roll' });
  private readonly body = el('div', { className: 'device-body' });

  constructor(private readonly deps: DeviceViewDeps) {
    this.typeSelect.append(...INSTRUMENT_TYPES.map(t => el('option', { value: t.type, textContent: t.label })));
    this.typeSelect.onchange = () => this.trackId && deps.store.apply(setInstrument(this.trackId, { ...DEFAULT_INSTRUMENT, type: this.typeSelect.value, preset: null }));
    this.presetSelect.onchange = () => this.loadPreset(this.presetSelect.value);
    this.backButton.onclick = () => this.back?.();
    const test = el<HTMLButtonElement>('button', { textContent: '♪ Prova', title: 'Suona un Do3', onclick: () => this.trackId && deps.audition(this.trackId, 60) });
    const close = el<HTMLButtonElement>('button', { className: 'close', textContent: '×', title: 'Chiudi (Esc)', onclick: () => this.close() });
    this.element.append(el('div', { className: 'device-head' }, this.backButton, this.title, this.typeSelect, this.presetSelect, test, close), this.body);
    this.element.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
    });
    deps.store.onChange(() => this.sync());
  }

  get isOpen(): boolean {
    return this.trackId !== null;
  }

  /** Apre lo strumento della traccia; `back` riporta a chi l'ha aperto (il piano roll). */
  open(track: TrackId, back: (() => void) | null = null): boolean {
    if (!(this.deps.store.project.track(track) instanceof MidiTrack)) return false;
    this.trackId = track;
    this.back = back;
    this.element.hidden = false;
    this.sync();
    this.element.focus();
    return true;
  }

  close(): void {
    this.trackId = null;
    this.builtFor = null;
    this.element.hidden = true;
  }

  private track(): MidiTrack | null {
    const t = this.trackId ? this.deps.store.project.track(this.trackId) : undefined;
    return t instanceof MidiTrack ? t : null;
  }

  private sync(): void {
    if (!this.isOpen) return;
    const track = this.track();
    if (!track) return this.close();
    const settings = track.instrument;
    const type = instrumentType(settings.type);
    this.title.textContent = track.name;
    this.title.style.setProperty('--color', track.color);
    this.backButton.hidden = !this.back;
    this.typeSelect.value = settings.type;
    if (!type) {
      this.body.replaceChildren(el('p', { className: 'muted', textContent: `Strumento "${settings.type}" non disponibile in questa versione.` }));
      this.builtFor = null;
      return;
    }
    if (this.builtFor?.track !== track.id || this.builtFor.type !== type.type) this.build(track.id, type);
    const values = resolveParams(type, settings.params);
    for (const [id, control] of this.controls) control.set(values[id]);
    this.presetSelect.replaceChildren(
      el('option', { value: '', textContent: settings.preset ?? '— preset —', disabled: true, hidden: !settings.preset }),
      ...type.presets.map(p => el('option', { value: p.name, textContent: p.name })));
    this.presetSelect.value = type.presets.some(p => p.name === settings.preset) ? settings.preset! : '';
  }

  /** Una scheda per sezione, un controllo per parametro. */
  private build(track: TrackId, type: InstrumentType): void {
    this.builtFor = { track, type: type.type };
    this.controls.clear();
    const values = resolveParams(type, this.track()?.instrument.params ?? {});
    this.body.replaceChildren(...type.sections.map(section => el('div', { className: 'device-section' },
      el('div', { className: 'device-section-title', textContent: section.label }),
      el('div', { className: 'device-controls' }, ...section.params.map(spec => {
        const control = controlFor(spec, values[spec.id], (v, final) => this.setParam(spec.id, v, final));
        this.controls.set(spec.id, control);
        return control.element;
      })))));
    // controllo di coerenza: ogni parametro ha il suo controllo
    if (this.controls.size !== paramsOf(type).length) console.warn(`parametri duplicati in ${type.type}`);
  }

  private setParam(id: string, value: number, final: boolean): void {
    const { store } = this.deps;
    if (!this.trackId) return;
    // una manopola trascinata è un solo passo di annullamento
    store.apply(setInstrumentParam(this.trackId, id, value), { mergeKey: `param-${this.trackId}-${id}` });
    if (final) store.endMerge();
  }

  private loadPreset(name: string): void {
    const track = this.track();
    const preset = track && instrumentType(track.instrument.type)?.presets.find(p => p.name === name);
    if (!track || !preset) return;
    this.deps.store.apply(loadPreset(track.id, preset.name, preset.params));
    this.deps.audition(track.id, 60);
  }
}
