import type { TrackId } from '../../core/id';
import { EFFECT_TYPES, effectType, INSTRUMENT_TYPES, instrumentType } from '../../devices/registry';
import { DEFAULT_INSTRUMENT, type EffectSettings } from '../../model/device';
import type { EffectList } from '../../model/effect-list';
import { MASTER, type ChainOwner } from '../../model/project';
import { MidiTrack, type Track } from '../../model/track';
import {
  addEffect, loadEffectPreset, loadPreset, moveEffect, removeEffect, setEffectEnabled, setEffectParam,
  setInstrument, setInstrumentParam,
} from '../../store/edits';
import type { Edit, ProjectStore } from '../../store/project-store';
import { showContextMenu } from '../context-menu';
import { el } from '../dom';
import { DevicePanel } from './device-panel';

export interface DeviceViewDeps {
  readonly store: ProjectStore;
  /** Suona una nota di prova con lo strumento della traccia. */
  readonly audition: (track: TrackId, pitch: number) => void;
}

/** La chiave del pannello dello strumento (gli effetti usano il loro id). */
const INSTRUMENT = 'instrument';

/** Colore del master nel titolo. */
export const MASTER_COLOR = 'var(--text)';

/** Ciò che la vista mostra di chi possiede la catena: una traccia o il master. */
interface ChainSource {
  readonly name: string;
  readonly color: string;
  /** La traccia, se la catena è di una traccia (per lo strumento delle tracce MIDI). */
  readonly track: Track | null;
  readonly effects: EffectList;
}

/** La catena dei dispositivi di una traccia o del master, in fila come in Live: lo strumento
 *  (tracce MIDI), poi gli effetti nell'ordine in cui il suono li attraversa. Ogni modifica passa
 *  dallo store (si annulla) e si sente subito, anche mentre suona. */
export class DeviceView {
  readonly element = el('section', { className: 'device-view', hidden: true, tabIndex: -1 });
  private owner: ChainOwner | null = null;
  private back: (() => void) | null = null;
  /** Com'era fatta la catena quando i pannelli sono stati costruiti. */
  private builtFor = '';
  private readonly panels = new Map<string, DevicePanel>();
  private readonly title = el('span', { className: 'device-title' });
  private readonly backButton = el<HTMLButtonElement>('button', { textContent: '◂ Note', title: 'Torna al piano roll' });
  private readonly chain = el('div', { className: 'device-chain' });

