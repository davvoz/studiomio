import type { Beats, Seconds, TempoMap, TimeSignature } from '../../core/music-time';
import type { AudioClip } from '../../model/audio-clip';
import type { Peaks } from '../waveform';
import { COLORS, withAlpha } from '../timeline/painters';
import { contentToSeconds, secondsToContent, type BeatAxis } from './clip-geometry';

/** Fasce verticali dell'editor, dall'alto. */
export const LAYOUT = {
  loopBand: 10,
  ruler: 28,
  strip: 24,
  get top() { return this.ruler + this.strip; },
};

const C = {
  wave: '#7cc4d4', waveOut: 'rgba(124,196,212,0.35)', sampleBg: '#191c20', outside: '#0e0f12',
  regionShade: 'rgba(0,0,0,0.45)', strip: '#17191d', marker: '#ffd64a', markerDim: '#b8952a',
  transient: 'rgba(200,205,215,0.55)', flag: '#e8eaee', center: '#2a2f36',
};

export interface EditorPaint {
  readonly g: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  readonly axis: BeatAxis;
  readonly clip: AudioClip;
  readonly duration: Seconds;
  readonly transients: readonly Seconds[];
  readonly peaks: Peaks | null;
  readonly tempo: TempoMap;
  readonly signature: TimeSignature;
  readonly grid: Beats;
  readonly selectedMarker: number;
  readonly hoverTransient: Seconds | null;
  /** Battito della clip sotto la testina, se la clip sta suonando. */
  readonly playhead: Beats | null;
}

export function paintEditor(p: EditorPaint): void {
  const { g, width, height, axis, clip } = p;
  const top = LAYOUT.top;
  const toBeat = secondsToContent(clip, p.tempo);
  const sx0 = axis.beatToX(toBeat(0)), sx1 = axis.beatToX(toBeat(p.duration));
  g.fillStyle = C.outside;
  g.fillRect(0, 0, width, height);
  g.fillStyle = C.sampleBg;
  g.fillRect(sx0, top, sx1 - sx0, height - top);
  paintGrid(p, top);
  paintWave(p, top);
  // fuori dalla regione che suona: più scuro
  const rx0 = axis.beatToX(clip.region.start), rx1 = axis.beatToX(clip.region.end);
  g.fillStyle = C.regionShade;
  g.fillRect(0, top, rx0, height - top);
  g.fillRect(rx1, top, width - rx1, height - top);
  paintRuler(p);
  g.fillStyle = C.strip;
  g.fillRect(0, LAYOUT.ruler, width, LAYOUT.strip);
  paintTransients(p, toBeat);
  if (clip.warp.enabled) paintMarkers(p);
  if (p.playhead !== null) {
    g.fillStyle = COLORS.playhead;
    g.fillRect(Math.round(axis.beatToX(p.playhead)) - 0.5, 0, 2, height);
  }
  g.fillStyle = '#2b2f36';
  g.fillRect(0, LAYOUT.ruler - 0.5, width, 1);
  g.fillRect(0, top - 0.5, width, 1);
}

function paintGrid({ g, axis, width, height, grid, signature }: EditorPaint, top: number): void {
  const bar = signature.beatsPerBar;
  for (let b = Math.floor(axis.xToBeat(0) / grid) * grid; axis.beatToX(b) < width; b += grid) {
    const isBar = Math.abs(b / bar - Math.round(b / bar)) < 1e-6;
    g.fillStyle = isBar ? COLORS.bar : Number.isInteger(b) ? 'rgba(255,255,255,0.08)' : COLORS.grid;
    g.fillRect(Math.round(axis.beatToX(b)), top, 1, height - top);
  }
}

function paintRuler(p: EditorPaint): void {
  const { g, axis, width, clip, signature } = p;
  g.fillStyle = COLORS.ruler;
  g.fillRect(0, 0, width, LAYOUT.ruler);
  // loop della clip
  const lx0 = axis.beatToX(clip.loop.start), lx1 = axis.beatToX(clip.loop.end);
  g.fillStyle = clip.loop.enabled ? COLORS.loop : COLORS.loopOff;
  g.fillRect(lx0, 1, lx1 - lx0, LAYOUT.loopBand - 2);
  // numeri di battuta (o battuta.tempo se lo zoom lo permette)
  const bar = signature.beatsPerBar;
  const label = [0.25, 1, bar, 2 * bar, 4 * bar, 8 * bar, 16 * bar, 32 * bar].find(s => s * axis.pxPerBeat >= 44) ?? 32 * bar;
  g.font = '10.5px system-ui, sans-serif';
  for (let b = Math.floor(axis.xToBeat(0) / label) * label; axis.beatToX(b) < width; b += label) {
    const x = Math.round(axis.beatToX(b));
    g.fillStyle = '#5d636d';
    g.fillRect(x, LAYOUT.loopBand, 1, LAYOUT.ruler - LAYOUT.loopBand);
    const text = label >= bar ? String(Math.floor(b / bar + 1e-9) + 1) : signature.format(b).split('.').slice(0, label >= 1 ? 2 : 3).join('.');
    g.fillStyle = COLORS.rulerText;
    g.fillText(text, x + 3, LAYOUT.ruler - 6);
  }
  // bandierine di inizio e fine della clip
  flag(g, axis.beatToX(clip.region.start), 1);
  flag(g, axis.beatToX(clip.region.end), -1);
}

