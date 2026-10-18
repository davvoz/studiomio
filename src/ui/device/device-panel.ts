import { paramActive, resolveParams, type DeviceType, type Preset } from '../../devices/device-type';
import type { ParamSpec } from '../../devices/params';
import type { DeviceSettings } from '../../model/device';
import { el } from '../dom';
import { controlFor, setActive, type ParamControl } from './controls';
import type { DeviceDisplay } from './displays';

export interface DevicePanelOptions {
  readonly type: DeviceType;
  readonly settings: DeviceSettings;
  /** Controlli nell'intestazione, accanto al nome (spegnimento, sposta, togli, prova…). */
  readonly before?: readonly Node[];
  readonly after?: readonly Node[];
  /** `final` alla fine di un gesto: chiude il passo di annullamento. */
  readonly onParam: (id: string, value: number, final: boolean) => void;
  readonly onPreset: (preset: Preset) => void;
  /** Un pannello grafico (es. l'EQ) al posto delle manopole generate. */
  readonly display?: DeviceDisplay;
  /** Schede in più, dopo quelle dei parametri (es. il sidechain del compressore). */
  readonly extra?: readonly HTMLElement[];
  /** Il pannello parte compresso (solo l'intestazione, in verticale). */
  readonly folded?: boolean;
  /** Il pannello compresso o riaperto (▾/▸ o doppio clic sull'intestazione). */
  readonly onFold?: (folded: boolean) => void;
}

/** Oltre queste sezioni le schede vanno su due righe che scorrono in orizzontale (come la
 *  catena): un synth grande resta tutto visibile nell'altezza del pannello. */
const GRID_SECTIONS = 6;

/** Un dispositivo (strumento o effetto) nella catena: intestazione con nome e preset, poi una
 *  scheda per sezione e un controllo per parametro, tutto dalla descrizione del tipo; oppure
 *  il pannello grafico del tipo, se ne ha uno. */
export class DevicePanel {
  readonly element = el('div', { className: 'device-panel' });
  private readonly controls = new Map<string, { spec: ParamSpec; control: ParamControl }>();
  private readonly presets = el<HTMLSelectElement>('select', { className: 'preset', title: 'Preset' });
  private readonly fold = el<HTMLButtonElement>('button', { className: 'mini fold' });

  constructor(private readonly options: DevicePanelOptions) {
    const { type, settings } = options;
    this.presets.onchange = () => {
      const preset = type.presets.find(p => p.name === this.presets.value);
      if (preset) options.onPreset(preset);
    };
    const values = resolveParams(type, settings.params);
    const sections = options.display ? [options.display.element] : type.sections.map(section => el('div', { className: 'device-section' },
      el('div', { className: 'device-section-title', textContent: section.label }),
      el('div', { className: 'device-controls' }, ...section.params.map(spec => {
        const control = controlFor(spec, values[spec.id], (v, final) => options.onParam(spec.id, v, final));
        this.controls.set(spec.id, { spec, control });
        return control.element;
      }))));
    sections.push(...(options.extra ?? []));
    const head = el('div', { className: 'device-panel-head' },
      ...(options.onFold ? [this.fold] : []), ...(options.before ?? []),
      el('span', { className: 'device-name', textContent: type.label }), this.presets, ...(options.after ?? []));
    if (options.onFold) {
      const toggle = () => {
        const folded = !this.folded;
        this.setFolded(folded);
        options.onFold!(folded);
      };
      this.fold.onclick = toggle;
      // doppio clic sul fondo dell'intestazione, come in Live
      head.ondblclick = e => { if (e.target === head) toggle(); };
    }
    this.element.append(head,
      el('div', { className: !options.display && sections.length > GRID_SECTIONS ? 'device-sections grid' : 'device-sections' }, ...sections));
    this.setFolded(!!options.folded);
    this.update(settings);
  }

  get folded(): boolean {
    return this.element.classList.contains('folded');
  }

  /** Compresso: resta l'intestazione, in verticale, con il nome e l'accensione. */
  setFolded(folded: boolean): void {
    this.element.classList.toggle('folded', folded);
    this.fold.textContent = folded ? '▸' : '▾';
    this.fold.title = folded ? 'Mostra il dispositivo' : 'Comprimi il dispositivo';
  }

  /** Valori, parametri attivi, preset e acceso/spento dalle impostazioni attuali. */
  update(settings: DeviceSettings, enabled = true): void {
    const { type } = this.options;
    const values = resolveParams(type, settings.params);
    for (const [id, { spec, control }] of this.controls) {
      control.set(values[id]);
      setActive(control, paramActive(spec, values));
    }
    this.presets.replaceChildren(
      el('option', { value: '', textContent: settings.preset ?? '— preset —', disabled: true, hidden: type.presets.some(p => p.name === settings.preset) }),
      ...type.presets.map(p => el('option', { value: p.name, textContent: p.name })));
    this.presets.value = type.presets.some(p => p.name === settings.preset) ? settings.preset! : '';
    this.element.classList.toggle('off', !enabled);
    this.options.display?.update(settings, enabled);
  }
}