  constructor(private readonly deps: DeviceViewDeps) {
    this.backButton.onclick = () => this.back?.();
    const add = el<HTMLButtonElement>('button', { textContent: '+ Effetto', title: 'Aggiungi un effetto in fondo alla catena' });
    add.onclick = () => {
      const r = add.getBoundingClientRect();
      this.chooseEffect(r.left, r.bottom + 2);
    };
    const close = el<HTMLButtonElement>('button', { className: 'close', textContent: '×', title: 'Chiudi (Esc)', onclick: () => this.close() });
    this.element.append(el('div', { className: 'device-head' }, this.backButton, this.title, add, close), this.chain);
    this.element.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
    });
    deps.store.onChange(() => this.sync());
  }

  get isOpen(): boolean {
    return this.owner !== null;
  }

  /** Di chi è la catena aperta (per i test automatici). */
  get openOwner(): ChainOwner | null {
    return this.owner;
  }

  /** Apre i dispositivi di una traccia o del master; `back` riporta a chi l'ha aperta (il piano roll). */
  open(owner: ChainOwner, back: (() => void) | null = null): boolean {
    if (!this.sourceOf(owner)) return false;
    this.owner = owner;
    this.back = back;
    this.builtFor = '';
    this.element.hidden = false;
    this.sync();
    this.element.focus();
    return true;
  }

  close(): void {
    this.owner = null;
    this.element.hidden = true;
  }

  /** Il menu dei tipi di effetto; quello scelto va in fondo alla catena. */
  chooseEffect(x: number, y: number): void {
    const owner = this.owner;
    if (!owner) return;
    showContextMenu(x, y, EFFECT_TYPES.map(t => ({ label: t.label, run: () => this.deps.store.apply(addEffect(owner, t.type, t.label)) })));
  }

  private sourceOf(owner: ChainOwner): ChainSource | null {
    const project = this.deps.store.project;
    if (owner === MASTER) return { name: 'Master', color: MASTER_COLOR, track: null, effects: project.masterEffects };
    const track = project.track(owner);
    return track ? { name: track.name, color: track.color, track, effects: track.effects } : null;
  }

  private effects(): EffectList {
    return (this.owner && this.sourceOf(this.owner)?.effects) || [];
  }

  private sync(): void {
    if (!this.owner) return;
    const source = this.sourceOf(this.owner);
    if (!source) return this.close();
    this.title.textContent = source.name;
    this.title.style.setProperty('--color', source.color);
    this.backButton.hidden = !this.back;
    const shape = shapeOf(this.owner, source);
    if (shape !== this.builtFor) this.build(this.owner, source, shape);
    else this.update(source);
  }

  /** Pannelli nuovi quando cambia la forma della catena (effetti aggiunti, tolti, spostati). */
  private build(owner: ChainOwner, { track, effects }: ChainSource, shape: string): void {
    const scroll = this.chain.scrollLeft;
    const known = new Set(this.panels.keys());
    this.builtFor = shape;
    this.panels.clear();
    const items: Node[] = [];
    if (track instanceof MidiTrack) items.push(this.instrumentPanel(track) ?? missing(track.instrument.type));
    effects.forEach((e, i) => items.push(this.effectPanel(owner, e, i, effects.length) ?? missing(e.type)));
    if (!effects.length) items.push(el('div', { className: 'device-empty muted', textContent: 'Nessun effetto: "+ Effetto" ne aggiunge uno.' }));
    this.chain.replaceChildren(...items);
    this.chain.scrollLeft = scroll;
    // un effetto appena aggiunto si vede subito, anche in fondo a una catena lunga
    const added = known.size ? effects.filter(e => !known.has(e.id)).at(-1) : undefined;
    if (added) this.panels.get(added.id)?.element.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  private update({ track, effects }: ChainSource): void {
    if (track instanceof MidiTrack) this.panels.get(INSTRUMENT)?.update(track.instrument);
    for (const e of effects) this.panels.get(e.id)?.update(e, e.enabled);
  }

  private instrumentPanel(track: MidiTrack): HTMLElement | null {
    const type = instrumentType(track.instrument.type);
    if (!type) return null;
    const { store, audition } = this.deps;
    const select = el<HTMLSelectElement>('select', { title: 'Strumento' },
      ...INSTRUMENT_TYPES.map(t => el('option', { value: t.type, textContent: t.label })));
    select.value = type.type;
    select.onchange = () => store.apply(setInstrument(track.id, { ...DEFAULT_INSTRUMENT, type: select.value, preset: null }));
    const test = el<HTMLButtonElement>('button', { className: 'mini', textContent: '♪', title: 'Suona un Do3', onclick: () => audition(track.id, 60) });
    const panel = new DevicePanel({
      type, settings: track.instrument, before: [select], after: [test],
      onParam: (id, v, final) => this.param(setInstrumentParam(track.id, id, v), `param-${track.id}-${id}`, final),
      onPreset: p => {
        store.apply(loadPreset(track.id, p.name, p.params));
        audition(track.id, 60);
      },
    });
    panel.element.classList.add('instrument-panel');
    this.panels.set(INSTRUMENT, panel);
    return panel.element;
  }

  private effectPanel(owner: ChainOwner, e: EffectSettings, index: number, count: number): HTMLElement | null {
    const type = effectType(e.type);
    if (!type) return null;
    const { store } = this.deps;
    const id = e.id;
    const current = () => this.effects().find(x => x.id === id);
    const button = (text: string, title: string, run: () => void, disabled = false) =>
      el<HTMLButtonElement>('button', { className: 'mini', textContent: text, title, disabled, onclick: run });
    const power = button('⏻', 'Accendi/spegni', () => store.apply(setEffectEnabled(owner, id, !current()?.enabled)));
    power.classList.add('power');
    const panel = new DevicePanel({
      type, settings: e, before: [power],
      after: [
        button('◂', 'Sposta prima', () => store.apply(moveEffect(owner, id, index - 1)), index === 0),
        button('▸', 'Sposta dopo', () => store.apply(moveEffect(owner, id, index + 1)), index === count - 1),
        button('×', 'Elimina l\'effetto', () => store.apply(removeEffect(owner, id))),
      ],
      onParam: (param, v, final) => this.param(setEffectParam(owner, id, param, v), `fx-${id}-${param}`, final),
      onPreset: p => store.apply(loadEffectPreset(owner, id, p.name, p.params)),
    });
    panel.update(e, e.enabled);
    this.panels.set(id, panel);
    return panel.element;
  }

  /** Una manopola trascinata è un solo passo di annullamento. */
  private param(edit: Edit, mergeKey: string, final: boolean): void {
    this.deps.store.apply(edit, { mergeKey });
    if (final) this.deps.store.endMerge();
  }
}

/** La forma della catena: cambia se cambiano proprietario, strumento, effetti, il loro ordine o tipo. */
const shapeOf = (owner: ChainOwner, { track, effects }: ChainSource): string =>
  [owner, track instanceof MidiTrack ? track.instrument.type : '-', ...effects.map(e => `${e.id}:${e.type}`)].join('|');

const missing = (type: string) =>
  el('div', { className: 'device-empty muted', textContent: `"${type}" non è disponibile in questa versione.` });
