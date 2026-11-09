/* Any controller's MIDI on macros, parameters and the mixer (see model/midi-map).
 * With "MIDI" on the moved control goes to the chosen target (Del removes it, Esc turns MIDI off).
 * Off, mapped controls move their targets: of CCs arriving together only the last
 * value of each is applied, and a sweep is a single undo step. The ports the MIDI
 * comes from are opened by ControlSurfaces, only if needed. */
import type { ControlSurfaces } from '../control/control-surfaces';
import { encodeMidiTarget, midiLabel, midiTargetsOf, type MidiControl } from '../model/midi-map';
import { springTargets, type MacroTarget } from '../store/key-edits';
import type { MacroSprings } from '../store/macro-springs';
import { holdMidi, moveMidi, pressMidi, pullMidi, setMidi } from '../store/midi-edits';
import type { ProjectStore } from '../store/project-store';
import { ownedByField } from '../ui/keymap';
import type { UiState } from '../ui/ui-state';

/** CCs arriving within this time are applied together (a fader sends dozens per second). */
const FLUSH_MS = 15;
/** After how long a still control closes its undo step. */
const MERGE_IDLE_MS = 400;

const controlKey = (c: MidiControl) => `${c.type}:${c.channel}:${c.number}`;

export class MidiMapper {
  /** The latest values of the CCs that arrived, per control, waiting to be applied. */
  private readonly pending = new Map<string, { readonly control: MidiControl; readonly value: number }>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** The last thing said with MIDI on: a fader sends dozens of messages, it's said once. */
  private said = '';
  /** The springs each held note holds: when the note is released, they return. */
  private readonly springs = new Map<string, MacroTarget[]>();

  constructor(
    private readonly store: ProjectStore,
    private readonly ui: UiState,
    surfaces: ControlSurfaces,
    private readonly say: (text: string) => void,
    private readonly macroSprings?: MacroSprings,
  ) {
    surfaces.onMidi(data => this.receive(data));
    addEventListener('keydown', e => this.key(e), true);
    // the ports open when mapping or if the project has mappings
    const listen = () => { surfaces.listening = ui.midiMapping || store.project.midiMap.length > 0; };
    store.onChange(listen);
    ui.onChange(() => {
      listen();
      if (!ui.midiMapping) this.said = '';
    });
    listen();
  }

  /** A MIDI message: CC, note on, note off (the others aren't mapped). */
  receive(data: ArrayLike<number>): void {
    const [status, number, value = 0] = Array.from(data);
    if (status === undefined || status >= 0xf0 || number === undefined) return;
    const kind = status & 0xf0, channel = status & 0x0f;
    if (kind === 0xb0) return this.cc({ type: 'cc', channel, number }, value);
    if (kind === 0x90 && value > 0) return this.note({ type: 'note', channel, number }, true);
    if (kind === 0x80 || kind === 0x90) return this.note({ type: 'note', channel, number }, false);
  }

  private cc(control: MidiControl, value: number): void {
    if (this.ui.midiMapping) return this.learn(control);
    if (!midiTargetsOf(this.store.project.midiMap, control).length) return;
    this.pending.set(controlKey(control), { control, value });
    this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_MS);
  }

  private note(control: MidiControl, down: boolean): void {
    if (this.ui.midiMapping) {
      if (down) this.learn(control);
      return;
    }
    if (!midiTargetsOf(this.store.project.midiMap, control).length) return;
    this.run(() => {
      if (down) this.store.apply(pressMidi(control));
      this.store.apply(holdMidi(control, down), { transient: true });
    });
    this.holdSprings(control, down);
  }

  private holdSprings(control: MidiControl, down: boolean): void {
    if (!this.macroSprings) return;
    const key = controlKey(control);
    const targets = down ? springTargets(this.store.project, midiTargetsOf(this.store.project.midiMap, control)) : this.springs.get(key) ?? [];
    if (down) this.springs.set(key, targets);
    else this.springs.delete(key);
    for (const t of targets) this.macroSprings.hold(t.owner, t.rack, t.index, down);
  }

  private flush(): void {
    this.flushTimer = null;
    const moves = [...this.pending.values()];
    this.pending.clear();
    this.run(() => {
      for (const { control, value } of moves) {
        this.store.apply(holdMidi(control, value >= 64, false), { transient: true });
        this.store.apply(pullMidi(control, value), { transient: true });
        this.store.apply(moveMidi(control, value), { mergeKey: 'midi' });
      }
    });
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.store.endMerge();
    }, MERGE_IDLE_MS);
  }

  private run(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.say(`MIDI: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** With MIDI on: the moved control for the chosen target. */
  private learn(control: MidiControl): void {
    const target = this.ui.midiTarget;
    if (!target) return this.tell(`MIDI: ${midiLabel(control)} arrived. First click a macro, a parameter or a mixer control.`);
    this.run(() => {
      this.store.apply(setMidi(target, control));
      const others = midiTargetsOf(this.store.project.midiMap, control).length - 1;
      this.tell(`Mapped to ${midiLabel(control)}${others ? ` (it also moves ${others === 1 ? 'another control' : `${others} other controls`})` : ''}. Del removes it, Esc turns MIDI off.`,
        `${encodeMidiTarget(target)}=${controlKey(control)}`);
    });
  }

  private tell(text: string, what = text): void {
    if (what === this.said) return;
    this.said = what;
    this.say(text);
  }

  /** With MIDI on: Esc turns it off, Del removes the control from the chosen target. */
  private key(e: KeyboardEvent): void {
    if (!this.ui.midiMapping || e.ctrlKey || e.metaKey || e.altKey || ownedByField(e.target as HTMLElement | null, e)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.ui.setMidiMapping(false);
      return;
    }
    const target = this.ui.midiTarget;
    if (!target || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
    e.preventDefault();
    e.stopPropagation();
    this.run(() => this.store.apply(setMidi(target, null)));
    this.said = '';
    this.say('MIDI control removed.');
  }
}
