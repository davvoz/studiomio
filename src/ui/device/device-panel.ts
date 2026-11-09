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
  /** Controls in the header, next to the name (on/off, move, remove, test…). */
  readonly before?: readonly Node[];
  readonly after?: readonly Node[];
  /** `final` at the end of a gesture: it closes the undo step. */
  readonly onParam: (id: string, value: number, final: boolean) => void;
  readonly onPreset: (preset: Preset) => void;
  /** With this, the panel allows saving user presets (★): it receives the preset
   *  just saved, which becomes the device's. */
  readonly onPresetSaved?: (preset: Preset) => void;
  /** A message for the status bar (preset saved, invalid name…). */
  readonly say?: (text: string) => void;
  /** A graphic panel (e.g. the EQ) in place of the generated knobs. */
  readonly display?: DeviceDisplay;
  /** Extra tabs, after the parameters' ones (e.g. the compressor's sidechain). */
  readonly extra?: readonly HTMLElement[];
  /** The panel starts collapsed (only the header, vertical). */
  readonly folded?: boolean;
  /** The panel collapsed or reopened (▾/▸ or double click on the header). */
  readonly onFold?: (folded: boolean) => void;
}

/** The space between the tabs (like `gap` of .device-sections). */
const SECTION_GAP = 6;

/** The narrowest width in which tabs `widths` wide, put in a row and wrapping when
 *  they no longer fit (as flex-wrap does), take at most `rows` rows. */
export function narrowestWidth(widths: readonly number[], gap: number, rows: number): number {
  const rowsAt = (width: number) => {
    let n = 1, x = 0;
    for (const w of widths) {
      if (x > 0 && x + gap + w > width) { n++; x = w; } else x += (x > 0 ? gap : 0) + w;
    }
    return n;
  };
  // the narrowest is always as wide as one row: a row of tabs in sequence (there are few)
  const widest = Math.max(0, ...widths);
  let best = Infinity;
  for (let i = 0; i < widths.length; i++) {
    for (let j = i, row = widths[i]; j < widths.length; row += gap + widths[++j]) {
      if (row >= widest && row < best && rowsAt(row) <= rows) best = row;
    }
  }
  return Number.isFinite(best) ? Math.ceil(best) : 0;
}

/** A device (instrument or effect) in the chain: header with name and preset, then a
 *  tab per section and a control per parameter, all from the type's description; or
 *  the type's graphic panel, if it has one. */
export class DevicePanel {
  readonly element = el('div', { className: 'device-panel' });
  private readonly controls = new Map<string, { spec: ParamSpec; control: ParamControl }>();
  private readonly presets = el<HTMLSelectElement>('select', { className: 'preset', title: 'Preset' });
  private readonly fold = el<HTMLButtonElement>('button', { className: 'mini fold' });
  private readonly save = el<HTMLButtonElement>('button', { className: 'mini save-preset', textContent: '★', title: 'Save as preset (right click on the header: update, delete)' });
  private readonly sections = el('div', { className: 'device-sections' });
  private settings: DeviceSettings;

