/* Disegno della timeline su canvas: corsie, griglia, clip (con forma d'onda o note),
 * righello, loop, testina e anteprime dei gesti. */
import type { PlacementId, TrackId } from '../../core/id';
import type { Beats, TimeSignature } from '../../core/music-time';
import { dbToGain } from '../../engine/audio-graph';
import { placementSegments } from '../../engine/segments';
import { placementEnd, type Placement } from '../../model/arrangement';
import { AudioClip } from '../../model/audio-clip';
import type { Clip } from '../../model/clip';
import { MidiClip } from '../../model/midi-clip';
import type { LoopRegion, Project } from '../../model/project';
import { GroupTrack } from '../../model/track';
import { contentToSeconds } from '../clip-editor/clip-geometry';
import type { Peaks } from '../waveform';
import type { TimelineGeometry } from './geometry';

export const COLORS = {
  bg: '#16191d', laneAlt: '#1a1d22', grid: 'rgba(255,255,255,0.05)', bar: 'rgba(255,255,255,0.13)',
  ruler: '#1d2025', rulerText: '#9aa0aa', loop: 'rgba(255,157,46,0.85)', loopOff: 'rgba(154,160,170,0.45)',
  loopShade: 'rgba(255,157,46,0.06)', playhead: '#ff9d2e', cursor: 'rgba(232,234,238,0.6)',
  select: '#ffffff', clipText: '#111317', ghost: 'rgba(255,255,255,0.35)', box: 'rgba(91,141,239,0.18)',
};

const CLIP_HEADER = 14;

export interface LanePaint {
  readonly project: Project;
  readonly geo: TimelineGeometry;
  readonly width: number;
  readonly height: number;
  readonly grid: Beats;
  readonly selection: ReadonlySet<PlacementId>;
  readonly peaks: (clip: AudioClip) => Peaks | null;
  /** Clip da non disegnare (sono in anteprima altrove durante un trascinamento). */
  readonly hidden: ReadonlySet<PlacementId>;
  /** Tracce prese dalla session: la loro timeline non suona e si mostra spenta. */
  readonly taken: ReadonlySet<TrackId>;
  /** Le tracce scelte: la loro corsia si colora appena. */
  readonly selectedTracks: ReadonlySet<TrackId>;
}

/** Contenuto di un tipo di clip dentro il suo rettangolo: un pittore per tipo. */
type ContentPainter = (g: CanvasRenderingContext2D, pl: Placement, box: Box, lp: LanePaint) => void;
interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

const contentPainters: Readonly<Record<string, ContentPainter>> = {
  audio: (g, pl, box, lp) => paintWaveform(g, pl as Placement<AudioClip>, box, lp),
  midi: (g, pl, box, lp) => paintNotes(g, pl as Placement<MidiClip>, box, lp),
};

/** Le corsie sono le tracce che si vedono: quelle di un gruppo chiuso no, il gruppo sì (con il
 *  riassunto delle loro clip). */
export function paintLanes(g: CanvasRenderingContext2D, lp: LanePaint): void {
  const { project, geo, width, height } = lp;
  const rows = project.visibleTracks;
  g.fillStyle = COLORS.bg;
  g.fillRect(0, 0, width, height);
  rows.forEach((t, i) => {
    const y = geo.trackTop(i);
    if (y > height || y + geo.trackHeight < 0) return;
    if (i % 2) {
      g.fillStyle = COLORS.laneAlt;
      g.fillRect(0, y, width, geo.trackHeight);
    }
    if (t instanceof GroupTrack || lp.selectedTracks.has(t.id)) {
      g.fillStyle = withAlpha(t.color, lp.selectedTracks.has(t.id) ? 0.1 : 0.05);
      g.fillRect(0, y, width, geo.trackHeight);
    }
  });
  paintLoopShade(g, project.loop, geo, height);
  paintGrid(g, geo, project.signature, lp.grid, width, height);
  rows.forEach((t, i) => {
    const y = geo.trackTop(i);
    if (y > height || y + geo.trackHeight < 0) return;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, y + geo.trackHeight - 1, width, 1);
    if (t instanceof GroupTrack) paintGroupLane(g, t, i, lp);
    for (const pl of t.arrangement) {
      if (lp.hidden.has(pl.id)) continue;
      paintClip(g, pl, i, lp, lp.selection.has(pl.id));
    }
    if (lp.taken.has(t.id)) {
      g.fillStyle = 'rgba(18, 20, 23, 0.62)';
      g.fillRect(0, y, width, geo.trackHeight - 1);
    }
  });
}

/** La corsia di un gruppo, come in Live: le clip delle sue tracce in piccolo, una striscia per
 *  traccia, nel loro colore. */
