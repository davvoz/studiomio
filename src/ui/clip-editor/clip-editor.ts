import type { Beats, Seconds } from '../../core/music-time';
import type { PlaybackEngine } from '../../engine/playback-engine';
import { AudioClip } from '../../model/audio-clip';
import { sampleDuration, type SampleRef } from '../../model/sample';
import type { Clipboard } from '../../store/clipboard';
import { findClip, updateClipAt, type ClipRef } from '../../store/clip-ref';
import type { ProjectStore } from '../../store/project-store';
import { showContextMenu } from '../context-menu';
import type { DrawMode } from '../draw-mode';
import { addHeightHandle } from '../editor-height';
import { targetDevices, trackChain } from '../envelopes/mod-targets';
import { ModulationEditor } from '../envelopes/modulation-editor';
import { Surface } from '../kit/canvas';
import { pointerIn, type Pointer } from '../kit/pointer';
import { takeWheel, wheelBeats } from '../kit/wheel';
import type { UiState } from '../ui-state';
import type { PeakStore } from '../waveform';
import { BeatAxis, clipSpan, playheadIn, seekBeatOf } from './clip-geometry';
import { ClipPanel } from './clip-panel';
import { editorCursor, editorGestureFor, editorHit, type EditorGesture, type EditorHit, type EditorHost } from './editor-gestures';
import { editorMenu } from './editor-menu';
import { LAYOUT, paintEditor } from './editor-painter';
import { clipTransients, WarpCommands, type WarpTarget } from './warp-commands';

export interface ClipEditorDeps {
  readonly store: ProjectStore;
  readonly engine: PlaybackEngine;
  readonly peaks: PeakStore;
  /** Beats (in samples) following the given tempo: the DSP workers' beat tracking. */
  readonly trackBeats: (sample: SampleRef, bpm: number) => Promise<number[]>;
  /** The stretch [from, to] (seconds) of a sample as a new project file, loaded in the engine. */
  readonly cropSample: (sample: SampleRef, from: Seconds, to: Seconds) => Promise<SampleRef>;
  readonly say: (text: string) => void;
  /** The app's clipboard (for the modulation curves). */
  readonly clipboard: Clipboard;
  /** The app's draw mode (B), for the modulation lane. */
  readonly drawMode: DrawMode;
  /** For the grid chosen by the user. */
  readonly ui: UiState;
}

/** Editor of an audio clip (studiomio's WarpMio): waveform on the clip's beat axis,
 *  warp markers, region, loop and options panel. It changes the placed clip
 *  through the store, so every change can be undone and is heard in the timeline.
 *  This is the DOM: the commands are in `WarpCommands`, the menu in editor-menu, the gestures in editor-gestures. */
export class ClipEditor implements EditorHost {
  readonly element = Object.assign(document.createElement('section'), { className: 'clip-editor', hidden: true, tabIndex: -1 });
  private readonly surface = new Surface('editor-canvas');
  private readonly panel: ClipPanel;
  private readonly mods: ModulationEditor;
  private readonly commands: WarpCommands;
  private ref: ClipRef | null = null;
  private _axis = new BeatAxis();
  private selected = -1;
  private hover: Seconds | null = null;
  private gesture: EditorGesture | null = null;
  private dirty = true;
  private fitPending = false;

  /** The modulation row (to show a parameter from its menu). */
  get modulation(): ModulationEditor {
    return this.mods;
  }

