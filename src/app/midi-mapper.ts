/* Il MIDI di un controller qualsiasi sulle macro, sui parametri e sul mixer (vedi model/midi-map).
 * Con "MIDI" acceso il controllo mosso va al bersaglio scelto (Canc lo toglie, Esc spegne MIDI).
 * Spento, i controlli mappati muovono i loro bersagli: dei CC arrivati insieme si applica solo
 * l'ultimo valore di ciascuno, e una corsa è un solo passo di annullamento. Le porte da cui
 * arriva il MIDI le apre ControlSurfaces, solo se servono. */
import type { ControlSurfaces } from '../control/control-surfaces';
import { encodeMidiTarget, midiLabel, midiTargetsOf, type MidiControl } from '../model/midi-map';
import { springTargets, type MacroTarget } from '../store/key-edits';
import type { MacroSprings } from '../store/macro-springs';
import { holdMidi, moveMidi, pressMidi, pullMidi, setMidi } from '../store/midi-edits';
import type { ProjectStore } from '../store/project-store';
import { ownedByField } from '../ui/keymap';
import type { UiState } from '../ui/ui-state';

/** I CC arrivati in questo tempo si applicano insieme (un fader ne manda decine al secondo). */
const FLUSH_MS = 15;
/** Dopo quanto un controllo fermo chiude il suo passo di annullamento. */
const MERGE_IDLE_MS = 400;

const controlKey = (c: MidiControl) => `${c.type}:${c.channel}:${c.number}`;

export class MidiMapper {
  /** Gli ultimi valori dei CC arrivati, per controllo, in attesa di applicarli. */
  private readonly pending = new Map<string, { readonly control: MidiControl; readonly value: number }>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** L'ultima cosa detta con MIDI acceso: un fader manda decine di messaggi, si dice una volta. */
  private said = '';
  /** Le molle che ogni nota accesa tiene: spenta la nota, tornano. */
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
    // le porte si aprono quando si mappa o se il progetto ha mappature
    const listen = () => { surfaces.listening = ui.midiMapping || store.project.midiMap.length > 0; };
    store.onChange(listen);
    ui.onChange(() => {
      listen();
      if (!ui.midiMapping) this.said = '';
    });
    listen();
  }

  /** Un messaggio MIDI: CC, nota accesa, nota spenta (gli altri non si mappano). */
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

  /** Con MIDI acceso: il controllo mosso per il bersaglio scelto. */
  private learn(control: MidiControl): void {
    const target = this.ui.midiTarget;
    if (!target) return this.tell(`MIDI: ${midiLabel(control)} è arrivato. Prima clicca una macro, un parametro o un controllo del mixer.`);
    this.run(() => {
      this.store.apply(setMidi(target, control));
      const others = midiTargetsOf(this.store.project.midiMap, control).length - 1;
      this.tell(`Mappato su ${midiLabel(control)}${others ? ` (muove anche ${others === 1 ? 'un altro controllo' : `altri ${others} controlli`})` : ''}. Canc lo toglie, Esc spegne MIDI.`,
        `${encodeMidiTarget(target)}=${controlKey(control)}`);
    });
  }

  private tell(text: string, what = text): void {
    if (what === this.said) return;
    this.said = what;
    this.say(text);
  }

  /** Con MIDI acceso: Esc lo spegne, Canc toglie il controllo al bersaglio scelto. */
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
    this.say('Controllo MIDI tolto.');
  }
}