function paintGroupLane(g: CanvasRenderingContext2D, group: GroupTrack, index: number, lp: LanePaint): void {
  const members = lp.project.soundingTracks(group.id);
  if (!members.length) return;
  const box = clipBox(lp.geo, index, 0, 0);
  const band = Math.max(1, Math.min(8, (box.h - 4) / members.length));
  const top = box.y + (box.h - band * members.length) / 2;
  members.forEach((m, k) => {
    for (const pl of m.arrangement) {
      const x0 = lp.geo.beatToX(pl.start), x1 = lp.geo.beatToX(placementEnd(pl));
      if (x1 < 0 || x0 > lp.width) continue;
      g.fillStyle = withAlpha(pl.clip.color, lp.taken.has(m.id) ? 0.3 : 0.8);
      g.fillRect(x0, top + k * band, Math.max(1, x1 - x0 - 1), Math.max(1, band - 1));
    }
  });
}

function paintGrid(g: CanvasRenderingContext2D, geo: TimelineGeometry, sig: TimeSignature, step: Beats, width: number, height: number): void {
  const bar = sig.beatsPerBar;
  const first = Math.floor(geo.xToBeat(0) / step) * step;
  for (let b = first; geo.beatToX(b) < width; b += step) {
    const isBar = Math.abs(b / bar - Math.round(b / bar)) < 1e-6;
    g.fillStyle = isBar ? COLORS.bar : COLORS.grid;
    g.fillRect(Math.round(geo.beatToX(b)), 0, 1, height);
  }
}

function paintLoopShade(g: CanvasRenderingContext2D, loop: LoopRegion, geo: TimelineGeometry, height: number): void {
  if (!loop.enabled) return;
  const x0 = geo.beatToX(loop.start), x1 = geo.beatToX(loop.end);
  g.fillStyle = COLORS.loopShade;
  g.fillRect(x0, 0, x1 - x0, height);
}

export function clipBox(geo: TimelineGeometry, trackIndex: number, start: Beats, end: Beats): Box {
  const x = geo.beatToX(start);
  return { x, y: geo.trackTop(trackIndex) + 2, w: Math.max(2, geo.beatToX(end) - x), h: geo.trackHeight - 5 };
}

function paintClip(g: CanvasRenderingContext2D, pl: Placement, trackIndex: number, lp: LanePaint, selected: boolean): void {
  const box = clipBox(lp.geo, trackIndex, pl.start, placementEnd(pl));
  if (box.x > lp.width || box.x + box.w < 0) return;
  const color = pl.clip.color;
  g.save();
  roundRect(g, box);
  g.clip();
  g.fillStyle = withAlpha(color, 0.28);
  g.fillRect(box.x, box.y, box.w, box.h);
  g.fillStyle = color;
  g.fillRect(box.x, box.y, box.w, CLIP_HEADER);
  const body = { x: box.x, y: box.y + CLIP_HEADER, w: box.w, h: box.h - CLIP_HEADER };
  g.fillStyle = withAlpha(color, 0.95);
  g.strokeStyle = withAlpha(color, 0.95);
  contentPainters[pl.clip.kind]?.(g, pl, body, lp);
  paintLoopSeams(g, pl, body, lp.geo);
  g.fillStyle = COLORS.clipText;
  g.font = '600 10.5px system-ui, sans-serif';
  g.fillText(clipLabel(pl.clip), box.x + 4, box.y + 10.5);
  g.restore();
  if (selected) {
    g.strokeStyle = COLORS.select;
    g.lineWidth = 1.5;
    roundRect(g, { x: box.x + 0.75, y: box.y + 0.75, w: box.w - 1.5, h: box.h - 1.5 });
    g.stroke();
    g.lineWidth = 1;
  }
}

const clipLabel = (c: Clip): string => (c instanceof AudioClip && c.transpose ? `${c.name}  ${c.transpose > 0 ? '+' : ''}${c.transpose} st` : c.name);

/** Linee tratteggiate dove la clip ricomincia il loop. */
function paintLoopSeams(g: CanvasRenderingContext2D, pl: Placement, body: Box, geo: TimelineGeometry): void {
  const segs = placementSegments(pl);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  for (const s of segs.slice(1)) {
    const x = Math.round(geo.beatToX(s.start));
    for (let y = body.y; y < body.y + body.h; y += 4) g.fillRect(x, y, 1, 2);
  }
}

/** Forma d'onda passando per la mappa di warp: ogni colonna di pixel mostra la parte del
 *  sample che suona in quel punto della timeline. */
