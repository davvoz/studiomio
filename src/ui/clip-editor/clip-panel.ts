import type { WarpMode } from '../../dsp/stretch/stretcher';
import type { AudioClip, WarpOptions } from '../../model/audio-clip';
import { sampleDuration, type SampleRef } from '../../model/sample';
import { scaleTempo } from '../../model/warp-tools';

/** Un campo delle opzioni di una modalità di warp. */
type Field =
  | { readonly kind: 'select'; readonly label: string; readonly options: readonly (readonly [string, string])[]; get(o: WarpOptions): string; set(v: string): object }
  | { readonly kind: 'number'; readonly label: string; readonly min: number; readonly max: number; readonly step: number; get(o: WarpOptions): number; set(v: number): object }
  | { readonly kind: 'check'; readonly label: string; get(o: WarpOptions): boolean; set(v: boolean): object };

/** Opzioni di ogni modalità: aggiungere un'opzione è aggiungere una riga. */
const MODE_FIELDS: { readonly [M in WarpMode]: readonly Field[] } = {
  beats: [
    {
      kind: 'select', label: 'Conserva',
      options: [['transients', 'Transienti'], ['1', '1/4'], ['0.5', '1/8'], ['0.25', '1/16'], ['0.125', '1/32']],
      get: o => String(o.beats.preserve), set: v => ({ preserve: v === 'transients' ? 'transients' : Number(v) }),
    },
    {
      kind: 'select', label: 'Loop', options: [['off', 'Off'], ['forward', 'Avanti'], ['pingpong', 'Avanti-indietro']],
      get: o => o.beats.loop, set: v => ({ loop: v }),
    },
    { kind: 'number', label: 'Inviluppo %', min: 0, max: 100, step: 1, get: o => o.beats.envelope, set: v => ({ envelope: v }) },
  ],
  tones: [{ kind: 'number', label: 'Grana ms', min: 10, max: 200, step: 1, get: o => o.tones.grainMs, set: v => ({ grainMs: v }) }],
  texture: [
    { kind: 'number', label: 'Grana ms', min: 10, max: 400, step: 1, get: o => o.texture.grainMs, set: v => ({ grainMs: v }) },
    { kind: 'number', label: 'Flux %', min: 0, max: 100, step: 1, get: o => o.texture.flux, set: v => ({ flux: v }) },
  ],
  complex: [
    {
      kind: 'select', label: 'FFT', options: [['2048', '2048'], ['4096', '4096'], ['8192', '8192']],
      get: o => String(o.complex.fftSize), set: v => ({ fftSize: Number(v) }),
    },
    { kind: 'check', label: 'Fase azzerata sui transienti', get: o => o.complex.resetOnTransients, set: v => ({ resetOnTransients: v }) },
  ],
  repitch: [],
};

const MODE_LABEL: { readonly [M in WarpMode]: string } = {
  beats: 'Beats', tones: 'Tones', texture: 'Texture', complex: 'Complex', repitch: 'Re-Pitch',
};

export interface PanelActions {
  commit(label: string, fn: (c: AudioClip) => AudioClip): void;
  autoWarp(): void;
  followTempo(): void;
  quantize(): void;
  close(): void;
}

function el<T extends HTMLElement = HTMLElement>(tag: string, props: Record<string, unknown> = {}, ...children: (Node | string)[]): T {
  const e = Object.assign(document.createElement(tag), props) as T;
  e.append(...children);
  return e;
}

const row = (label: string, ...controls: Node[]) => el('label', { className: 'row' }, el('span', { textContent: label }), ...controls);