  constructor(private readonly options: DevicePanelOptions) {
    const { type, settings } = options;
    this.settings = settings;
    this.presets.onchange = () => {
      const preset = presetFrom(type, this.presets.value);
      if (preset) options.onPreset(preset);
    };
    // the presets saved from another panel of the same type show up as soon as the drop-down opens
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
      // double click on the header's background, as in Live
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

  /** Collapsed: the header remains, vertical, with the name and the on/off. */
  setFolded(folded: boolean): void {
    this.element.classList.toggle('folded', folded);
    this.fold.textContent = folded ? '▸' : '▾';
    this.fold.title = folded ? 'Show the device' : 'Collapse the device';
    if (!folded) this.fitRows();
  }

  /** The tabs wrap to fit the panel's height: as many rows as fit,
   *  in the narrowest width holding them (in their order, from left to right and then
   *  below), instead of one long row with empty space below. To be redone when the height changes;
   *  it does nothing while the panel isn't visible, nor with a graphic panel. */
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

  /** Values, active parameters, preset and on/off from the current settings. */
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

  /** The presets' items for the header's menu: save, update, delete. */
  presetMenu(): MenuItem[] {
    if (!this.options.onPresetSaved) return [];
    const mine = this.userPreset();
    return [
      { label: 'Save as preset…', run: () => this.askName() },
      { label: mine ? `Update the preset «${mine}»` : 'Update the preset', disabled: !mine, run: () => mine && void this.savePreset(mine) },
      { label: mine ? `Delete the preset «${mine}»` : 'Delete the preset', disabled: !mine, run: () => mine && void this.removePreset(mine) },
      ...(userPresets.canReveal ? [{ label: 'Open the presets folder', run: () => void this.reveal() }] : []),
    ];
  }

  /** The current preset's name, if it's a user one. */
  private userPreset(): string | null {
    const name = this.settings.preset;
    return name && userPresets.find(this.options.type.type, name) ? name : null;
  }

  /** The drop-down: first the user's presets, then the factory ones. */
  private fillPresets(): void {
    const { type } = this.options;
    const { preset } = this.settings;
    const mine = userPresets.list(type.type);
    const option = (kind: string, p: Preset) => el('option', { value: `${kind}:${p.name}`, textContent: p.name });
    let value = '';
    if (preset && mine.some(p => p.name === preset)) value = `${USER}:${preset}`;
    else if (preset && type.presets.some(p => p.name === preset)) value = `${FACTORY}:${preset}`;
    this.presets.replaceChildren(
      el('option', { value: '', textContent: preset ?? '— preset —', disabled: true, hidden: !!value }),
      ...(mine.length ? [
        el('optgroup', { label: 'My presets' }, ...mine.map(p => option(USER, p))),
        el('optgroup', { label: 'Factory' }, ...type.presets.map(p => option(FACTORY, p))),
      ] : type.presets.map(p => option(FACTORY, p))));
    this.presets.value = value;
  }

  /** The preset's name is typed in place of the drop-down; a user preset's name
   *  updates it. */
  private askName(): void {
    if (!this.presets.isConnected) return;
    editInline(this.presets, this.userPreset() ?? '', name => void this.savePreset(name), 'Preset name');
  }

  private async savePreset(name: string): Promise<void> {
    const { type, onPresetSaved, say } = this.options;
    if (type.presets.some(p => p.name === name)) {
      say?.(`«${name}» is a factory preset of ${type.label}: choose another name.`);
      return;
    }
    const existed = !!userPresets.find(type.type, name);
    const preset: Preset = { name, params: presetParams(type, this.settings.params) };
    try {
      await userPresets.save(type.type, preset);
    } catch (e) {
      say?.(`Couldn't save the preset «${name}»: ${message(e)}`);
      return;
    }
    onPresetSaved?.(preset);
    this.fillPresets();
    say?.(existed ? `Preset «${name}» updated.` : `Preset «${name}» saved: you'll find it in ${type.label}, in all projects.`);
  }

  private async removePreset(name: string): Promise<void> {
    const { type, say } = this.options;
    try {
      await userPresets.remove(type.type, name);
    } catch (e) {
      say?.(`Couldn't delete the preset «${name}»: ${message(e)}`);
      return;
    }
    this.fillPresets();
    say?.(`Preset «${name}» deleted.`);
  }

  private async reveal(): Promise<void> {
    try {
      await userPresets.reveal();
    } catch (e) {
      this.options.say?.(`Couldn't open the presets folder: ${message(e)}`);
    }
  }
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** In the drop-down, an item's value says whose the preset is (the user's or factory). */
const USER = 'u';
const FACTORY = 'f';

function presetFrom(type: DeviceType, value: string): Preset | undefined {
  const [kind, name] = [value.slice(0, 1), value.slice(2)];
  if (kind === USER) return userPresets.find(type.type, name);
  if (kind === FACTORY) return type.presets.find(p => p.name === name);
  return undefined;
}
