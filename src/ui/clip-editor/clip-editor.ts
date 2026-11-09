import type { Seconds } from '../../core/music-time';
import type { PlaybackEngine } from '../../engine/playback-engine';
import { AudioClip, clipTimes } from '../../model/audio-clip';
import { sampleDuration, type SampleRef } from '../../model/sample';
import { autoWarp, followTempo } from '../../model/warp-tools';
import { cropClipAt, findClip, updateClipAt, type ClipRef, type FoundClip } from '../../store/clip-ref';
import type { ProjectStore } from '../../store/project-store';
import { KEY, SEPARATOR, showContextMenu, type MenuItem } from '../context-menu';
import { addHeightHandle } from '../editor-height';
import { Surface } from '../surface';
import type { Pointer } from '../timeline/gestures';
import { gridStep } from '../timeline/geometry';
import type { PeakStore } from '../waveform';
import { BeatAxis, playheadIn, seekBeatOf } from './clip-geometry';
import { ClipPanel } from './clip-panel';
import { editorCursor, editorGestureFor, editorHit, type EditorGesture, type EditorHit, type EditorHost } from './editor-gestures';
import { LAYOUT, paintEditor } from './editor-painter';
import { wheelTime } from '../envelopes/envelope-lane';
import { ModulationEditor } from '../envelopes/modulation-editor';
import { targetDevices, trackChain } from '../envelopes/mod-targets';
import type { Clipboard } from '../../store/clipboard';

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
}

interface Target {
  readonly clip: AudioClip;
  readonly found: FoundClip;
  readonly sample: SampleRef;
}

/** Editor of an audio clip (studiomio's WarpMio): waveform on the clip's beat axis,
 *  warp markers, region, loop and options panel. It changes the placed clip
 *  through the store, so every change can be undone and is heard in the timeline. */
