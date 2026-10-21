import { paramActive, resolveParams, type DeviceType, type Preset } from '../../devices/device-type';
import type { ParamSpec } from '../../devices/params';
import { presetParams, userPresets } from '../../devices/user-presets';
import type { DeviceSettings } from '../../model/device';
import type { MenuItem } from '../context-menu';
import { el } from '../dom';
import { editInline } from '../inline-rename';
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
  /** Con questa, il pannello permette di salvare i preset dell'utente (★): riceve il preset
   *  appena salvato, che diventa quello del dispositivo. */
  readonly onPresetSaved?: (preset: Preset) => void;
  /** Un messaggio per la barra di stato (preset salvato, nome non valido…). */
  readonly say?: (text: string) => void;
  /** Un pannello grafico (es. l'EQ) al posto delle manopole generate. */
  readonly display?: DeviceDisplay;
  /** Schede in più, dopo quelle dei parametri (es. il sidechain del compressore). */
  readonly extra?: readonly HTMLElement[];
  /** Il pannello parte compresso (solo l'intestazione, in verticale). */
  readonly folded?: boolean;
  /** Il pannello compresso o riaperto (▾/▸ o doppio clic sull'intestazione). */
  readonly onFold?: (folded: boolean) => void;
}

/** Lo spazio tra le schede (come `gap` di .device-sections). */
const SECTION_GAP = 6;

/** La larghezza più stretta in cui delle schede larghe `widths`, messe in fila e a capo quando
 *  non ci stanno più (come fa flex-wrap), occupano al più `rows` righe. */
export function narrowestWidth(widths: readonly number[], gap: number, rows: number): number {
  const rowsAt = (width: number) => {
    let n = 1, x = 0;
    for (const w of widths) {
      if (x > 0 && x + gap + w > width) { n++; x = w; } else x += (x > 0 ? gap : 0) + w;
    }
    return n;
  };
  // la più stretta è sempre larga quanto una riga: una fila di schede di seguito (sono poche)
  const widest = Math.max(0, ...widths);
  let best = Infinity;
  for (let i = 0; i < widths.length; i++) {
    for (let j = i, row = widths[i]; j < widths.length; row += gap + widths[++j]) {
      if (row >= widest && row < best && rowsAt(row) <= rows) best = row;
    }
  }
  return Number.isFinite(best) ? Math.ceil(best) : 0;
}

/** Un dispositivo (strumento o effetto) nella catena: intestazione con nome e preset, poi una
 *  scheda per sezione e un controllo per parametro, tutto dalla descrizione del tipo; oppure
 *  il pannello grafico del tipo, se ne ha uno. */
export class DevicePanel {
  readonly element = el('div', { className: 'device-panel' });
  private readonly controls = new Map<string, { spec: ParamSpec; control: ParamControl }>();
  private readonly presets = el<HTMLSelectElement>('select', { className: 'preset', title: 'Preset' });
  private readonly fold = el<HTMLButtonElement>('button', { className: 'mini fold' });
  private readonly save = el<HTMLButtonElement>('button', { className: 'mini save-preset', textContent: '★', title: 'Salva come preset (clic destro sull\'intestazione: aggiorna, elimina)' });
  private readonly sections = el('div', { className: 'device-sections' });
  private settings: DeviceSettings;

