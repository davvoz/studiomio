import type { Beats, TimeSignature } from '../../core/music-time';
import type { MidiClip, Note } from '../../model/midi-clip';
import { FRAME, paintBeatGrid, paintClipRuler } from '../clip-editor/clip-frame';
import type { BeatAxis } from '../clip-editor/clip-geometry';
import { COLORS, withAlpha } from '../timeline/painters';
import { isBlackKey, type PitchAxis } from './pitch-axis';

/** Fasce verticali del piano roll: righello, note, corsia della velocity. */
export const ROLL = {
  ...FRAME,
  velocity: 64,
} as const;

/** Dove finisce l'area delle note in una vista alta `height`. */
export const notesBottom = (height: number): number => height - ROLL.velocity;

const C = {
  white: '#1d2025', black: '#17191d', named: '#20242a', unnamed: '#141619', octave: 'rgba(255,255,255,0.10)', outside: 'rgba(0,0,0,0.42)',
  laneBg: '#15171a', selected: '#ffffff', box: 'rgba(255,157,46,0.9)', boxFill: 'rgba(255,157,46,0.12)',
};

export interface RollPaint {
  readonly g: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  readonly axis: BeatAxis;
  readonly pitches: PitchAxis;
  readonly clip: MidiClip;
  readonly selection: ReadonlySet<Note>;
  readonly signature: TimeSignature;
  readonly grid: Beats;
  /** Battito della clip sotto la testina, se la clip sta suonando. */
  readonly playhead: Beats | null;
  /** Punto d'inserimento (dove si incolla). */
  readonly insert: Beats | null;
  /** Le note con un nome (i pad della drum machine): le loro righe sono più chiare. */
  readonly named: ReadonlyMap<number, string> | null;
}

export function paintRoll(p: RollPaint): void {
  const { g, width, height, axis, clip } = p;
  const bottom = notesBottom(height);
  g.save();
  g.beginPath();
  g.rect(0, ROLL.ruler, width, bottom - ROLL.ruler);
  g.clip();
  paintRows(p, bottom);
  paintBeatGrid(g, axis, width, ROLL.ruler, bottom, p.grid, p.signature);
  // fuori dalla regione che suona: più scuro
  const rx0 = axis.beatToX(clip.region.start), rx1 = axis.beatToX(clip.region.end);
  g.fillStyle = C.outside;
  g.fillRect(0, ROLL.ruler, Math.max(0, rx0), bottom - ROLL.ruler);
  g.fillRect(rx1, ROLL.ruler, width - rx1, bottom - ROLL.ruler);
  paintNotes(p);
  if (p.insert !== null) {
    g.fillStyle = 'rgba(232,234,238,0.75)';
    g.fillRect(Math.round(axis.beatToX(p.insert)), ROLL.ruler, 1, bottom - ROLL.ruler);
  }
  g.restore();
  paintVelocity(p, bottom);
  paintClipRuler(g, axis, width, clip, p.signature);
  if (p.playhead !== null) {
    g.fillStyle = COLORS.playhead;
    g.fillRect(Math.round(axis.beatToX(p.playhead)) - 0.5, 0, 2, height);
  }
  g.fillStyle = '#2b2f36';
  g.fillRect(0, ROLL.ruler - 0.5, width, 1);
}

function paintRows({ g, width, pitches, named }: RollPaint, bottom: number): void {
  const hi = pitches.yToPitch(ROLL.ruler), lo = pitches.yToPitch(bottom);
  for (let pitch = lo; pitch <= hi; pitch++) {
    const y = pitches.pitchToY(pitch);
    g.fillStyle = named ? (named.has(pitch) ? C.named : C.unnamed) : isBlackKey(pitch) ? C.black : C.white;
    g.fillRect(0, y, width, pitches.rowHeight);
    // una linea sotto ogni Do separa le ottave
    g.fillStyle = pitch % 12 === 0 ? C.octave : 'rgba(0,0,0,0.25)';
    g.fillRect(0, Math.round(y + pitches.rowHeight) - 1, width, 1);
  }
}

function paintNotes({ g, axis, pitches, clip, selection, width }: RollPaint): void {
  const inRegion = (n: Note) => n.start < clip.region.end && n.start + n.duration > clip.region.start;
  for (const n of clip.notes) {
    const x0 = axis.beatToX(n.start), x1 = axis.beatToX(n.start + n.duration);
    if (x1 < 0 || x0 > width) continue;
    const y = pitches.pitchToY(n.pitch), h = pitches.rowHeight;
    const sel = selection.has(n);
    const alpha = (0.35 + 0.65 * (n.velocity / 127)) * (inRegion(n) ? 1 : 0.4);
    g.fillStyle = sel ? withAlpha('#ffd9a8', alpha) : withAlpha(clip.color, alpha);
    g.fillRect(x0 + 0.5, y + 1, Math.max(2, x1 - x0 - 1), h - 2);
    g.strokeStyle = sel ? C.selected : 'rgba(0,0,0,0.55)';
    g.lineWidth = 1;
    g.strokeRect(x0 + 0.5, y + 1.5, Math.max(2, x1 - x0 - 1), h - 3);
  }
}

function paintVelocity({ g, width, height, axis, clip, selection }: RollPaint, bottom: number): void {
  g.fillStyle = C.laneBg;
  g.fillRect(0, bottom, width, height - bottom);
  g.fillStyle = '#2b2f36';
  g.fillRect(0, bottom, width, 1);
  const top = bottom + 6, span = height - top - 4;
  for (const n of clip.notes) {
    const x = Math.round(axis.beatToX(n.start));
    if (x < -4 || x > width + 4) continue;
    const h = Math.max(2, (n.velocity / 127) * span), sel = selection.has(n);
    g.fillStyle = sel ? '#ffd9a8' : withAlpha(clip.color, 0.85);
    g.fillRect(x, height - 4 - h, 2, h);
    g.fillRect(x - 2, height - 4 - h, 6, 3);
  }
}

/** Il riquadro di selezione. */
export function paintSelectionBox(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  g.fillStyle = C.boxFill;
  g.fillRect(x, y, w, h);
  g.strokeStyle = C.box;
  g.strokeRect(x + 0.5, y + 0.5, w, h);
}