export class ClipEditor implements EditorHost {
  readonly element = Object.assign(document.createElement('section'), { className: 'clip-editor', hidden: true, tabIndex: -1 });
  private readonly surface = new Surface('editor-canvas');
  private readonly panel: ClipPanel;
  private readonly mods: ModulationEditor;
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
    this.panel = new ClipPanel({
      commit: (label, fn, mergeKey) => this.commit(label, fn, mergeKey),
      endMerge: () => deps.store.endMerge(),
      autoWarp: () => this.autoWarp(),
      followTempo: () => void this.followTempo(),
      quantize: () => this.quantize(),
      crop: () => void this.crop(),
      close: () => this.close(),
    });
    const editor = this;
    this.mods = new ModulationEditor({
      clipboard: deps.clipboard,
      get axis() { return editor._axis; },
      curves: () => editor.clip(),
      span: () => { const c = editor.clip(); return c && { start: c.region.start, end: c.loop.enabled ? c.loop.end : c.region.end }; },
      grid: () => gridStep(editor._axis.pxPerBeat, deps.store.project.signature, 10),
      signature: () => deps.store.project.signature,
      playhead: () => { const t = editor.target(); return t ? playheadIn(t.found, deps.engine) : null; },
      commit: (label, target, points) => editor.commit(label, c => c.withEnvelope(target, points) as AudioClip),
      wheel: (e, x) => editor.setAxis(wheelTime(e, x, editor._axis)),
      devices: () => { const t = editor.target()?.found.track ?? null; return t && targetDevices(t); },
      chain: () => { const t = editor.target()?.found.track ?? null; return t && trackChain(t); },
      layout: visible => editor.element.classList.toggle('with-lane', visible),
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
    return t ? clipTimes(t.clip, t.sample.analysis?.transients ?? [], sampleDuration(t.sample)) : [];
  }

  snapStep(p: Pointer): number | null {
    return p.alt ? null : gridStep(this._axis.pxPerBeat, this.deps.store.project.signature, 10);
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

  // ---------------------------------------------------------------- commands

  private autoWarp(): void {
    const t = this.target();
    const a = t?.sample.analysis;
    if (!t || !a) return this.deps.say('The sample hasn\'t been analysed.');
    this.commit('Auto-Warp', c => c.withMarkers(autoWarp(a.tempo, this.transients(), sampleDuration(t.sample))).withWarp({ enabled: true }));
    this.deps.say(`Auto-Warp: ${a.tempo.toFixed(2)} BPM.`);
  }

  private async followTempo(): Promise<void> {
    const t = this.target();
    const a = t?.sample.analysis;
    if (!t || !a) return this.deps.say('The sample hasn\'t been analysed.');
    const sr = t.sample.sampleRate, duration = sampleDuration(t.sample);
    const beats = clipTimes(t.clip, (await this.deps.trackBeats(t.sample, a.tempo)).map(i => i / sr), duration);
    const markers = followTempo(beats, clipTimes(t.clip, a.transients, duration), a.tempo, duration, this.deps.store.project.signature.beatsPerBar);
    if (!markers) return this.deps.say('Couldn\'t find enough beats: try Auto-Warp.');
    this.commit('Follow tempo', c => c.withMarkers(markers).withWarp({ enabled: true }));
    this.deps.say(`Follow tempo: ${markers.length} markers.`);
  }

  private quantize(): void {
    const step = Math.min(1, gridStep(this._axis.pxPerBeat, this.deps.store.project.signature, 10));
    this.commit('Quantize warp markers', c => c.withMarkers(c.warp.markers.quantized(step)));
  }

  /** Crop: the loop (or the region) becomes a file of its own and the clip plays only that. */
  private async crop(): Promise<void> {
    const t = this.target(), ref = this.ref;
    if (!t || !ref) return;
    const crop = t.clip.cropped(sampleDuration(t.sample), this.deps.store.project.tempo);
    if (!crop) return this.deps.say('Crop: the part to keep is outside the sample.');
    try {
      const sample = await this.deps.cropSample(t.sample, crop.fileStart, crop.fileEnd);
      // the new file is ready meanwhile, but the clip may have changed (or disappeared) in the meantime
      if (findClip(this.deps.store.project, ref)?.clip !== t.clip) return this.deps.say('Crop cancelled: the clip changed in the meantime.');
      this.deps.store.apply(cropClipAt(ref, sample, crop.clip(sample.id)));
      this.selected = -1;
      if (this.ref === ref) this.fit();
      this.deps.say(`Crop: ${(crop.fileEnd - crop.fileStart).toFixed(2)} s in "${sample.name}".`);
    } catch (e) {
      this.deps.say(`Crop: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ---------------------------------------------------------------- state

  private target(): Target | null {
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
    const c = t.clip, m = c.warp.markers, d = sampleDuration(t.sample);
    const b0 = Math.min(c.region.start, c.warp.enabled ? m.beatOf(0) : 0);
    const b1 = Math.max(c.region.end, c.warp.enabled ? m.beatOf(d) : this.deps.store.project.tempo.beatAt(d));
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
          grid: gridStep(this._axis.pxPerBeat, project.signature, 10), selectedMarker: this.selected, hoverTransient: this.hover,
          playhead: playheadIn(t.found, engine),
        });
      }
    }
    if (this.isOpen) this.mods.frame();
    requestAnimationFrame(this.frame);
  };

  private pointer(e: MouseEvent, el: HTMLElement): Pointer {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey };
  }

  private hit(p: Pointer): { clip: AudioClip; hit: EditorHit } | null {
    const clip = this.clip();
    return clip ? { clip, hit: editorHit(this, clip, p.x, p.y) } : null;
  }

  private bind(el: HTMLCanvasElement): void {
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const p = this.pointer(e, el);
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
      const p = this.pointer(e, el);
      if (this.gesture) return this.gesture.move(p);
      const h = this.hit(p);
      const hover = h?.hit.kind === 'transient' ? h.hit.t : null;
      if (hover !== this.hover) { this.hover = hover; this.invalidate(); }
      el.style.cursor = h ? (editorCursor[h.hit.kind] as (hit: EditorHit) => string)(h.hit) : 'default';
    });
    el.addEventListener('pointerup', e => {
      const g = this.gesture;
      this.gesture = null;
      g?.end(this.pointer(e, el));
      el.style.cursor = '';
      this.invalidate();
    });
    el.addEventListener('pointercancel', () => { this.gesture?.cancel(); this.gesture = null; });
    el.addEventListener('pointerleave', () => { if (this.hover !== null) { this.hover = null; this.invalidate(); } });
    // double click in the strip or on the waveform: a warp marker at that point
    el.addEventListener('dblclick', e => {
      const p = this.pointer(e, el);
      if (p.y >= LAYOUT.ruler) this.addMarkerAt(p.x);
    });
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (this.gesture) return;
      const p = this.pointer(e, el);
      const h = this.hit(p);
      if (!h) return;
      this.element.focus();
      if (h.hit.kind === 'marker') this.selectMarker(h.hit.index);
      showContextMenu(e.clientX, e.clientY, this.menu(h.clip, h.hit, p));
    });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const a = this._axis, x = this.pointer(e, el).x;
      if (e.ctrlKey || e.metaKey) this.setAxis(a.zoomed(a.pxPerBeat * Math.exp(-e.deltaY * 0.0025), x));
      else this.setAxis(a.scrolled(a.startBeat + (e.shiftKey || !e.deltaX ? e.deltaY : e.deltaX) / a.pxPerBeat));
    }, { passive: false });
    // the editor's keys: they take priority over the timeline's
    this.element.addEventListener('keydown', e => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected >= 0) {
        e.stopPropagation();
        e.preventDefault();
        this.deleteSelectedMarker();
      }
    });
  }

  private deleteSelectedMarker(): void {
    const i = this.selected;
    const clip = this.clip();
    if (clip && i >= 0 && clip.warp.markers.canRemove(i)) {
      this.selected = -1;
      this.commit('Delete warp marker', c => c.withMarkers(c.warp.markers.without(i)));
    } else this.deps.say('At least two warp markers are needed: use "Reset" to restart from a constant tempo.');
  }

  /** A warp marker at point x (if warp is active and x falls in the sample). */
  private addMarkerAt(x: number): void {
    const clip = this.clip();
    if (!clip?.warp.enabled) return;
    const t = clip.warp.markers.timeOf(this._axis.xToBeat(x));
    if (t < 0 || t > this.duration()) return;
    const { markers, index } = clip.warp.markers.withMarkerAt(t);
    if (markers !== clip.warp.markers) this.commit('Add warp marker', c => c.withMarkers(markers));
    this.selectMarker(index);
  }

  private menu(clip: AudioClip, hit: EditorHit, p: Pointer): MenuItem[] {
    const warp = clip.warp.enabled;
    const tools: MenuItem[] = [
      { label: 'Auto-Warp', disabled: !this.target()?.sample.analysis, run: () => this.autoWarp() },
      { label: 'Follow tempo', disabled: !this.target()?.sample.analysis, run: () => void this.followTempo() },
      { label: 'Quantize the warp markers', disabled: !warp, run: () => this.quantize() },
      { label: 'Reset the warp markers', disabled: !warp, run: () => this.commit('Reset warp markers', c => c.withMarkers(c.warp.markers.cleared(this.duration()))) },
      SEPARATOR,
      { label: warp ? 'Turn warp off' : 'Turn warp on', run: () => this.commit(warp ? 'Warp off' : 'Warp on', c => c.withWarp({ enabled: !warp })) },
      { label: clip.reversed ? 'Remove reverse' : 'Reverse', run: () => this.commit(clip.reversed ? 'Reverse off' : 'Reverse', c => c.withReversed(!clip.reversed, this.duration())) },
      { label: clip.loop.enabled ? 'Crop to loop' : 'Crop to region', run: () => void this.crop() },
    ];
    if (hit.kind === 'marker') {
      const i = hit.index;
      return [
        { label: '1.1.1 here', run: () => this.commit('Set 1.1.1', c => c.withMarkers(c.warp.markers.withOrigin(c.warp.markers.markers[i].t))) },
        { label: 'Delete warp marker', shortcut: KEY.delete, disabled: !clip.warp.markers.canRemove(i), run: () => this.deleteSelectedMarker() },
        SEPARATOR,
        ...tools,
      ];
    }
    const here: MenuItem[] = p.y >= LAYOUT.ruler && warp ? [{ label: 'Add warp marker here', shortcut: 'double click', run: () => this.addMarkerAt(p.x) }, SEPARATOR] : [];
    return [...here, ...tools];
  }
}
