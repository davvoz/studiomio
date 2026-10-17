import type { Seconds } from '../../core/music-time';
import type { PlaybackEngine } from '../../engine/playback-engine';
import { AudioClip, clipTimes } from '../../model/audio-clip';
import { sampleDuration, type SampleRef } from '../../model/sample';
import { autoWarp, followTempo } from '../../model/warp-tools';
import { findClip, updateClipAt, type ClipRef, type FoundClip } from '../../store/clip-ref';
import type { ProjectStore } from '../../store/project-store';
import { KEY, SEPARATOR, showContextMenu, type MenuItem } from '../context-menu';
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

export interface ClipEditorDeps {
  readonly store: ProjectStore;
  readonly engine: PlaybackEngine;
  readonly peaks: PeakStore;
  /** Battiti (in campioni) seguendo il tempo dato: il beat tracking dei worker DSP. */
  readonly trackBeats: (sample: SampleRef, bpm: number) => Promise<number[]>;
  readonly say: (text: string) => void;
}

interface Target {
  readonly clip: AudioClip;
  readonly found: FoundClip;
  readonly sample: SampleRef;
}

/** Editor di una clip audio (il WarpMio di studiomio): forma d'onda sull'asse dei battiti
 *  della clip, warp marker, regione, loop e pannello delle opzioni. Modifica la clip posata
 *  attraverso lo store, quindi ogni modifica si annulla e si sente nella timeline. */
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

  constructor(private readonly deps: ClipEditorDeps) {
    this.panel = new ClipPanel({
      commit: (label, fn, mergeKey) => this.commit(label, fn, mergeKey),
      endMerge: () => deps.store.endMerge(),
      autoWarp: () => this.autoWarp(),
      followTempo: () => void this.followTempo(),
      quantize: () => this.quantize(),
      close: () => this.close(),
    });
    const editor = this;
    this.mods = new ModulationEditor({
      get axis() { return editor._axis; },
      clip: () => editor.clip(),
      grid: () => gridStep(editor._axis.pxPerBeat, deps.store.project.signature, 10),
      signature: () => deps.store.project.signature,
      playhead: () => { const t = editor.target(); return t ? playheadIn(t.found, deps.engine) : null; },
      commit: (label, fn) => editor.commit(label, c => fn(c) as AudioClip),
      wheel: (e, x) => editor.setAxis(wheelTime(e, x, editor._axis)),
      track: () => editor.target()?.found.track ?? null,
      layout: visible => editor.element.classList.toggle('with-lane', visible),
    });
    // subito sotto nome e informazioni: le opzioni del warp sono lunghe e lo nasconderebbero
    this.panel.element.children[1].after(this.mods.controls);
    const wrap = Object.assign(document.createElement('div'), { className: 'editor-canvas-wrap' });
    wrap.append(this.surface.canvas);
    this.element.append(this.panel.element, wrap, this.mods.lane.element);
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

  /** Apre la clip (sulla timeline o in uno slot); restituisce false se non è una clip audio. */
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

  /** I transienti dell'analisi nei secondi della clip (specchiati se è al contrario). */
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

  // ---------------------------------------------------------------- comandi

  private autoWarp(): void {
    const t = this.target();
    const a = t?.sample.analysis;
    if (!t || !a) return this.deps.say('Il sample non è stato analizzato.');
    this.commit('Auto-Warp', c => c.withMarkers(autoWarp(a.tempo, this.transients(), sampleDuration(t.sample))).withWarp({ enabled: true }));
    this.deps.say(`Auto-Warp: ${a.tempo.toFixed(2)} BPM.`);
  }

  private async followTempo(): Promise<void> {
    const t = this.target();
    const a = t?.sample.analysis;
    if (!t || !a) return this.deps.say('Il sample non è stato analizzato.');
    const sr = t.sample.sampleRate, duration = sampleDuration(t.sample);
    const beats = clipTimes(t.clip, (await this.deps.trackBeats(t.sample, a.tempo)).map(i => i / sr), duration);
    const markers = followTempo(beats, clipTimes(t.clip, a.transients, duration), a.tempo, duration, this.deps.store.project.signature.beatsPerBar);
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
    const p = this.deps.store.project;
    const found = this.ref && findClip(p, this.ref);
    if (!found || !(found.clip instanceof AudioClip)) return null;
    const sample = p.sample(found.clip.sample);
    return sample ? { clip: found.clip, found, sample } : null;
  }

  /** Allinea pannello e disegno al progetto; chiude se la clip non esiste più. */
  private sync(): void {
    if (!this.isOpen) return;
    const t = this.target();
    if (!t) return this.close();
    if (this.selected >= t.clip.warp.markers.length) this.selected = -1;
    this.panel.update(t.clip, t.sample, this.selected);
    this.mods.sync();
    this.invalidate();
  }

  /** Inquadra il sample e la regione. */
  private fit(): void {
    const t = this.target();
    if (!t || this.surface.width < 10) return;
    const c = t.clip, m = c.warp.markers, d = sampleDuration(t.sample);
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
    // doppio clic nella striscia o sulla forma d'onda: un warp marker in quel punto
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
    // tasti dell'editor: hanno la precedenza su quelli della timeline
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
      this.commit('Elimina warp marker', c => c.withMarkers(c.warp.markers.without(i)));
    } else this.deps.say('Servono almeno due warp marker: usa "Azzera" per ripartire da un tempo costante.');
  }

  /** Un warp marker nel punto x (se il warp è attivo e x cade nel sample). */
  private addMarkerAt(x: number): void {
    const clip = this.clip();
    if (!clip?.warp.enabled) return;
    const t = clip.warp.markers.timeOf(this._axis.xToBeat(x));
    if (t < 0 || t > this.duration()) return;
    const { markers, index } = clip.warp.markers.withMarkerAt(t);
    if (markers !== clip.warp.markers) this.commit('Aggiungi warp marker', c => c.withMarkers(markers));
    this.selectMarker(index);
  }

  private menu(clip: AudioClip, hit: EditorHit, p: Pointer): MenuItem[] {
    const warp = clip.warp.enabled;
    const tools: MenuItem[] = [
      { label: 'Auto-Warp', disabled: !this.target()?.sample.analysis, run: () => this.autoWarp() },
      { label: 'Segui tempo', disabled: !this.target()?.sample.analysis, run: () => void this.followTempo() },
      { label: 'Quantizza i warp marker', disabled: !warp, run: () => this.quantize() },
      { label: 'Azzera i warp marker', disabled: !warp, run: () => this.commit('Azzera warp marker', c => c.withMarkers(c.warp.markers.cleared(this.duration()))) },
      SEPARATOR,
      { label: warp ? 'Spegni il warp' : 'Accendi il warp', run: () => this.commit(warp ? 'Warp spento' : 'Warp attivo', c => c.withWarp({ enabled: !warp })) },
      { label: clip.reversed ? 'Togli il reverse' : 'Reverse', run: () => this.commit(clip.reversed ? 'Reverse spento' : 'Reverse', c => c.withReversed(!clip.reversed, this.duration())) },
    ];
    if (hit.kind === 'marker') {
      const i = hit.index;
      return [
        { label: '1.1.1 qui', run: () => this.commit('Imposta 1.1.1', c => c.withMarkers(c.warp.markers.withOrigin(c.warp.markers.markers[i].t))) },
        { label: 'Elimina warp marker', shortcut: KEY.delete, disabled: !clip.warp.markers.canRemove(i), run: () => this.deleteSelectedMarker() },
        SEPARATOR,
        ...tools,
      ];
    }
    const here: MenuItem[] = p.y >= LAYOUT.ruler && warp ? [{ label: 'Aggiungi warp marker qui', shortcut: 'doppio clic', run: () => this.addMarkerAt(p.x) }, SEPARATOR] : [];
    return [...here, ...tools];
  }
}