/** Pannello a sinistra dell'editor: warp, modalità e opzioni, tempo, intonazione e volume. */
export class ClipPanel {
  readonly element = el('div', { className: 'clip-panel' });
  private clip: AudioClip | null = null;
  private selectedMarker = -1;
  private renderedMode: WarpMode | null = null;
  /** Durata del sample, per "Azzera". */
  private duration = 0;
  private readonly name = el<HTMLInputElement>('input', { className: 'clip-name' });
  private readonly info = el('div', { className: 'muted small' });
  private readonly warp = el<HTMLInputElement>('input', { type: 'checkbox' });
  private readonly mode = el<HTMLSelectElement>('select');
  private readonly options = el('div', { className: 'mode-options' });
  private readonly bpm = el<HTMLInputElement>('input', { type: 'number', min: '20', max: '999', step: '0.01' });
  private readonly bpmLabel = el('span');
  private readonly transpose = el<HTMLInputElement>('input', { type: 'number', min: '-48', max: '48', step: '1' });
  private readonly detune = el<HTMLInputElement>('input', { type: 'number', min: '-50', max: '50', step: '1' });
  private readonly gain = el<HTMLInputElement>('input', { type: 'number', min: '-70', max: '24', step: '0.5' });
  private readonly warpOnly: HTMLElement[] = [];
  private readonly origin: HTMLButtonElement;

  constructor(private readonly actions: PanelActions) {
    const { commit } = actions;
    const button = (text: string, title: string, onclick: () => void) => el<HTMLButtonElement>('button', { textContent: text, title, onclick });
    this.mode.append(...(Object.keys(MODE_LABEL) as WarpMode[]).map(m => el('option', { value: m, textContent: MODE_LABEL[m] })));
    this.name.onchange = () => { if (this.name.value.trim()) commit('Rinomina clip', c => c.withName(this.name.value.trim())); };
    this.warp.onchange = () => commit(this.warp.checked ? 'Warp attivo' : 'Warp spento', c => c.withWarp({ enabled: this.warp.checked }));
    this.mode.onchange = () => commit('Modalità di warp', c => c.withWarp({ mode: this.mode.value as WarpMode }));
    this.bpm.onchange = () => {
      const v = Number(this.bpm.value), i = this.selectedMarker;
      if (!(v >= 20 && v <= 999)) return this.update(this.clip!, null, i);
      commit(i >= 0 ? 'Tempo del segmento' : 'Tempo della clip', c => c.withMarkers(i >= 0 ? c.warp.markers.withSegmentBpm(i, v) : c.warp.markers.withGlobalBpm(v)));
    };
    this.transpose.onchange = () => commit('Transpose', c => c.withTranspose(Number(this.transpose.value)));
    this.detune.onchange = () => commit('Detune', c => c.withDetune(Number(this.detune.value)));
    this.gain.onchange = () => commit('Gain della clip', c => c.withGain(Number(this.gain.value)));
    this.origin = button('1.1.1 qui', 'Il marker selezionato diventa l\'inizio della battuta 1', () => {
      const i = this.selectedMarker;
      if (i >= 0) commit('Imposta 1.1.1', c => c.withMarkers(c.warp.markers.withOrigin(c.warp.markers.markers[i].t)));
    });
    for (const input of [this.name, this.bpm, this.transpose, this.detune, this.gain]) {
      input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') input.blur(); };
    }

    const tempoTools = el('div', { className: 'buttons' },
      button(':2', 'Tempo dimezzato', () => commit('Tempo :2', c => c.withMarkers(scaleTempo(c.warp.markers, 0.5)))),
      button('×2', 'Tempo doppio', () => commit('Tempo ×2', c => c.withMarkers(scaleTempo(c.warp.markers, 2)))),
      this.origin);
    const warpTools = el('div', { className: 'buttons' },
      button('Auto-Warp', 'Tempo costante sul tempo rilevato, 1.1.1 sul primo colpo', () => actions.autoWarp()),
      button('Segui tempo', 'Un marker per battuta dal beat tracking (registrazioni dal vivo)', () => actions.followTempo()),
      button('Quantizza', 'Porta i marker sulla griglia', () => actions.quantize()),
      button('Azzera', 'Torna a un tempo costante', () => commit('Azzera warp marker', c => c.withMarkers(c.warp.markers.cleared(this.duration)))));
    const modeRow = row('Modalità', this.mode);
    const tempoRow = row('', this.bpm);
    tempoRow.firstElementChild!.replaceWith(this.bpmLabel);
    this.warpOnly.push(modeRow, this.options, tempoRow, tempoTools, warpTools);

    this.element.append(
      el('div', { className: 'panel-head' }, this.name, el('button', { className: 'close', textContent: '×', title: 'Chiudi (Esc)', onclick: () => actions.close() })),
      this.info,
      row('Warp', this.warp),
      modeRow, this.options, tempoRow, tempoTools, warpTools,
      row('Transpose st', this.transpose), row('Detune ct', this.detune), row('Gain dB', this.gain),
    );
  }