  constructor(private readonly deps: ClipEditorDeps) {
    const commands = this.commands = new WarpCommands(deps, {
      target: () => this.target(),
      ref: () => this.ref,
      selected: () => this.selected,
      selectMarker: index => this.selectMarker(index),
      forgetMarker: () => { this.selected = -1; },
      commit: (label, fn) => this.commit(label, fn),
      grid: () => this.grid,
      refit: () => this.fit(),
    });
    this.panel = new ClipPanel({
      commit: (label, fn, mergeKey) => this.commit(label, fn, mergeKey),
      endMerge: () => deps.store.endMerge(),
      autoWarp: () => commands.autoWarp(),
      followTempo: () => void commands.followTempo(),
      quantize: () => commands.quantize(),
      crop: () => void commands.crop(),
      close: () => this.close(),
    });
    // the lane's axis is a property: read it through a function (no alias of this)
    const axis = () => this._axis;
    this.mods = new ModulationEditor({
      clipboard: deps.clipboard,
      get axis() { return axis(); },
      curves: () => this.clip(),
      span: () => { const c = this.clip(); return c && { start: c.region.start, end: c.loop.enabled ? c.loop.end : c.region.end }; },
      grid: () => this.grid,
      signature: () => deps.store.project.signature,
      playhead: () => { const t = this.target(); return t ? playheadIn(t.found, deps.engine) : null; },
      drawMode: deps.drawMode,
      commit: (label, target, points) => this.commit(label, c => c.withEnvelope(target, points) as AudioClip),
      wheel: (e, x) => this.setAxis(wheelBeats(this._axis, takeWheel(e), x)),
      devices: () => { const t = this.target()?.found.track ?? null; return t && targetDevices(t); },
      chain: () => { const t = this.target()?.found.track ?? null; return t && trackChain(t); },
      layout: visible => this.element.classList.toggle('with-lane', visible),
    });
    // right below name and info: the warp options are long and would hide it
    this.panel.element.children[1].after(this.mods.controls);
    const wrap = Object.assign(document.createElement('div'), { className: 'editor-canvas-wrap' });
    wrap.append(this.surface.canvas);
    this.element.append(this.panel.element, wrap, this.mods.lane.element);
    addHeightHandle(this.element);
    new ResizeObserver(() => {
      this.surface.resize(wrap.clientWidth, wrap.clientHeight);
      if (this.fitPending) this.fit();
      this.invalidate();
    }).observe(wrap);
    this.bind(this.surface.canvas);
    deps.store.onChange(() => this.sync());
    deps.ui.onGridChange(() => this.invalidate());
    requestAnimationFrame(this.frame);
  }

  get isOpen(): boolean {
    return this.ref !== null;
  }

  /** Opens the clip (on the timeline or in a slot); returns false if it isn't an audio clip. */
  open(ref: ClipRef): boolean {
    this.ref = ref;
    if (!this.target()) {
      this.ref = null;
      return false;
    }
    this.selected = -1;
    this.element.hidden = false;
    this.fitPending = true;
    this.fit();
    this.sync();
    this.mods.opened();
    this.element.focus();
    return true;
  }

  close(): void {
    this.ref = null;
    this.gesture = null;
    this.element.hidden = true;
  }

  // ---------------------------------------------------------------- EditorHost

  get axis(): BeatAxis {
    return this._axis;
  }

  clip(): AudioClip | null {
    return this.target()?.clip ?? null;
  }

  duration(): Seconds {
    const t = this.target();
    return t ? sampleDuration(t.sample) : 0;
  }

  /** The analysis's transients in the clip's seconds (mirrored if it's reversed). */
  transients(): readonly Seconds[] {
    const t = this.target();
    return t ? clipTransients(t) : [];
  }

  snapStep(p: Pointer): number | null {
    return p.alt ? null : this.grid;
  }

  commit(label: string, fn: (c: AudioClip) => AudioClip, mergeKey?: string): void {
    const ref = this.ref;
    if (!ref || !this.target()) return;
    try {
      this.deps.store.apply(updateClipAt<AudioClip>(label, ref, fn), { mergeKey });
    } catch (e) {
      this.deps.say(`${label}: ${e instanceof Error ? e.message : e}`);
    }
  }

  selectMarker(index: number): void {
    this.selected = index;
    this.sync();
  }

  seekContent(content: number): void {
    const t = this.target();
    const beat = t && seekBeatOf(t.found, content);
    if (beat !== null && beat !== undefined) this.deps.engine.seek(beat);
  }

  setAxis(axis: BeatAxis): void {
    this._axis = axis;
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
  }

  // ---------------------------------------------------------------- state

  private get grid(): Beats {
    return this.deps.ui.gridStep(this._axis.pxPerBeat, this.deps.store.project.signature, 10);
  }

  private target(): WarpTarget | null {
    const p = this.deps.store.project;
    const found = this.ref && findClip(p, this.ref);
    if (!found || !(found.clip instanceof AudioClip)) return null;
    const sample = p.sample(found.clip.sample);
    return sample ? { clip: found.clip, found, sample } : null;
  }

  /** Aligns panel and drawing with the project; closes if the clip no longer exists. */
  private sync(): void {
    if (!this.isOpen) return;
    const t = this.target();
    if (!t) return this.close();
    if (this.selected >= t.clip.warp.markers.length) this.selected = -1;
    this.panel.update(t.clip, t.sample, this.selected);
    this.mods.sync();
    this.invalidate();
  }

