import type { WarpMode } from '../../dsp/stretch/stretcher';
import { GAIN_MAX_DB, GAIN_MIN_DB, type AudioClip, type WarpOptions } from '../../model/audio-clip';
import { sampleDuration, type SampleRef } from '../../model/sample';
import { scaleTempo } from '../../model/warp-tools';
import { el } from '../dom';

/** A field of a warp mode's options. */
type Field =
  | { readonly kind: 'select'; readonly label: string; readonly options: readonly (readonly [string, string])[]; get(o: WarpOptions): string; set(v: string): object }
  | { readonly kind: 'number'; readonly label: string; readonly min: number; readonly max: number; readonly step: number; get(o: WarpOptions): number; set(v: number): object }
  | { readonly kind: 'check'; readonly label: string; get(o: WarpOptions): boolean; set(v: boolean): object };

/** Options of each mode: adding an option is adding a line. */
const MODE_FIELDS: { readonly [M in WarpMode]: readonly Field[] } = {
  beats: [
    {
      kind: 'select', label: 'Keep',
      options: [['transients', 'Transients'], ['1', '1/4'], ['0.5', '1/8'], ['0.25', '1/16'], ['0.125', '1/32']],
      get: o => String(o.beats.preserve), set: v => ({ preserve: v === 'transients' ? 'transients' : Number(v) }),
    },
    {
      kind: 'select', label: 'Loop', options: [['off', 'Off'], ['forward', 'Forward'], ['pingpong', 'Back and forth']],
      get: o => o.beats.loop, set: v => ({ loop: v }),
    },
    { kind: 'number', label: 'Envelope %', min: 0, max: 100, step: 1, get: o => o.beats.envelope, set: v => ({ envelope: v }) },
  ],
  tones: [{ kind: 'number', label: 'Grain ms', min: 10, max: 200, step: 1, get: o => o.tones.grainMs, set: v => ({ grainMs: v }) }],
  texture: [
    { kind: 'number', label: 'Grain ms', min: 10, max: 400, step: 1, get: o => o.texture.grainMs, set: v => ({ grainMs: v }) },
    { kind: 'number', label: 'Flux %', min: 0, max: 100, step: 1, get: o => o.texture.flux, set: v => ({ flux: v }) },
  ],
  complex: [
    {
      kind: 'select', label: 'FFT', options: [['2048', '2048'], ['4096', '4096'], ['8192', '8192']],
      get: o => String(o.complex.fftSize), set: v => ({ fftSize: Number(v) }),
    },
    { kind: 'check', label: 'Phase reset on transients', get: o => o.complex.resetOnTransients, set: v => ({ resetOnTransients: v }) },
  ],
  repitch: [],
};

const MODE_LABEL: { readonly [M in WarpMode]: string } = {
  beats: 'Beats', tones: 'Tones', texture: 'Texture', complex: 'Complex', repitch: 'Re-Pitch',
};

export interface PanelActions {
  /** With `mergeKey` the continuous changes (e.g. a dragged slider) are a single step. */
  commit(label: string, fn: (c: AudioClip) => AudioClip, mergeKey?: string): void;
  endMerge(): void;
  autoWarp(): void;
  followTempo(): void;
  quantize(): void;
  /** Keeps only the loop (or the region) in a new file. */
  crop(): void;
  close(): void;
}

const row = (label: string, ...controls: Node[]) => el('label', { className: 'row' }, el('span', { textContent: label }), ...controls);

/** Panel on the left of the editor: volume and reverse, warp, mode and options, tempo and pitch. */
export class ClipPanel {
  readonly element = el('div', { className: 'clip-panel' });
  private clip: AudioClip | null = null;
  private selectedMarker = -1;
  private renderedMode: WarpMode | null = null;
  /** Duration of the sample, for "Reset". */
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
  private readonly gain = el<HTMLInputElement>('input', { type: 'number', min: String(GAIN_MIN_DB), max: String(GAIN_MAX_DB), step: '0.5' });
  private readonly gainSlider = el<HTMLInputElement>('input', { type: 'range', min: String(GAIN_MIN_DB), max: String(GAIN_MAX_DB), step: '0.5', title: 'Clip volume (double click: 0 dB)' });
  private readonly reverse = el<HTMLButtonElement>('button', { textContent: 'Reverse', title: 'Plays the clip backwards' });
  private readonly warpOnly: HTMLElement[] = [];
  private readonly origin: HTMLButtonElement;

