/* The computer keyboard on macros and parameters (see model/key-map). With "KEY" on the
 * pressed key goes to the chosen target (Del removes it, Esc turns KEY off). Off, mapped keys
 * move their targets before any other key, as in Live, except the note keys with
 * ⌨ on (see app/note-keyboard); with Ctrl or Alt they stay shortcuts, and in text fields you type. */
import { keyLabel, targetsOf } from '../model/key-map';
import { holdKey, pressKey, setKey, springTargets, type MacroTarget } from '../store/key-edits';
import type { MacroSprings } from '../store/macro-springs';
import type { ProjectStore } from '../store/project-store';
import { findBinding, KEYMAP, ownedByField } from '../ui/keymap';
import type { UiState } from '../ui/ui-state';

/** Keys that can't be mapped: shortcuts without Ctrl, Esc and the arrows (the views use them). */
const RESERVED = new Set(['Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

export class KeyMapper {
  /** The keys down that moved something: on release the buttons turn off. */
  private readonly held = new Set<string>();
  /** The springs each key down holds: when the key is released, they return. */
  private readonly springs = new Map<string, MacroTarget[]>();

  constructor(
    private readonly store: ProjectStore,
    private readonly ui: UiState,
    private readonly say: (text: string) => void,
    private readonly macroSprings?: MacroSprings,
  ) {
    addEventListener('keydown', e => this.down(e), true);
    addEventListener('keyup', e => this.up(e), true);
    // a key released outside the window doesn't arrive: the buttons turn off anyway
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

  /** With KEY on: the key for the chosen target. */
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
      return this.say('Key removed.');
    }
    const label = keyLabel(e.code);
    if (RESERVED.has(e.code) || findBinding(KEYMAP, e)) return this.say(`${label} is already used by the app: choose another key.`);
    this.store.apply(setKey(target, e.code));
    const others = targetsOf(this.store.project.keyMap, e.code).length - 1;
    this.say(`Mapped to key ${label}${others ? ` (it also moves ${others === 1 ? 'another control' : `${others} other controls`})` : ''}. Del removes it, Esc turns KEY off.`);
  }
}
