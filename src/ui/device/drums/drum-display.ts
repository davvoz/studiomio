/* Il pannello della Drum Machine: a sinistra i 16 pad in griglia 4×4 (il primo in basso a
 * sinistra, come sui controller), a destra i controlli del pad scelto e l'uscita. Un clic su
 * un pad lo sceglie e lo suona; trascinarlo su un altro li scambia (con Ctrl lo copia). */
import { paramActive, paramSpec, resolveParams } from '../../../devices/device-type';
import {
  DRUM_MODELS, DRUM_PADS, modelDefaults, padNames, padNote, padOfNote, padParam, padsOf, type DrumPad, type PadKey,
} from '../../../devices/instruments/drums/drums';
import type { ParamSpec } from '../../../devices/params';
import type { DeviceSettings, ParamValues } from '../../../model/device';
import { SEPARATOR, showContextMenu } from '../../context-menu';
import { el } from '../../dom';
import { pitchName } from '../../piano-roll/pitch-axis';
import { controlFor, setActive, type ParamControl } from '../controls';
import type { DeviceDisplay, DisplayContext } from '../displays';

/** Il colore dei pad per famiglia di suono. */
const MODEL_COLORS: Readonly<Record<string, string>> = {
  kick: '#ff9d2e', boom: '#ff7a2e', snare: '#f2d14b', clap: '#f2d14b', rim: '#e8c06a',
  hatClosed: '#4fd1e0', hatOpen: '#4fd1e0', cymbal: '#7fb6ff', tom: '#7bd88f', cowbell: '#c79bff', shaker: '#c79bff',
};

/** I controlli del pad, nell'ordine in cui compaiono (il suono ha il suo menu). */
const PAD_CONTROLS: readonly PadKey[] = ['tune', 'decay', 'tone', 'snap', 'level', 'pan', 'choke'];

/** Tutti i valori di un pad, per copiarlo o scambiarlo. */
const padValues = (pad: DrumPad, index: number): Record<string, number> =>
  Object.fromEntries(Object.entries(pad).map(([key, v]) => [padParam(index, key as PadKey), v]));

/** Velocity dei colpi di prova. */
const AUDITION_VELOCITY = 110;

export class DrumDisplay implements DeviceDisplay {
  readonly element = el('div', { className: 'drum-display' });
  private readonly padButtons: HTMLButtonElement[];
  private readonly model = el<HTMLSelectElement>('select', { className: 'drum-model', title: 'Il suono del pad' },
    ...DRUM_MODELS.map((m, i) => el('option', { value: String(i), textContent: m.label })));
  private readonly padTitle = el('div', { className: 'drum-pad-title' });
  private readonly hint = el('div', { className: 'drum-hint muted' });
  private readonly controls = el('div', { className: 'device-controls' });
  private readonly padControls = new Map<string, { spec: ParamSpec; control: ParamControl }>();
  private values: Record<string, number> = {};
  private params: ParamValues | null = null;
  private pads: DrumPad[] = [];
  private selected = 0;
  /** Il pannello è stato nel documento: quando ne esce (chiuso per sempre, ricostruito) smette di guardare le note. */
  private shown = false;

  constructor(private readonly ctx: DisplayContext) {
    this.read(ctx.settings.params);
    this.padButtons = Array.from({ length: DRUM_PADS }, (_, i) => this.padButton(i));
    // il primo pad in basso a sinistra: le righe vanno dall'alto (pad 13-16) al basso (1-4)
    const grid = el('div', { className: 'drum-pads' });
    for (let row = 3; row >= 0; row--) grid.append(...this.padButtons.slice(row * 4, row * 4 + 4));
    this.model.onchange = () => {
      this.ctx.setParams(modelDefaults(this.selected, Number(this.model.value)), true);
      this.play(this.selected);
    };
    const global = (id: string) => this.control(paramSpec(ctx.type, id)!);
    this.element.append(grid, el('div', { className: 'drum-editor' },
      el('div', { className: 'drum-pad-head' }, this.padTitle, this.model, this.hint),
      el('div', { className: 'drum-controls' }, this.controls, el('div', { className: 'eq-sep' }), global('velocity'), global('volume'))));
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
    }
    requestAnimationFrame(this.frame);
  };

  update(settings: DeviceSettings, _enabled: boolean): void {
    if (settings.params !== this.params) this.read(settings.params);
    this.refresh();
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
    const names = padNames(this.values);
    this.padButtons.forEach((b, i) => {
      const model = DRUM_MODELS[this.pads[i].model];
      b.querySelector('.drum-pad-name')!.textContent = names[i];
      b.style.setProperty('--pad', MODEL_COLORS[model?.id] ?? 'var(--accent)');
      b.classList.toggle('selected', i === this.selected);
    });
    const pad = this.pads[this.selected];
    this.padTitle.textContent = `Pad ${this.selected + 1} · ${pitchName(padNote(this.selected))}`;
    this.model.value = String(pad.model);
    this.hint.textContent = DRUM_MODELS[pad.model]?.hint ?? '';
    for (const { spec, control } of this.padControls.values()) {
      control.set(this.values[spec.id]);
      setActive(control, paramActive(spec, this.values));
    }
  }

  private select(i: number): void {
    this.selected = i;
    for (const id of [...this.padControls.keys()]) if (/^p\d+/.test(id)) this.padControls.delete(id);
    this.controls.replaceChildren(...PAD_CONTROLS.map(k => this.control(paramSpec(this.ctx.type, padParam(i, k))!)));
    this.refresh();
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
    return b;
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
    this.ctx.setParams(copy ? padValues(a, to) : { ...padValues(a, to), ...padValues(b, from) }, true);
    this.select(to);
  }

  private menu(i: number, x: number, y: number): void {
    const kit = resolveParams(this.ctx.type, {});
    const fresh = padsOf(kit)[i];
    showContextMenu(x, y, [
      ...DRUM_MODELS.map((m, k) => ({
        label: m.label, checked: this.pads[i].model === k,
        run: () => { this.ctx.setParams(modelDefaults(i, k), true); this.play(i); },
      })),
      SEPARATOR,
      { label: 'Riporta il pad com\'era nel kit di partenza', run: () => this.ctx.setParams(padValues(fresh, i), true) },
    ]);
  }
}