  constructor(private readonly actions: PanelActions) {
    const { commit } = actions;
    const button = (text: string, title: string, onclick: () => void) => el<HTMLButtonElement>('button', { textContent: text, title, onclick });
    this.mode.append(...(Object.keys(MODE_LABEL) as WarpMode[]).map(m => el('option', { value: m, textContent: MODE_LABEL[m] })));
    this.name.onchange = () => { if (this.name.value.trim()) commit('Rename clip', c => c.withName(this.name.value.trim())); };
    this.warp.onchange = () => commit(this.warp.checked ? 'Warp on' : 'Warp off', c => c.withWarp({ enabled: this.warp.checked }));
    this.mode.onchange = () => commit('Warp mode', c => c.withWarp({ mode: this.mode.value as WarpMode }));
    this.bpm.onchange = () => {
      const v = Number(this.bpm.value), i = this.selectedMarker;
      if (!(v >= 20 && v <= 999)) return this.update(this.clip!, null, i);
      commit(i >= 0 ? 'Segment tempo' : 'Clip tempo', c => c.withMarkers(i >= 0 ? c.warp.markers.withSegmentBpm(i, v) : c.warp.markers.withGlobalBpm(v)));
    };
    this.transpose.onchange = () => commit('Transpose', c => c.withTranspose(Number(this.transpose.value)));
    this.detune.onchange = () => commit('Detune', c => c.withDetune(Number(this.detune.value)));
    this.gain.onchange = () => commit('Clip volume', c => c.withGain(Number(this.gain.value)));
    this.gainSlider.oninput = () => commit('Clip volume', c => c.withGain(Number(this.gainSlider.value)), 'clip-gain');
    this.gainSlider.onchange = () => actions.endMerge();
    this.gainSlider.ondblclick = () => commit('Clip volume', c => c.withGain(0));
    this.reverse.onclick = () => {
      const on = !this.clip?.reversed;
      commit(on ? 'Reverse' : 'Reverse off', c => c.withReversed(on, this.duration));
    };
    this.origin = button('1.1.1 here', 'The selected marker becomes the start of bar 1', () => {
      const i = this.selectedMarker;
      if (i >= 0) commit('Set 1.1.1', c => c.withMarkers(c.warp.markers.withOrigin(c.warp.markers.markers[i].t)));
    });
    for (const input of [this.name, this.bpm, this.transpose, this.detune, this.gain, this.gainSlider]) {
      input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') input.blur(); };
    }

    const tempoTools = el('div', { className: 'buttons' },
      button(':2', 'Half time', () => commit('Tempo :2', c => c.withMarkers(scaleTempo(c.warp.markers, 0.5)))),
      button('×2', 'Double time', () => commit('Tempo ×2', c => c.withMarkers(scaleTempo(c.warp.markers, 2)))),
      this.origin);
    const warpTools = el('div', { className: 'buttons' },
      button('Auto-Warp', 'Constant tempo on the detected tempo, 1.1.1 on the first hit', () => actions.autoWarp()),
      button('Follow tempo', 'One marker per bar from beat tracking (live recordings)', () => actions.followTempo()),
      button('Quantize', 'Brings the markers onto the grid', () => actions.quantize()),
      button('Reset', 'Back to a constant tempo', () => commit('Reset warp markers', c => c.withMarkers(c.warp.markers.cleared(this.duration)))));
    const modeRow = row('Mode', this.mode);
    const tempoRow = row('', this.bpm);
    tempoRow.firstElementChild!.replaceWith(this.bpmLabel);
    this.warpOnly.push(modeRow, this.options, tempoRow, tempoTools, warpTools);

    this.element.append(
      el('div', { className: 'panel-head' }, this.name, el('button', { className: 'close', textContent: '×', title: 'Close (Esc)', onclick: () => actions.close() })),
      this.info,
      el('div', { className: 'clip-gain' }, el('span', { textContent: 'Volume dB' }), this.gainSlider, this.gain),
      el('div', { className: 'buttons' }, this.reverse,
        button('Crop', 'Keeps only the loop (or the region, if the loop is off): the rest of the sample disappears into a new file', () => actions.crop())),
      row('Warp', this.warp),
      modeRow, this.options, tempoRow, tempoTools, warpTools,
      row('Transpose st', this.transpose), row('Detune ct', this.detune),
    );
  }

  update(clip: AudioClip, sample: SampleRef | null, selectedMarker: number): void {
    this.clip = clip;
    this.selectedMarker = selectedMarker;
    if (sample) {
      this.duration = sampleDuration(sample);
      this.info.textContent = `${sample.name} · ${this.duration.toFixed(2)} s · ${sample.analysis ? `${sample.analysis.tempo.toFixed(2)} BPM detected` : 'not analysed'}`;
    }
    const set = (input: HTMLInputElement, v: string) => { if (document.activeElement !== input) input.value = v; };
    set(this.name, clip.name);
    this.warp.checked = clip.warp.enabled;
    this.mode.value = clip.warp.mode;
    const markers = clip.warp.markers;
    const segment = selectedMarker >= 0 && selectedMarker < markers.length;
    this.bpmLabel.textContent = segment ? 'Segment BPM' : 'BPM clip';
    set(this.bpm, (segment ? markers.segmentBpm(selectedMarker) : markers.globalBpm).toFixed(2));
    set(this.transpose, String(clip.transpose));
    set(this.detune, String(clip.detune));
    set(this.gain, String(clip.gainDb));
    set(this.gainSlider, String(clip.gainDb));
    this.reverse.classList.toggle('on', clip.reversed);
    this.origin.disabled = !segment;
    for (const e of this.warpOnly) e.hidden = !clip.warp.enabled;
    this.renderOptions(clip);
  }

  /** Fields of the current mode; rebuilt only when the mode changes. */
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
    const commit = (patch: object) => this.actions.commit(`${MODE_LABEL[mode]} options`, c =>
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