  update(clip: AudioClip, sample: SampleRef | null, selectedMarker: number): void {
    this.clip = clip;
    this.selectedMarker = selectedMarker;
    if (sample) {
      this.duration = sampleDuration(sample);
      this.info.textContent = `${sample.name} · ${this.duration.toFixed(2)} s · ${sample.analysis ? `${sample.analysis.tempo.toFixed(2)} BPM rilevati` : 'non analizzato'}`;
    }
    const set = (input: HTMLInputElement, v: string) => { if (document.activeElement !== input) input.value = v; };
    set(this.name, clip.name);
    this.warp.checked = clip.warp.enabled;
    this.mode.value = clip.warp.mode;
    const markers = clip.warp.markers;
    const segment = selectedMarker >= 0 && selectedMarker < markers.length;
    this.bpmLabel.textContent = segment ? 'BPM segmento' : 'BPM clip';
    set(this.bpm, (segment ? markers.segmentBpm(selectedMarker) : markers.globalBpm).toFixed(2));
    set(this.transpose, String(clip.transpose));
    set(this.detune, String(clip.detune));
    set(this.gain, String(clip.gainDb));
    this.origin.disabled = !segment;
    for (const e of this.warpOnly) e.hidden = !clip.warp.enabled;
    this.renderOptions(clip);
  }

  /** Campi della modalità corrente; ricostruiti solo quando la modalità cambia. */
  private renderOptions(clip: AudioClip): void {
    const mode = clip.warp.mode;
    if (mode !== this.renderedMode) {
      this.renderedMode = mode;
      this.options.replaceChildren(...MODE_FIELDS[mode].map(f => this.field(mode, f)));
    }
    const o = clip.warp.options;
    MODE_FIELDS[mode].forEach((f, i) => {
      const input = this.options.children[i]?.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null;
      if (!input || document.activeElement === input) return;
      if (f.kind === 'check') (input as HTMLInputElement).checked = f.get(o);
      else input.value = String(f.get(o));
    });
  }

  private field(mode: WarpMode, f: Field): HTMLElement {
    const commit = (patch: object) => this.actions.commit(`Opzioni ${MODE_LABEL[mode]}`, c =>
      c.withWarpOptions(mode as keyof WarpOptions, patch as Partial<WarpOptions[keyof WarpOptions]>));
    const makers: { readonly [K in Field['kind']]: (f: Extract<Field, { kind: K }>) => HTMLElement } = {
      select: f => {
        const s = el<HTMLSelectElement>('select');
        s.append(...f.options.map(([v, t]) => el('option', { value: v, textContent: t })));
        s.onchange = () => commit(f.set(s.value));
        return s;
      },
      number: f => {
        const n = el<HTMLInputElement>('input', { type: 'number', min: String(f.min), max: String(f.max), step: String(f.step) });
        n.onchange = () => commit(f.set(Math.max(f.min, Math.min(f.max, Number(n.value)))));
        n.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') n.blur(); };
        return n;
      },
      check: f => {
        const c = el<HTMLInputElement>('input', { type: 'checkbox' });
        c.onchange = () => commit(f.set(c.checked));
        return c;
      },
    };
    return row(f.label, (makers[f.kind] as (f: Field) => HTMLElement)(f));
  }
}