/** Triangolo che punta verso l'interno della regione (dir 1 = inizio, −1 = fine). */
function flag(g: CanvasRenderingContext2D, x: number, dir: 1 | -1): void {
  const y0 = LAYOUT.loopBand, y1 = LAYOUT.ruler;
  g.fillStyle = C.flag;
  g.beginPath();
  g.moveTo(x, y0);
  g.lineTo(x + 9 * dir, y0 + (y1 - y0) / 2);
  g.lineTo(x, y1);
  g.closePath();
  g.fill();
  g.fillRect(Math.round(x) - (dir > 0 ? 0 : 1), y0, 1, y1 - y0);
}

function paintWave(p: EditorPaint, top: number): void {
  const { g, axis, width, height, clip, peaks } = p;
  if (!peaks) return;
  const toSeconds = contentToSeconds(clip, p.tempo);
  const mid = top + (height - top) / 2, amp = (height - top) / 2 - 4;
  g.fillStyle = C.center;
  g.fillRect(0, Math.round(mid), width, 1);
  for (let x = 0; x < width; x++) {
    const b0 = axis.xToBeat(x), b1 = axis.xToBeat(x + 1);
    const [lo, hi] = peaks.range(toSeconds(b0), toSeconds(b1));
    if (lo === 0 && hi === 0) continue;
    const inside = b1 > clip.region.start && b0 < clip.region.end;
    g.fillStyle = inside ? C.wave : C.waveOut;
    const y0 = mid - Math.min(1, hi) * amp, y1 = mid - Math.max(-1, lo) * amp;
    g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
}

function paintTransients(p: EditorPaint, toBeat: (t: Seconds) => Beats): void {
  const { g, axis, width, height } = p;
  const xs = p.transients.map(t => axis.beatToX(toBeat(t))).filter(x => x >= -2 && x <= width + 2);
  const dense = xs.length > width / 8;
  for (const x0 of xs) {
    const x = Math.round(x0);
    g.fillStyle = C.transient;
    g.fillRect(x, LAYOUT.top - 6, 1, 6);
    if (!dense) {
      g.fillStyle = 'rgba(200,205,215,0.08)';
      g.fillRect(x, LAYOUT.top, 1, height - LAYOUT.top);
    }
  }
  if (p.hoverTransient !== null && p.clip.warp.enabled) {
    const x = Math.round(axis.beatToX(toBeat(p.hoverTransient))) + 0.5;
    pentagon(g, x, null, 'rgba(200,205,215,0.85)');
  }
}

function paintMarkers(p: EditorPaint): void {
  const { g, axis, width, height, clip } = p;
  const markers = clip.warp.markers.markers;
  markers.forEach((m, i) => {
    const x = Math.round(axis.beatToX(m.b)) + 0.5;
    if (x < -10 || x > width + 10) return;
    const sel = i === p.selectedMarker;
    g.fillStyle = sel ? C.marker : withAlpha(C.marker, 0.5);
    g.fillRect(x - 0.5, LAYOUT.top, 1, height - LAYOUT.top);
    pentagon(g, x, sel ? C.marker : C.markerDim, sel ? '#fff8d8' : null);
  });
  const i = p.selectedMarker;
  if (i >= 0 && i < markers.length && markers.length >= 2) {
    const text = `${clip.warp.markers.segmentBpm(i).toFixed(2)} BPM`;
    const x = axis.beatToX(markers[i].b);
    g.font = '11px system-ui, sans-serif';
    const w = g.measureText(text).width + 10;
    g.fillStyle = 'rgba(20,22,26,0.92)';
    g.fillRect(x + 9, LAYOUT.ruler + 4, w, 15);
    g.fillStyle = C.marker;
    g.fillText(text, x + 14, LAYOUT.ruler + 15);
  }
}

/** Il segno dei warp marker: un pentagono che punta in basso, nella striscia. */
function pentagon(g: CanvasRenderingContext2D, x: number, fill: string | null, stroke: string | null): void {
  const y0 = LAYOUT.ruler + 3, y1 = LAYOUT.top - 8, y2 = LAYOUT.top - 2;
  g.beginPath();
  g.moveTo(x - 6, y0); g.lineTo(x + 6, y0); g.lineTo(x + 6, y1); g.lineTo(x, y2); g.lineTo(x - 6, y1);
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.2; g.stroke(); g.lineWidth = 1; }
}
