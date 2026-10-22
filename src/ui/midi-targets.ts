/* I controlli che si possono mappare sul MIDI portano il loro bersaglio in `data-midi-target`
 * (le macro e i parametri li segna la catena dei dispositivi, il mixer li segna da sé: vedi
 * mixer-controls). Da qui, per tutta la pagina: con MIDI acceso un clic su uno di loro lo
 * sceglie invece di muoverlo, e ognuno mostra il controllo MIDI che lo muove (`data-midi`). */
import { decodeMidiTarget, encodeMidiTarget, midiLabel, type MidiMap } from '../model/midi-map';
import { macroOf } from '../model/rack';
import type { ProjectStore } from '../store/project-store';
import type { UiState } from './ui-state';

/** Con MIDI acceso questi eventi su un controllo mappabile non arrivano al controllo. */
const BLOCKED = ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel'];

export class MidiTargets {
  /** Il nome del controllo MIDI di ogni bersaglio (per `data-midi-target`), della mappa `labelsOf`. */
  private labels = new Map<string, string>();
  private labelsOf: MidiMap | null = null;
  private scheduled = false;
  /** Qualcosa è segnato nella pagina (finché sì, i controlli nuovi vanno segnati anche loro). */
  private marked = false;

  constructor(private readonly store: ProjectStore, private readonly ui: UiState, private readonly say: (text: string) => void) {
    for (const type of BLOCKED) addEventListener(type, e => this.intercept(e), { capture: true, passive: false });
    store.onChange(() => this.schedule());
    ui.onChange(() => this.schedule());
    // le viste rifanno i loro controlli quando vogliono: i nuovi si segnano al fotogramma dopo
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
      if (found) return this.say(`Lo muove la macro ${found.index + 1} del rack: dai il controllo MIDI alla macro.`);
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
