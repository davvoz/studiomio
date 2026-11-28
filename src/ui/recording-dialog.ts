/* Options › Recording (also the right click on ● in the top bar): the input quantization of the
 * project (grid, triplets, strength, note ends), whether the movements of the controls are recorded,
 * and this computer's latency compensation (the audio device's delay, read by itself, and a hand
 * correction). Every change applies at once. */
import { OFFSET_MS, RECORD_GRIDS, type RecordQuantize } from '../model/record-settings';
import { openDialog } from './dialog';
import { el } from './dom';

/** What the window reads and changes. */
export interface RecordingSettings {
  readonly quantize: RecordQuantize;
  setQuantize(q: RecordQuantize): void;
  /** The audio device's delay, in ms. */
  readonly audioMs: number;
  /** The hand correction, in ms. */
  offsetMs: number;
  /** The movements of the controls are recorded too. */
  moves: boolean;
}

const OFF = 'off';

const row = (label: string, ...controls: (Node | string)[]) =>
  el('label', { className: 'recording-row' }, el('span', { className: 'recording-label', textContent: label }), ...controls);

const section = (title: string) => el('h3', { className: 'import-section', textContent: title });

/** The quantization's controls: they say the settings, and give them back changed. */
function quantizeControls(s: RecordingSettings): Node[] {
  const q = s.quantize;
  const grid = el<HTMLSelectElement>('select', {});
  grid.append(el('option', { value: OFF, textContent: 'Off' }), ...RECORD_GRIDS.map(g => el('option', { value: g.id, textContent: g.label })));
  grid.value = q.grid;
  const triplet = el<HTMLInputElement>('input', { type: 'checkbox', checked: q.triplet });
  const strength = el<HTMLInputElement>('input', { type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(q.strength * 100)) });
  const shown = el('span', { className: 'recording-value' });
  const ends = el<HTMLInputElement>('input', { type: 'checkbox', checked: q.ends });
  const render = () => {
    const off = grid.value === OFF;
    for (const c of [triplet, strength, ends]) c.disabled = off;
    shown.textContent = `${strength.value} %`;
  };
  const apply = () => {
    render();
    s.setQuantize({ grid: grid.value, triplet: triplet.checked, strength: Number(strength.value) / 100, ends: ends.checked });
  };
  grid.onchange = apply;
  triplet.onchange = apply;
  ends.onchange = apply;
  strength.oninput = () => { shown.textContent = `${strength.value} %`; };
  strength.onchange = apply;
  render();
  return [
    section('Input quantization'),
    row('Grid', grid),
    row('Triplets', triplet),
    row('Strength', strength, shown),
    row('Note ends too', ends),
    el('p', { textContent: '100 %: right on the grid; less: part of the way, it stays more human. For new clips (●) and for overdub.' }),
  ];
}

/** Whether the movements are recorded. */
function movesControls(s: RecordingSettings): Node[] {
  const moves = el<HTMLInputElement>('input', { type: 'checkbox', checked: s.moves });
  moves.onchange = () => { s.moves = moves.checked; };
  return [
    section('Movements'),
    row('Record them', moves),
    el('p', {
      textContent: 'While recording (● in a slot, overdub, or ● Rec on the timeline), what you move on the track (instrument, '
        + "effects, macros, volume, pan: on screen or from a controller) becomes the clip's curve, and the clip replays it.",
    }),
  ];
}

/** The latency compensation's controls. */
function latencyControls(s: RecordingSettings): Node[] {
  const offset = el<HTMLInputElement>('input', {
    type: 'number', min: String(OFFSET_MS.min), max: String(OFFSET_MS.max), step: '1', value: String(s.offsetMs),
  });
  const total = el('p', {});
  const render = () => { total.textContent = `Total: ${s.audioMs + s.offsetMs} ms earlier than the clock. More: the notes go earlier.`; };
  offset.onchange = () => {
    s.offsetMs = Number(offset.value);
    offset.value = String(s.offsetMs);
    render();
  };
  render();
  return [
    section('Latency compensation'),
    el('p', { textContent: `Audio device: ${s.audioMs} ms (read by itself). You play along with what you hear, which comes after the clock.` }),
    row('Extra (ms)', offset),
    total,
  ];
}

export async function showRecordingSettings(s: RecordingSettings): Promise<void> {
  const body = el('div', { className: 'recording-settings' }, ...quantizeControls(s), ...movesControls(s), ...latencyControls(s));
  await openDialog('Recording', [body], [{ label: 'Close', value: null, primary: true }]);
}
