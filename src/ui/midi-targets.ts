/* The controls that can be mapped to MIDI carry their target in `data-midi-target`
 * (the macros and the parameters are marked by the device chain, the mixer marks them itself: see
 * mixer-controls). From here, for the whole page: with MIDI on a click on one of them
 * chooses it instead of moving it, and each shows the MIDI control moving it (`data-midi`). */
import { decodeMidiTarget, encodeMidiTarget, midiLabel, type MidiMap } from '../model/midi-map';
import { macroOf } from '../model/rack';
import type { ProjectStore } from '../store/project-store';
import type { UiState } from './ui-state';

/** With MIDI on these events on a mappable control don't reach the control. */
const BLOCKED = ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel'];

export class MidiTargets {
  /** The name of each target's MIDI control (for `data-midi-target`), from the map `labelsOf`. */
  private labels = new Map<string, string>();
  private labelsOf: MidiMap | null = null;
  private scheduled = false;
  /** Something is marked in the page (while it is, the new controls must be marked too). */
  private marked = false;

  constructor(private readonly store: ProjectStore, private readonly ui: UiState, private readonly say: (text: string) => void) {
    for (const type of BLOCKED) addEventListener(type, e => this.intercept(e), { capture: true, passive: false });
    store.onChange(() => this.schedule());
    ui.onChange(() => this.schedule());
    // the views redo their controls whenever they like: the new ones are marked at the next frame
    new MutationObserver(() => this.schedule()).observe(document.body, { childList: true, subtree: true });
    this.schedule();
  }

  private intercept(e: Event): void {
    if (!this.ui.midiMapping) return;
    const element = (e.target as Element | null)?.closest?.<HTMLElement>('[data-midi-target]');
    const target = element && decodeMidiTarget(element.dataset.midiTarget!);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type !== 'pointerdown') return;
    if (target.kind === 'param') {
      const found = macroOf(this.store.project.racksOf(target.owner), target.device, target.param);
      if (found) return this.say(`Macro ${found.index + 1} of the rack moves it: give the MIDI control to the macro.`);
    }
    this.ui.chooseMidiTarget(target);
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.sync();
    });
  }

  private sync(): void {
    const map = this.store.project.midiMap, mapping = this.ui.midiMapping;
    document.body.classList.toggle('midi-mapping', mapping);
    if (!map.length && !mapping && !this.marked) return;
    if (map !== this.labelsOf) {
      this.labelsOf = map;
      this.labels = new Map(map.map(m => [encodeMidiTarget(m.target), midiLabel(m.control)]));
    }
    const chosen = this.ui.midiTarget && encodeMidiTarget(this.ui.midiTarget);
    for (const e of document.querySelectorAll<HTMLElement>('[data-midi-target]')) {
      const key = e.dataset.midiTarget!, label = this.labels.get(key);
      if (label === undefined) {
        if (e.dataset.midi !== undefined) delete e.dataset.midi;
      } else if (e.dataset.midi !== label) e.dataset.midi = label;
      const on = key === chosen;
      if (e.classList.contains('midi-chosen') !== on) e.classList.toggle('midi-chosen', on);
    }
    this.marked = map.length > 0 || mapping;
  }
}
