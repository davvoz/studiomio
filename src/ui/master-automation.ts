/* The master's automation on the timeline, like Live's automation lanes: a row under
 * the master's, on the left the menus (one of its effects or racks, a parameter or a macro), on
 * the right the lane with the curve, aligned with the timeline and with its zoom. It opens with the
 * master's "A" button; it has a dot when the master has curves. */
import type { PlaybackEngine } from '../engine/playback-engine';
import type { ModTarget } from '../model/envelope';
import type { Project } from '../model/project';
import type { Clipboard } from '../store/clipboard';
import { setMasterAutomation } from '../store/edits';
import type { ProjectStore } from '../store/project-store';
import { BeatAxis } from './clip-editor/clip-geometry';
import { el } from './dom';
import type { LaneCurves } from './envelopes/envelope-lane';
import { masterChain, masterTargetDevices } from './envelopes/mod-targets';
import { ModulationEditor } from './envelopes/modulation-editor';
import { gridStep, type TimelineGeometry } from './timeline/geometry';
import type { UiState } from './ui-state';

/** The colour of the master's curves (orange already belongs to the playhead). */
const MASTER_CURVE = '#5ec8e5';

export class MasterAutomation {
  readonly header = el('div', { className: 'master-auto-header', hidden: true });
  readonly lane = el('div', { className: 'master-auto-lane', hidden: true });
  readonly button: HTMLButtonElement;
  private readonly hint = el('div', { className: 'master-auto-hint' });
  private readonly editor: ModulationEditor;
  private axisOf: { geo: TimelineGeometry; axis: BeatAxis } | null = null;
  private curvesOf: { project: Project; curves: LaneCurves } | null = null;

  constructor(private readonly store: ProjectStore, private readonly ui: UiState, private readonly engine: PlaybackEngine, clipboard: Clipboard) {
    const self = this;
    this.editor = new ModulationEditor({
      get axis() { return self.axis(); },
      clipboard,
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
    }, 'Automation');
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

  /** Opens the lane on parameter `target`. */
  show(target: ModTarget): boolean {
    this.toggle(true);
    return this.editor.show(target);
  }

  /** The lane's axis: the timeline's (the same object until it moves). */
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

  /** The wheel on the lane moves the timeline: Ctrl zooms, otherwise it scrolls horizontally. */
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
    this.button.title = `Master automation: curves on the timeline for its effects and the macros of its racks${n ? ` (${n === 1 ? '1 curve' : `${n} curves`})` : ''}`;
    this.hint.textContent = p.masterEffects.length
      ? 'Choose a master effect and a parameter on the left: here you draw its curve on the timeline'
      : 'Add an effect to the master (FX or right click) to automate its parameters';
    if (this.isOpen) this.editor.sync();
  }
}
