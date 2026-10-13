import type { PlacementId, TrackId } from '../../core/id';
import type { Seconds } from '../../core/music-time';
import type { PlaybackEngine } from '../../engine/playback-engine';
import type { Placement } from '../../model/arrangement';
import { AudioClip } from '../../model/audio-clip';
import { sampleDuration, type SampleRef } from '../../model/sample';
import { autoWarp, followTempo } from '../../model/warp-tools';
import { updateClip } from '../../store/edits';
import type { ProjectStore } from '../../store/project-store';
import { Surface } from '../surface';
import type { Pointer } from '../timeline/gestures';
import { gridStep } from '../timeline/geometry';
import type { PeakStore } from '../waveform';
import { BeatAxis, contentBeatAt, timelineBeatOf } from './clip-geometry';
import { ClipPanel } from './clip-panel';
import { editorCursor, editorGestureFor, editorHit, type EditorGesture, type EditorHit, type EditorHost } from './editor-gestures';
import { LAYOUT, paintEditor } from './editor-painter';

export interface ClipEditorDeps {
  readonly store: ProjectStore;
  readonly engine: PlaybackEngine;
  readonly peaks: PeakStore;
  /** Battiti (in campioni) seguendo il tempo dato: il beat tracking dei worker DSP. */
  readonly trackBeats: (sample: SampleRef, bpm: number) => Promise<number[]>;
  readonly say: (text: string) => void;
}

interface Target {
  readonly track: TrackId;
  readonly placement: Placement<AudioClip>;
  readonly sample: SampleRef;
}

/** Editor di una clip audio (il WarpMio di studiomio): forma d'onda sull'asse dei battiti
 *  della clip, warp marker, regione, loop e pannello delle opzioni. Modifica la clip posata
 *  attraverso lo store, quindi ogni modifica si annulla e si sente nella timeline. */
export class ClipEditor implements EditorHost {
  readonly element = Object.assign(document.createElement('section'), { className: 'clip-editor', hidden: true, tabIndex: -1 });
  private readonly surface = new Surface('editor-canvas');
  private readonly panel: ClipPanel;
  private placementId: PlacementId | null = null;
  private _axis = new BeatAxis();
  private selected = -1;
  private hover: Seconds | null = null;
  private gesture: EditorGesture | null = null;
  private dirty = true;
  private fitPending = false;

  constructor(private readonly deps: ClipEditorDeps) {
    this.panel = new ClipPanel({
      commit: (label, fn) => this.commit(label, fn),
      autoWarp: () => this.autoWarp(),
      followTempo: () => void this.followTempo(),
      quantize: () => this.quantize(),
      close: () => this.close(),
    });
    const wrap = Object.assign(document.createElement('div'), { className: 'editor-canvas-wrap' });
    wrap.append(this.surface.canvas);
    this.element.append(this.panel.element, wrap);
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
    return this.placementId !== null;
  }

  /** Apre la clip posata `id`; restituisce false se non è una clip audio. */
  open(id: PlacementId): boolean {
    this.placementId = id;
    if (!this.target()) {
      this.placementId = null;
      return false;
    }
    this.selected = -1;
    this.element.hidden = false;
    this.fitPending = true;
    this.fit();
    this.sync();
    this.element.focus();
    return true;
  }

  close(): void {
    this.placementId = null;
    this.gesture = null;
    this.element.hidden = true;
  }

  // ---------------------------------------------------------------- EditorHost

  get axis(): BeatAxis {
    return this._axis;
  }

  clip(): AudioClip | null {
    return this.target()?.placement.clip ?? null;
  }

  duration(): Seconds {
    const t = this.target();
    return t ? sampleDuration(t.sample) : 0;
  }

  transients(): readonly Seconds[] {
    return this.target()?.sample.analysis?.transients ?? [];
  }

  snapStep(p: Pointer): number | null {
    return p.alt ? null : gridStep(this._axis.pxPerBeat, this.deps.store.project.signature, 10);
  }