function paintWaveform(g: CanvasRenderingContext2D, pl: Placement<AudioClip>, body: Box, lp: LanePaint): void {
  const peaks = lp.peaks(pl.clip);
  if (!peaks) return;
  const { geo, project } = lp;
  // l'altezza segue il gain della clip, come la si sente
  const clip = pl.clip, mid = body.y + body.h / 2, amp = body.h / 2 - 1, gain = dbToGain(clip.gainDb);
  const toSeconds = contentToSeconds(clip, project.tempo);
  for (const s of placementSegments(pl)) {
    const xa = Math.max(0, Math.floor(geo.beatToX(s.start))), xb = Math.min(lp.width, Math.ceil(geo.beatToX(s.end)));
    for (let x = xa; x < xb; x++) {
      const b0 = Math.max(s.start, geo.xToBeat(x)), b1 = Math.min(s.end, geo.xToBeat(x + 1));
      if (b1 <= b0) continue;
      const [lo, hi] = peaks.range(toSeconds(s.contentStart + b0 - s.start), toSeconds(s.contentStart + b1 - s.start));
      const y0 = mid - Math.min(1, hi * gain) * amp, y1 = mid - Math.max(-1, lo * gain) * amp;
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  }
}

function paintNotes(g: CanvasRenderingContext2D, pl: Placement<MidiClip>, body: Box, lp: LanePaint): void {
  const notes = pl.clip.notes;
  if (!notes.length) return;
  const lo = Math.min(...notes.map(n => n.pitch)), hi = Math.max(...notes.map(n => n.pitch));
  const rows = Math.max(8, hi - lo + 3), rowH = body.h / rows;
  const { geo } = lp;
  for (const s of placementSegments(pl)) {
    for (const n of pl.clip.notesIn(s.contentStart, s.contentStart + (s.end - s.start))) {
      const start = s.start + (n.start - s.contentStart);
      const end = Math.min(s.end, start + n.duration);
      const x = geo.beatToX(start), w = Math.max(1.5, geo.beatToX(end) - x - 1);
      const y = body.y + body.h - (n.pitch - lo + 2) * rowH;
      g.fillRect(x, y, w, Math.max(1.5, rowH - 1));
    }
  }
}

// ------------------------------------------------------------------ righello e sovrapposizioni

export const RULER_LOOP_BAND = 11;

export function paintRuler(g: CanvasRenderingContext2D, project: Project, geo: TimelineGeometry, width: number, height: number, grid: Beats): void {
  g.fillStyle = COLORS.ruler;
  g.fillRect(0, 0, width, height);
  const loop = project.loop;
  const lx0 = geo.beatToX(loop.start), lx1 = geo.beatToX(loop.end);
  g.fillStyle = loop.enabled ? COLORS.loop : COLORS.loopOff;
  g.fillRect(lx0, 1, lx1 - lx0, RULER_LOOP_BAND - 2);
  const sig = project.signature, bar = sig.beatsPerBar;
  // etichette ogni N battute, in modo che non si sovrappongano
  const labelEvery = [1, 2, 4, 8, 16, 32, 64].find(n => n * bar * geo.pxPerBeat >= 36) ?? 64;
  const step = Math.max(grid, 1 / 4);
  g.font = '10.5px system-ui, sans-serif';
  const first = Math.floor(geo.xToBeat(0) / step) * step;
  for (let b = first; geo.beatToX(b) < width; b += step) {
    const x = Math.round(geo.beatToX(b));
    const barIndex = b / bar;
    const isBar = Math.abs(barIndex - Math.round(barIndex)) < 1e-6;
    g.fillStyle = COLORS.rulerText;
    const tick = isBar ? height - RULER_LOOP_BAND : Number.isInteger(b) ? 6 : 3;
    g.fillRect(x, height - tick, 1, tick);
    if (isBar && Math.round(barIndex) % labelEvery === 0) g.fillText(String(Math.round(barIndex) + 1), x + 3, height - 5);
  }
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.fillRect(0, height - 1, width, 1);
}

/** Testina (mentre suona) e punto di partenza (cursore) sopra a tutto. */
export function paintPlayhead(g: CanvasRenderingContext2D, geo: TimelineGeometry, height: number, cursor: Beats, playhead: Beats | null): void {
  g.fillStyle = COLORS.cursor;
  g.fillRect(Math.round(geo.beatToX(cursor)), 0, 1, height);
  if (playhead !== null) {
    g.fillStyle = COLORS.playhead;
    g.fillRect(Math.round(geo.beatToX(playhead)) - 0.5, 0, 2, height);
  }
}

/** Anteprima di una clip durante un gesto. */
export function paintGhost(g: CanvasRenderingContext2D, geo: TimelineGeometry, trackIndex: number, start: Beats, end: Beats, color: string): void {
  const box = clipBox(geo, trackIndex, start, end);
  g.fillStyle = withAlpha(color, 0.45);
  roundRect(g, box);
  g.fill();
  g.strokeStyle = COLORS.ghost;
  g.stroke();
}

export function paintBox(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  g.fillStyle = COLORS.box;
  g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  g.strokeStyle = 'rgba(120,165,255,0.8)';
  g.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
}

function roundRect(g: CanvasRenderingContext2D, b: Box, r = 3): void {
  g.beginPath();
  g.roundRect(b.x, b.y, b.w, b.h, Math.min(r, b.w / 2));
}

export function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