  constructor(private readonly options: DevicePanelOptions) {
    const { type, settings } = options;
    this.settings = settings;
    this.presets.onchange = () => {
      const preset = presetFrom(type, this.presets.value);
      if (preset) options.onPreset(preset);
    };
    // i preset salvati da un altro pannello dello stesso tipo compaiono appena si apre la tendina
    this.presets.onfocus = this.presets.onpointerenter = () => this.fillPresets();
    this.save.onclick = () => this.askName();
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
      el('span', { className: 'device-name', textContent: type.label }),
      ...(options.display?.head ? [Object.assign(options.display.head, { className: 'display-head' })] : []), this.presets,
      ...(options.onPresetSaved ? [this.save] : []), ...(options.after ?? []));
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
    this.sections.append(...sections);
    this.element.append(head, this.sections);
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
    if (!folded) this.fitRows();
  }

  /** Le schede vanno a capo per stare nell'altezza del pannello: tante righe quante ne stanno,
   *  nella larghezza più stretta che le tiene (nel loro ordine, da sinistra a destra e poi
   *  sotto), invece di una riga lunga con il vuoto sotto. Da rifare quando cambia l'altezza;
   *  non fa niente finché il pannello non si vede, né con un pannello grafico. */
  fitRows(): void {
    if (this.options.display || this.folded) return;
    const box = this.sections, cards = [...box.children] as HTMLElement[];
    box.style.maxWidth = '';
    const sizes = cards.map(c => c.getBoundingClientRect());
    if (!sizes.length || sizes.some(r => !r.width)) return;
    const tallest = Math.max(...sizes.map(r => r.height));
    const room = this.element.getBoundingClientRect().bottom - box.getBoundingClientRect().top
      - parseFloat(getComputedStyle(this.element).paddingBottom);
    const rows = Math.max(1, Math.floor((room + SECTION_GAP) / (tallest + SECTION_GAP)));
    if (rows > 1) box.style.maxWidth = `${narrowestWidth(sizes.map(r => r.width), SECTION_GAP, rows)}px`;
  }

  /** Valori, parametri attivi, preset e acceso/spento dalle impostazioni attuali. */
  update(settings: DeviceSettings, enabled = true): void {
    const { type } = this.options;
    const values = resolveParams(type, settings.params);
    for (const [id, { spec, control }] of this.controls) {
      control.set(values[id]);
      setActive(control, paramActive(spec, values));
    }
    this.settings = settings;
    this.fillPresets();
    this.element.classList.toggle('off', !enabled);
    this.options.display?.update(settings, enabled);
  }

  /** Le voci dei preset per il menu dell'intestazione: salva, aggiorna, elimina. */
  presetMenu(): MenuItem[] {
    if (!this.options.onPresetSaved) return [];
    const mine = this.userPreset();
    return [
      { label: 'Salva come preset…', run: () => this.askName() },
      { label: mine ? `Aggiorna il preset «${mine}»` : 'Aggiorna il preset', disabled: !mine, run: () => mine && void this.savePreset(mine) },
      { label: mine ? `Elimina il preset «${mine}»` : 'Elimina il preset', disabled: !mine, run: () => mine && void this.removePreset(mine) },
      ...(userPresets.canReveal ? [{ label: 'Apri la cartella dei preset', run: () => void this.reveal() }] : []),
    ];
  }

  /** Il nome del preset attuale, se è uno dell'utente. */
  private userPreset(): string | null {
    const name = this.settings.preset;
    return name && userPresets.find(this.options.type.type, name) ? name : null;
  }

  /** La tendina: prima i preset dell'utente, poi quelli di fabbrica. */
  private fillPresets(): void {
    const { type } = this.options;
    const { preset } = this.settings;
    const mine = userPresets.list(type.type);
    const option = (kind: string, p: Preset) => el('option', { value: `${kind}:${p.name}`, textContent: p.name });
    const value = preset && mine.some(p => p.name === preset) ? `${USER}:${preset}`
      : preset && type.presets.some(p => p.name === preset) ? `${FACTORY}:${preset}` : '';
    this.presets.replaceChildren(
      el('option', { value: '', textContent: preset ?? '— preset —', disabled: true, hidden: !!value }),
      ...(mine.length ? [
        el('optgroup', { label: 'I miei preset' }, ...mine.map(p => option(USER, p))),
        el('optgroup', { label: 'Di fabbrica' }, ...type.presets.map(p => option(FACTORY, p))),
      ] : type.presets.map(p => option(FACTORY, p))));
    this.presets.value = value;
  }

  /** Il nome del preset si scrive al posto della tendina; quello di un preset dell'utente lo
   *  aggiorna. */
  private askName(): void {
    if (!this.presets.isConnected) return;
    editInline(this.presets, this.userPreset() ?? '', name => void this.savePreset(name), 'Nome del preset');
  }

  private async savePreset(name: string): Promise<void> {
    const { type, onPresetSaved, say } = this.options;
    if (type.presets.some(p => p.name === name)) {
      say?.(`«${name}» è un preset di fabbrica di ${type.label}: scegli un altro nome.`);
      return;
    }
    const existed = !!userPresets.find(type.type, name);
    const preset: Preset = { name, params: presetParams(type, this.settings.params) };
    try {
      await userPresets.save(type.type, preset);
    } catch (e) {
      say?.(`Non è stato possibile salvare il preset «${name}»: ${message(e)}`);
      return;
    }
    onPresetSaved?.(preset);
    this.fillPresets();
    say?.(existed ? `Preset «${name}» aggiornato.` : `Preset «${name}» salvato: lo trovi in ${type.label}, in tutti i progetti.`);
  }

  private async removePreset(name: string): Promise<void> {
    const { type, say } = this.options;
    try {
      await userPresets.remove(type.type, name);
    } catch (e) {
      say?.(`Non è stato possibile eliminare il preset «${name}»: ${message(e)}`);
      return;
    }
    this.fillPresets();
    say?.(`Preset «${name}» eliminato.`);
  }

  private async reveal(): Promise<void> {
    try {
      await userPresets.reveal();
    } catch (e) {
      this.options.say?.(`Non è stato possibile aprire la cartella dei preset: ${message(e)}`);
    }
  }
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Nella tendina, il valore di una voce dice di chi è il preset (dell'utente o di fabbrica). */
const USER = 'u';
const FACTORY = 'f';

function presetFrom(type: DeviceType, value: string): Preset | undefined {
  const [kind, name] = [value.slice(0, 1), value.slice(2)];
  return kind === USER ? userPresets.find(type.type, name) : kind === FACTORY ? type.presets.find(p => p.name === name) : undefined;
}
