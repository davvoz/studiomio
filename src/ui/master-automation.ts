/* L'automazione del master sulla timeline, come le corsie di automazione di Live: una riga sotto
 * quella del master, a sinistra i menu (un suo effetto o rack, un parametro o una macro), a
 * destra la corsia con la curva, allineata alla timeline e con il suo zoom. Si apre con il
 * pulsante "A" del master; ha un pallino quando il master ha delle curve. */
import type { PlaybackEngine } from '../engine/playback-engine';
import type { Project } from '../model/project';
import { setMasterAutomation } from '../store/edits';
import type { ProjectStore } from '../store/project-store';
import { BeatAxis } from './clip-editor/clip-geometry';
import { el } from './dom';
import type { LaneCurves } from './envelopes/envelope-lane';
import { masterChain, masterTargetDevices } from './envelopes/mod-targets';
import { ModulationEditor } from './envelopes/modulation-editor';
import { gridStep, type TimelineGeometry } from './timeline/geometry';
import type { UiState } from './ui-state';

/** Il colore delle curve del master (l'arancione è già della testina). */
const MASTER_CURVE = '#5ec8e5';

export class MasterAutomation {
  readonly header = el('div', { className: 'master-auto-header', hidden: true });
  readonly lane = el('div', { className: 'master-auto-lane', hidden: true });
  readonly button: HTMLButtonElement;
  private readonly hint = el('div', { className: 'master-auto-hint' });
  private readonly editor: ModulationEditor;
  private axisOf: { geo: TimelineGeometry; axis: BeatAxis } | null = null;
  private curvesOf: { project: Project; curves: LaneCurves } | null = null;

  constructor(private readonly store: ProjectStore, private readonly ui: UiState, private readonly engine: PlaybackEngine) {
    const self = this;
    this.editor = new ModulationEditor({
      get axis() { return self.axis(); },
      curves: () => this.curves(),
      grid: () => gridStep(ui.geometry.pxPerBeat, store.project.signature),
      signature: () => store.project.signature,
      playhead: () => engine.position,
      commit: (_label, target, points) => {
        if (engine.playing) ui.pauseFollow();
        store.apply(setMasterAutomation(target, points));
      },
      wheel: (e, x) => this.wheel(e, x),
      chain: () => masterChain(store.project),
      devices: () => masterTargetDevices(store.project),
      layout: visible => { this.hint.hidden = visible; },
    }, 'Automazione');
    this.button = el<HTMLButtonElement>('button', { className: 'auto', textContent: 'A', onclick: () => this.toggle() });
    this.header.append(this.editor.controls);
    this.lane.append(this.editor.lane.element, this.hint);
    store.onChange(() => this.sync());
    this.sync();
    const frame = () => {
      if (this.isOpen) this.editor.frame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  get isOpen(): boolean {
    return !this.lane.hidden;
  }

  toggle(open = !this.isOpen): void {
    this.header.hidden = this.lane.hidden = !open;
    if (open) this.editor.opened();
    this.sync();
  }

  /** L'asse della corsia: quello della timeline (lo stesso oggetto finché non si muove). */
  private axis(): BeatAxis {
    const geo = this.ui.geometry;
    if (this.axisOf?.geo !== geo) this.axisOf = { geo, axis: new BeatAxis(geo.pxPerBeat, geo.scrollBeat) };
    return this.axisOf.axis;
  }

  private curves(): LaneCurves {
    const project = this.store.project;
    if (this.curvesOf?.project !== project) {
      this.curvesOf = {
        project,
        curves: { color: MASTER_CURVE, envelopes: project.masterAutomation, envelope: t => project.masterCurve(t) },
      };
    }
    return this.curvesOf.curves;
  }

  /** La rotella sulla corsia muove la timeline: Ctrl zooma, altrimenti scorre in orizzontale. */
  private wheel(e: WheelEvent, x: number): void {
    e.preventDefault();
    const g = this.ui.geometry;
    if (this.engine.playing) this.ui.pauseFollow();
    if (e.ctrlKey || e.metaKey) this.ui.setGeometry(g.zoomed(g.pxPerBeat * Math.exp(-e.deltaY * 0.0025), x));
    else this.ui.setGeometry(g.scrolled(g.scrollBeat + (e.deltaX || e.deltaY) / g.pxPerBeat, g.scrollY));
  }

  private sync(): void {
    const p = this.store.project, n = p.masterAutomation.length;
    this.button.classList.toggle('on', this.isOpen);
    this.button.classList.toggle('has', n > 0);
    this.button.title = `Automazione del master: curve sulla timeline per i suoi effetti e le macro dei suoi rack${n ? ` (${n === 1 ? '1 curva' : `${n} curve`})` : ''}`;
    this.hint.textContent = p.masterEffects.length
      ? 'Scegli a sinistra un effetto del master e un parametro: qui ne disegni la curva sulla timeline'
      : 'Aggiungi un effetto al master (FX o tasto destro) per automatizzarne i parametri';
    if (this.isOpen) this.editor.sync();
  }
}
