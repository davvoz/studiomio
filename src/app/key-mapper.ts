/* La tastiera del computer sulle macro e sui parametri (vedi model/key-map). Con "KEY" acceso il
 * tasto premuto va al bersaglio scelto (Canc lo toglie, Esc spegne KEY). Spento, i tasti mappati
 * muovono i loro bersagli prima di ogni altro tasto, come in Live; con Ctrl o Alt restano
 * scorciatoie, e nei campi di testo si scrive. */
import { keyLabel, targetsOf } from '../model/key-map';
import { holdKey, pressKey, setKey, springTargets, type MacroTarget } from '../store/key-edits';
import type { MacroSprings } from '../store/macro-springs';
import type { ProjectStore } from '../store/project-store';
import { findBinding, KEYMAP, ownedByField } from '../ui/keymap';
import type { UiState } from '../ui/ui-state';

/** Tasti che non si mappano: le scorciatoie senza Ctrl, Esc e le frecce (le usano le viste). */
const RESERVED = new Set(['Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

export class KeyMapper {
  /** I tasti giù che hanno mosso qualcosa: al rilascio i pulsanti si spengono. */
  private readonly held = new Set<string>();
  /** Le molle che ogni tasto giù tiene: lasciato il tasto, tornano. */
  private readonly springs = new Map<string, MacroTarget[]>();

  constructor(
    private readonly store: ProjectStore,
    private readonly ui: UiState,
    private readonly say: (text: string) => void,
    private readonly macroSprings?: MacroSprings,
  ) {
    addEventListener('keydown', e => this.down(e), true);
    addEventListener('keyup', e => this.up(e), true);
    // un tasto lasciato fuori dalla finestra non arriva: i pulsanti si spengono lo stesso
    addEventListener('blur', () => this.releaseAll());
    ui.onChange(() => { if (ui.keyMapping) this.releaseAll(); });
  }

  private down(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey || ownedByField(e.target as HTMLElement | null, e)) return;
    if (this.ui.keyMapping) return this.assign(e);
    if (!targetsOf(this.store.project.keyMap, e.code).length) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat || this.held.has(e.code)) return;
    this.held.add(e.code);
    this.store.apply(pressKey(e.code));
    this.store.apply(holdKey(e.code, true), { transient: true });
    this.holdSprings(e.code, true);
  }

  private up(e: KeyboardEvent): void {
    if (!this.held.delete(e.code)) return;
    e.preventDefault();
    e.stopPropagation();
    this.store.apply(holdKey(e.code, false), { transient: true });
    this.holdSprings(e.code, false);
  }

  private releaseAll(): void {
    for (const key of [...this.held]) {
      this.held.delete(key);
      this.store.apply(holdKey(key, false), { transient: true });
      this.holdSprings(key, false);
    }
  }

  private holdSprings(key: string, down: boolean): void {
    if (!this.macroSprings) return;
    const targets = down ? springTargets(this.store.project, targetsOf(this.store.project.keyMap, key)) : this.springs.get(key) ?? [];
    if (down) this.springs.set(key, targets);
    else this.springs.delete(key);
    for (const t of targets) this.macroSprings.hold(t.owner, t.rack, t.index, down);
  }

  /** Con KEY acceso: il tasto per il bersaglio scelto. */
  private assign(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.ui.setKeyMapping(false);
      return;
    }
    const target = this.ui.keyTarget;
    if (!target || MODIFIERS.has(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.store.apply(setKey(target, null));
      return this.say('Tasto tolto.');
    }
    const label = keyLabel(e.code);
    if (RESERVED.has(e.code) || findBinding(KEYMAP, e)) return this.say(`${label} serve già all'app: scegli un altro tasto.`);
    this.store.apply(setKey(target, e.code));
    const others = targetsOf(this.store.project.keyMap, e.code).length - 1;
    this.say(`Mappato sul tasto ${label}${others ? ` (muove anche ${others === 1 ? 'un altro controllo' : `altri ${others} controlli`})` : ''}. Canc lo toglie, Esc spegne KEY.`);
  }
}