  commit(label: string, fn: (c: AudioClip) => AudioClip): void {
    const t = this.target();
    if (!t) return;
    try {
      this.deps.store.apply(updateClip<AudioClip>(label, t.track, t.placement.id, fn));
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
    const beat = t && timelineBeatOf(t.placement, content);
    if (beat !== null && beat !== undefined) this.deps.engine.seek(beat);
  }

  setAxis(axis: BeatAxis): void {
    this._axis = axis;
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
  }

  // ---------------------------------------------------------------- comandi

  private autoWarp(): void {
    const t = this.target();
    const a = t?.sample.analysis;
    if (!t || !a) return this.deps.say('Il sample non è stato analizzato.');
    this.commit('Auto-Warp', c => c.withMarkers(autoWarp(a.tempo, a.transients, sampleDuration(t.sample))).withWarp({ enabled: true }));
    this.deps.say(`Auto-Warp: ${a.tempo.toFixed(2)} BPM.`);
  }

  private async followTempo(): Promise<void> {
    const t = this.target();
    const a = t?.sample.analysis;
    if (!t || !a) return this.deps.say('Il sample non è stato analizzato.');
    const sr = t.sample.sampleRate;
    const beats = (await this.deps.trackBeats(t.sample, a.tempo)).map(i => i / sr);
    const markers = followTempo(beats, a.transients, a.tempo, sampleDuration(t.sample), this.deps.store.project.signature.beatsPerBar);
    if (!markers) return this.deps.say('Non ho trovato abbastanza battiti: prova Auto-Warp.');
    this.commit('Segui tempo', c => c.withMarkers(markers).withWarp({ enabled: true }));
    this.deps.say(`Segui tempo: ${markers.length} marker.`);
  }

  private quantize(): void {
    const step = Math.min(1, gridStep(this._axis.pxPerBeat, this.deps.store.project.signature, 10));
    this.commit('Quantizza warp marker', c => c.withMarkers(c.warp.markers.quantized(step)));
  }

  // ---------------------------------------------------------------- stato

  private target(): Target | null {
    if (!this.placementId) return null;
    const p = this.deps.store.project;
    for (const t of p.tracks) {
      const pl = t.placement(this.placementId);
      if (pl && pl.clip instanceof AudioClip) {
        const sample = p.sample(pl.clip.sample);
        return sample ? { track: t.id, placement: pl as Placement<AudioClip>, sample } : null;
      }
    }
    return null;
  }

  /** Allinea pannello e disegno al progetto; chiude se la clip non esiste più. */
  private sync(): void {
    if (!this.isOpen) return;
    const t = this.target();
    if (!t) return this.close();
    if (this.selected >= t.placement.clip.warp.markers.length) this.selected = -1;
    this.panel.update(t.placement.clip, t.sample, this.selected);
    this.invalidate();
  }

  /** Inquadra il sample e la regione. */
  private fit(): void {
    const t = this.target();
    if (!t || this.surface.width < 10) return;
    const c = t.placement.clip, m = c.warp.markers, d = sampleDuration(t.sample);
    const b0 = Math.min(c.region.start, c.warp.enabled ? m.beatOf(0) : 0);
    const b1 = Math.max(c.region.end, c.warp.enabled ? m.beatOf(d) : this.deps.store.project.tempo.beatAt(d));
    this._axis = BeatAxis.fit(b0, b1, this.surface.width);
    this.fitPending = false;
  }

  // ---------------------------------------------------------------- disegno e input

  private readonly frame = () => {
    const engine = this.deps.engine;
    if (this.isOpen && (this.dirty || engine.playing)) {
      this.dirty = false;
      const t = this.target();
      if (t) {
        const clip = this.gesture ? this.gesture.preview(t.placement.clip) : t.placement.clip;
        const { project } = this.deps.store;
        paintEditor({
          g: this.surface.g, width: this.surface.width, height: this.surface.height, axis: this._axis,
          clip, duration: sampleDuration(t.sample), transients: this.transients(),
          peaks: this.deps.peaks.get(t.sample.id), tempo: project.tempo, signature: project.signature,
          grid: gridStep(this._axis.pxPerBeat, project.signature, 10), selectedMarker: this.selected, hoverTransient: this.hover,
          playhead: engine.playing ? contentBeatAt(t.placement, engine.position) : null,
        });
      }
    }
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
      el.style.cursor = h ? editorCursor[h.hit.kind] : 'default';
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
    // doppio clic nella striscia o sulla forma d'onda: un warp marker in quel punto
    el.addEventListener('dblclick', e => {
      const p = this.pointer(e, el);
      const clip = this.clip();
      if (!clip?.warp.enabled || p.y < LAYOUT.ruler) return;
      const t = clip.warp.markers.timeOf(this._axis.xToBeat(p.x));
      if (t < 0 || t > this.duration()) return;
      const { markers, index } = clip.warp.markers.withMarkerAt(t);
      if (markers !== clip.warp.markers) this.commit('Aggiungi warp marker', c => c.withMarkers(markers));
      this.selectMarker(index);
    });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const a = this._axis, x = this.pointer(e, el).x;
      if (e.ctrlKey || e.metaKey) this.setAxis(a.zoomed(a.pxPerBeat * Math.exp(-e.deltaY * 0.0025), x));
      else this.setAxis(a.scrolled(a.startBeat + (e.shiftKey || !e.deltaX ? e.deltaY : e.deltaX) / a.pxPerBeat));
    }, { passive: false });
    // tasti dell'editor: hanno la precedenza su quelli della timeline
    this.element.addEventListener('keydown', e => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected >= 0) {
        e.stopPropagation();
        e.preventDefault();
        const i = this.selected;
        const clip = this.clip();
        if (clip && clip.warp.markers.canRemove(i)) {
          this.selected = -1;
          this.commit('Elimina warp marker', c => c.withMarkers(c.warp.markers.without(i)));
        } else this.deps.say('Servono almeno due warp marker: usa "Azzera" per ripartire da un tempo costante.');
      }
    });
  }
}