  /** Frames the sample and the region. */
  private fit(): void {
    const t = this.target();
    if (!t || this.surface.width < 10) return;
    const [b0, b1] = clipSpan(t.clip, sampleDuration(t.sample), this.deps.store.project.tempo);
    this._axis = BeatAxis.fit(b0, b1, this.surface.width);
    this.fitPending = false;
  }

  // ---------------------------------------------------------------- drawing and input

  private readonly frame = () => {
    const engine = this.deps.engine;
    if (this.isOpen && (this.dirty || engine.playing)) {
      this.dirty = false;
      const t = this.target();
      if (t) {
        const clip = this.gesture ? this.gesture.preview(t.clip) : t.clip;
        const { project } = this.deps.store;
        paintEditor({
          g: this.surface.g, width: this.surface.width, height: this.surface.height, axis: this._axis,
          clip, duration: sampleDuration(t.sample), transients: this.transients(),
          peaks: this.deps.peaks.get(t.sample.id, clip.reversed), tempo: project.tempo, signature: project.signature,
          grid: this.grid, selectedMarker: this.selected, hoverTransient: this.hover,
          playhead: playheadIn(t.found, engine),
        });
      }
    }
    if (this.isOpen) this.mods.frame();
    requestAnimationFrame(this.frame);
  };

  private hit(p: Pointer): { clip: AudioClip; hit: EditorHit } | null {
    const clip = this.clip();
    return clip ? { clip, hit: editorHit(this, clip, p.x, p.y) } : null;
  }

  private bind(el: HTMLCanvasElement): void {
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const p = pointerIn(e, el);
      const h = this.hit(p);
      if (!h) return;
      e.preventDefault();
      this.element.focus();
      el.setPointerCapture(e.pointerId);
      if (h.hit.kind !== 'marker' && h.hit.kind !== 'transient') this.selected = -1;
      const make = editorGestureFor[h.hit.kind] as (host: EditorHost, c: AudioClip, hit: EditorHit, p: Pointer) => EditorGesture;
      this.gesture = make(this, h.clip, h.hit, p);
      el.style.cursor = this.gesture.cursor;
      this.sync();
    });
    el.addEventListener('pointermove', e => {
      const p = pointerIn(e, el);
      if (this.gesture) return this.gesture.move(p);
      const h = this.hit(p);
      const hover = h?.hit.kind === 'transient' ? h.hit.t : null;
      if (hover !== this.hover) { this.hover = hover; this.invalidate(); }
      el.style.cursor = h ? (editorCursor[h.hit.kind] as (hit: EditorHit) => string)(h.hit) : 'default';
    });
    el.addEventListener('pointerup', e => {
      const g = this.gesture;
      this.gesture = null;
      g?.end(pointerIn(e, el));
      el.style.cursor = '';
      this.invalidate();
    });
    el.addEventListener('pointercancel', () => { this.gesture?.cancel(); this.gesture = null; });
    el.addEventListener('pointerleave', () => { if (this.hover !== null) { this.hover = null; this.invalidate(); } });
    // double click in the strip or on the waveform: a warp marker at that point
    el.addEventListener('dblclick', e => {
      const p = pointerIn(e, el);
      if (p.y >= LAYOUT.ruler) this.commands.addMarkerAt(this._axis.xToBeat(p.x));
    });
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (this.gesture) return;
      const p = pointerIn(e, el);
      const h = this.hit(p);
      if (!h) return;
      this.element.focus();
      if (h.hit.kind === 'marker') this.selectMarker(h.hit.index);
      showContextMenu(e.clientX, e.clientY, editorMenu(h.clip, h.hit, { y: p.y, beat: () => this._axis.xToBeat(p.x) }, this.commands));
    });
    // as on its modulation lane: Ctrl zooms, otherwise it scrolls the time (Shift+wheel on Windows comes as deltaX)
    el.addEventListener('wheel', e => this.setAxis(wheelBeats(this._axis, takeWheel(e), pointerIn(e, el).x)), { passive: false });
    // the editor's keys: they take priority over the timeline's
    this.element.addEventListener('keydown', e => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected >= 0) {
        e.stopPropagation();
        e.preventDefault();
        this.commands.deleteMarker();
      }
    });
  }
}
