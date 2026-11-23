import { describe, expect, it } from 'vitest';
import type { PlacementId, TrackId } from '../../src/core/id';
import type { AudioClip } from '../../src/model/audio-clip';
import { MidiClip } from '../../src/model/midi-clip';
import type { Project } from '../../src/model/project';
import { addMidiClip, addTrack, groupTracks, placeSample, resizePlacement, setGroupFolded, setLoopRegion, updateClip } from '../../src/store/edits';
import type { Peaks } from '../../src/ui/waveform';
import { CLIP_HEADER, FADE_HANDLE_PX, TimelineGeometry } from '../../src/ui/timeline/geometry';
import {
  clipBox, COLORS, paintBox, paintGhost, paintLanes, paintPlayhead, paintRuler, RULER, rulerZoneAt, withAlpha, type LanePaint,
} from '../../src/ui/timeline/painters';
import { setup } from '../helpers/fixtures';

interface Call {
  readonly op: string;
  readonly args: readonly unknown[];
  readonly fill: string;
  readonly stroke: string;
}

/** A CanvasRenderingContext2D that records every call with the styles in force at that moment. */
class FakeCtx {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  font = '';
  readonly calls: Call[] = [];
  private record(op: string, args: unknown[]) { this.calls.push({ op, args, fill: this.fillStyle, stroke: this.strokeStyle }); }
  save(...a: unknown[]) { this.record('save', a); }
  restore(...a: unknown[]) { this.record('restore', a); }
  beginPath(...a: unknown[]) { this.record('beginPath', a); }
  closePath(...a: unknown[]) { this.record('closePath', a); }
  clip(...a: unknown[]) { this.record('clip', a); }
  fill(...a: unknown[]) { this.record('fill', a); }
  stroke(...a: unknown[]) { this.record('stroke', a); }
  moveTo(...a: unknown[]) { this.record('moveTo', a); }
  lineTo(...a: unknown[]) { this.record('lineTo', a); }
  roundRect(...a: unknown[]) { this.record('roundRect', a); }
  strokeRect(...a: unknown[]) { this.record('strokeRect', a); }
  fillRect(...a: unknown[]) { this.record('fillRect', a); }
  fillText(...a: unknown[]) { this.record('fillText', a); }
  of(op: string) { return this.calls.filter(c => c.op === op); }
  rects(fill?: string) { return this.of('fillRect').filter(c => fill === undefined || c.fill === fill).map(c => c.args as number[]); }
  texts() { return this.of('fillText').map(c => c.args[0]); }
}

const newCtx = () => new FakeCtx();
const asCtx = (g: FakeCtx) => g as unknown as CanvasRenderingContext2D;

function lanePaint(project: Project, over: Partial<LanePaint> = {}): LanePaint {
  return {
    project, geo: new TimelineGeometry(24, 0, 0, 72), width: 480, height: 300, grid: 1,
    selection: new Set(), range: null, hovered: null, peaks: () => null, hidden: new Set(), taken: new Set(), selectedTracks: new Set(),
    ...over,
  };
}

/** A midi track with a clip of notes (2 beats from beat 2) and an audio track with a sample (4 s = 8 beats at 120). */
function rig() {
  const r = setup({ midi: 1, sample: true });
  r.store.apply(addTrack('audio'));
  r.store.apply(addMidiClip(r.track(0), 2, 4));
  const pl = r.store.project.tracks[0].arrangement[0];
  r.store.apply(updateClip<MidiClip>('notes', r.track(0), pl.id, c => c.addingNotes(
    { pitch: 60, start: 0, duration: 1, velocity: 100 }, { pitch: 72, start: 1, duration: 0.5, velocity: 100 })));
  r.store.apply(placeSample(r.track(1), r.sampleId, 0));
  return { ...r, midi: () => r.store.project.tracks[0].arrangement[0], audio: () => r.store.project.tracks[1].arrangement[0] };
}

describe('colour helper', () => {
  it('withAlpha turns #rrggbb into rgba', () => {
    expect(withAlpha('#ff8000', 0.5)).toBe('rgba(255,128,0,0.5)');
    expect(withAlpha('#000001', 1)).toBe('rgba(0,0,1,1)');
  });
});

describe('ruler zones', () => {
  it('numbers on top, then the loop band, then the scrub area', () => {
    expect(rulerZoneAt(0)).toBe('numbers');
    expect(rulerZoneAt(RULER.numbers - 1)).toBe('numbers');
    expect(rulerZoneAt(RULER.numbers)).toBe('loop');
    expect(rulerZoneAt(RULER.numbers + RULER.loop - 1)).toBe('loop');
    expect(rulerZoneAt(RULER.numbers + RULER.loop)).toBe('scrub');
  });
});

describe('clip boxes and overlays', () => {
  it('clipBox maps beats and tracks to pixels with a minimum width', () => {
    const geo = new TimelineGeometry(24, 1, 10, 72);
    expect(clipBox(geo, 1, 3, 5)).toEqual({ x: 48, y: 72 - 10 + 2, w: 48, h: 67 });
    expect(clipBox(geo, 0, 3, 3).w).toBe(2);
  });

  it('the cursor is drawn, the playhead only while playing', () => {
    const geo = new TimelineGeometry(24, 0);
    const g = newCtx();
    paintPlayhead(asCtx(g), geo, 100, 2, null);
    expect(g.rects()).toEqual([[48, 0, 1, 100]]);
    expect(g.of('fillRect')[0].fill).toBe(COLORS.cursor);
    const p = newCtx();
    paintPlayhead(asCtx(p), geo, 100, 2, 4);
    expect(p.rects(COLORS.playhead)).toEqual([[95.5, 0, 2, 100]]);
  });

  it('the selection box is normalised whatever the drag direction', () => {
    const g = newCtx();
    paintBox(asCtx(g), 50, 40, 10, 20);
    expect(g.rects(COLORS.box)).toEqual([[10, 20, 40, 20]]);
    expect(g.of('strokeRect')[0].args).toEqual([10.5, 20.5, 40, 20]);
  });

  it('the ghost of a clip is a translucent rounded box in the clip colour', () => {
    const g = newCtx();
    paintGhost(asCtx(g), new TimelineGeometry(24, 0), 1, 0, 2, '#102030');
    const [round] = g.of('roundRect');
    expect(round.args.slice(0, 4)).toEqual([0, 72 + 2, 48, 67]);
    expect(g.of('fill')[0].fill).toBe(withAlpha('#102030', 0.45));
    expect(g.of('stroke')[0].stroke).toBe(COLORS.ghost);
  });
});

describe('paintLanes', () => {
  it('fills the background and alternates the lanes', () => {
    const r = rig();
    const g = newCtx();
    paintLanes(asCtx(g), lanePaint(r.store.project));
    expect(g.rects(COLORS.bg)[0]).toEqual([0, 0, 480, 300]);
    // the second lane (index 1) gets the alternate colour at its own top
    expect(g.rects(COLORS.laneAlt)).toContainEqual([0, 72, 480, 72]);
    expect(g.rects(COLORS.laneAlt).some(([, y]) => y === 0)).toBe(false);
    // a separator line closes each lane
    expect(g.rects('rgba(0,0,0,0.35)')).toEqual([[0, 71, 480, 1], [0, 143, 480, 1]]);
  });

  it('draws bar lines stronger than beat lines, at the right x', () => {
    const r = rig();
    const g = newCtx();
    paintLanes(asCtx(g), lanePaint(r.store.project, { grid: 1 }));
    const bars = g.rects(COLORS.bar).map(a => a[0]);
    const beats = g.rects(COLORS.grid).map(a => a[0]);
    expect(bars).toEqual([0, 96, 192, 288, 384]);
    expect(beats).toContain(24);
    expect(beats).not.toContain(96);
  });

  it('shades an enabled loop only', () => {
    const r = rig();
    const off = newCtx();
    paintLanes(asCtx(off), lanePaint(r.store.project));
    expect(off.rects(COLORS.loopShade)).toEqual([]);
    r.store.apply(setLoopRegion({ enabled: true, start: 1, end: 3 }));
    const on = newCtx();
    paintLanes(asCtx(on), lanePaint(r.store.project));
    expect(on.rects(COLORS.loopShade)).toEqual([[24, 0, 48, 300]]);
  });

  it('draws a MIDI clip: header, body, notes placed by pitch, label', () => {
    const r = rig();
    const g = newCtx();
    paintLanes(asCtx(g), lanePaint(r.store.project));
    const color = r.midi().clip.color;
    const header = g.rects(color).find(([x, y, , h]) => x === 48 && y === 2 && h === CLIP_HEADER);
    expect(header).toBeDefined();
    expect(header![2]).toBe(96);
    expect(g.texts()).toContain(r.midi().clip.name);
    // the two notes are drawn in the clip colour, the higher one above the lower one
    const body = g.rects(withAlpha(color, 0.95)).filter(([x]) => x >= 48);
    expect(body).toHaveLength(2);
    const [low, high] = body[0][1] > body[1][1] ? [body[0], body[1]] : [body[1], body[0]];
    expect(high[1]).toBeLessThan(low[1]);
    // a note starting at beat 2 of the timeline (clip start) is at x = 48
    expect(body.map(b => b[0]).sort((a, b) => a - b)[0]).toBe(48);
  });

  it('hidden clips are skipped and taken tracks are covered by a veil', () => {
    const r = rig();
    const hidden = newCtx();
    paintLanes(asCtx(hidden), lanePaint(r.store.project, { hidden: new Set([r.midi().id]) }));
    expect(hidden.texts()).not.toContain(r.midi().clip.name);
    const taken = newCtx();
    paintLanes(asCtx(taken), lanePaint(r.store.project, { taken: new Set<TrackId>([r.track(1)]) }));
    expect(taken.rects('rgba(18, 20, 23, 0.62)')).toEqual([[0, 72, 480, 71]]);
  });

  it('colours the lanes of selected tracks and skips lanes outside the canvas', () => {
    const r = rig();
    const g = newCtx();
    paintLanes(asCtx(g), lanePaint(r.store.project, { selectedTracks: new Set<TrackId>([r.track(0)]) }));
    expect(g.rects(withAlpha(r.store.project.tracks[0].color, 0.1))).toEqual([[0, 0, 480, 72]]);
    const small = newCtx();
    paintLanes(asCtx(small), lanePaint(r.store.project, { height: 50 }));
    // the second lane starts below the canvas
    expect(small.rects('rgba(0,0,0,0.35)')).toHaveLength(1);
    const scrolled = newCtx();
    paintLanes(asCtx(scrolled), lanePaint(r.store.project, { geo: new TimelineGeometry(24, 0, 100, 72) }));
    expect(scrolled.rects('rgba(0,0,0,0.35)')).toHaveLength(1);
  });

  it('a selected clip gets an outline and, with a range, only that part is highlighted', () => {
    const r = rig();
    const whole = newCtx();
    paintLanes(asCtx(whole), lanePaint(r.store.project, { selection: new Set<PlacementId>([r.midi().id]) }));
    expect(whole.of('stroke').some(c => c.stroke === COLORS.select)).toBe(true);
    expect(whole.rects('rgba(255,255,255,0.16)')).toEqual([]);
    const ranged = newCtx();
    paintLanes(asCtx(ranged), lanePaint(r.store.project, { selection: new Set<PlacementId>([r.midi().id]), range: { start: 3, end: 4 } }));
    expect(ranged.rects('rgba(255,255,255,0.16)')).toEqual([[72, 2, 24, 67]]);
  });

  it('draws the fade handles of a selected audio clip, in white squares at the top', () => {
    const r = rig();
    const g = newCtx();
    paintLanes(asCtx(g), lanePaint(r.store.project, { selection: new Set<PlacementId>([r.audio().id]) }));
    const handles = g.rects(COLORS.select);
    expect(handles).toHaveLength(2);
    for (const h of handles) expect(h.slice(2)).toEqual([FADE_HANDLE_PX, FADE_HANDLE_PX]);
    // a hovered clip shows them too; an unselected, unhovered one does not
    const hover = newCtx();
    paintLanes(asCtx(hover), lanePaint(r.store.project, { hovered: r.audio().id }));
    expect(hover.rects(COLORS.select)).toHaveLength(2);
    const none = newCtx();
    paintLanes(asCtx(none), lanePaint(r.store.project));
    expect(none.rects(COLORS.select)).toHaveLength(0);
  });

  it('draws an audio waveform from the peaks through the clip gain, and nothing without peaks', () => {
    const r = rig();
    const asked: [number, number][] = [];
    const peaks = { range: (a: number, b: number) => { asked.push([a, b]); return [-0.5, 0.5]; } } as unknown as Peaks;
    const g = newCtx();
    paintLanes(asCtx(g), lanePaint(r.store.project, { peaks: (_c: AudioClip) => peaks }));
    const color = r.audio().clip.color;
    const columns = g.rects(withAlpha(color, 0.95)).filter(a => a[2] === 1);
    expect(columns.length).toBeGreaterThan(100);
    // each column spans symmetric about the middle of the body, at least a pixel tall
    for (const [, , , h] of columns) expect(h).toBeGreaterThanOrEqual(1);
    expect(columns[0][1] + columns[0][3] / 2).toBeCloseTo(72 + 2 + CLIP_HEADER + (67 - CLIP_HEADER) / 2, 6);
    // the first column asks for the first instant of the sample
    expect(asked[0][0]).toBeCloseTo(0, 6);
    const empty = newCtx();
    paintLanes(asCtx(empty), lanePaint(r.store.project));
    expect(empty.rects(withAlpha(color, 0.95)).filter(a => a[2] === 1)).toHaveLength(0);
  });

  it('draws the fades as shaded wedges with a line, one per fade', () => {
    const r = rig();
    const pl = r.audio();
    const edit = (patch: object) => ({ ...r.store.project.tracks[1], arrangement: [{ ...pl, ...patch }] });
    const withFades = (patch: object): Project => {
      const p = r.store.project;
      return Object.create(p, { visibleTracks: { get: () => [p.tracks[0], edit(patch)] } }) as Project;
    };
    const both = newCtx();
    paintLanes(asCtx(both), lanePaint(withFades({ fadeIn: 1, fadeOut: 2 })));
    expect(both.of('fill').filter(c => c.fill === 'rgba(0,0,0,0.4)')).toHaveLength(2);
    expect(both.of('stroke').filter(c => c.stroke === 'rgba(255,255,255,0.75)')).toHaveLength(2);
    const one = newCtx();
    paintLanes(asCtx(one), lanePaint(withFades({ fadeIn: 1 })));
    expect(one.of('fill').filter(c => c.fill === 'rgba(0,0,0,0.4)')).toHaveLength(1);
    // the wedge goes from the top-left corner to the end of the fade
    const move = one.of('moveTo')[0].args as number[];
    const line = one.of('lineTo')[0].args as number[];
    expect(line[0] - move[0]).toBeCloseTo(24, 6);
  });

  it('shows the transpose in the label of an audio clip and the seams of a looping clip', () => {
    const r = rig();
    const pl = r.audio();
    const clip = Object.create(pl.clip, { transpose: { value: 3 }, pitch: { value: 3 } });
    const p = r.store.project;
    const project = Object.create(p, { visibleTracks: { get: () => [p.tracks[0], { ...p.tracks[1], arrangement: [{ ...pl, clip }] }] } }) as Project;
    const g = newCtx();
    paintLanes(asCtx(g), lanePaint(project));
    expect(g.texts()).toContain(`${pl.clip.name}  +3 st`);
  });

  it('a clip looped over a longer placement draws dashed seams at each restart', () => {
    const r = rig();
    r.store.apply(resizePlacement(r.track(0), r.midi().id, { end: 14 }));
    const g = newCtx();
    paintLanes(asCtx(g), lanePaint(r.store.project, { width: 600 }));
    // the 4-beat loop placed at beat 2 restarts at beats 6 and 10: x = 144 and 240
    const dashes = g.rects('rgba(0,0,0,0.45)');
    expect([...new Set(dashes.map(d => d[0]))]).toEqual([144, 240]);
    for (const [, , w, h] of dashes) expect([w, h]).toEqual([1, 2]);
  });

  it('a group lane summarises the clips of its tracks as small strips in their colour', () => {
    const r = setup({ midi: 2 });
    const members = [r.track(0), r.track(1)];
    r.store.apply(addMidiClip(members[0], 0, 4));
    r.store.apply(addMidiClip(members[1], 4, 4));
    r.store.apply(groupTracks(members));
    const project = r.store.project;
    const groupId = project.tracks.find(t => t.kind === 'group')!.id;
    const g = newCtx();
    paintLanes(asCtx(g), lanePaint(project));
    const strips = g.of('fillRect').filter(c => c.fill.startsWith('rgba') && c.fill.endsWith(',0.8)'));
    expect(strips).toHaveLength(2);
    // a closed group still shows them
    r.store.apply(setGroupFolded(groupId, true));
    const folded = newCtx();
    paintLanes(asCtx(folded), lanePaint(r.store.project));
    expect(folded.of('fillRect').filter(c => c.fill.endsWith(',0.8)'))).toHaveLength(2);
    // taken member tracks are shown fainter
    const taken = newCtx();
    paintLanes(asCtx(taken), lanePaint(r.store.project, { taken: new Set<TrackId>(members) }));
    expect(taken.of('fillRect').filter(c => c.fill.endsWith(',0.3)'))).toHaveLength(2);
  });
});

describe('paintRuler', () => {
  it('draws the bar numbers every few bars, bar lines and beat ticks', () => {
    const r = rig();
    const g = newCtx();
    paintRuler(asCtx(g), r.store.project, new TimelineGeometry(24, 0), 400, 44, 1);
    // 4 beats a bar at 24 px/beat: 96 px, labels on every bar
    expect(g.texts()).toEqual(['1', '2', '3', '4', '5']);
    expect(g.of('fillText').map(c => c.args[1])).toEqual([3, 99, 195, 291, 387]);
    const barLines = g.rects(COLORS.rulerText).filter(a => a[3] === RULER.numbers);
    expect(barLines.map(a => a[0])).toEqual([0, 96, 192, 288, 384]);
    const ticks = g.rects(COLORS.rulerText).filter(a => a[3] === 5 || a[3] === 3);
    expect(ticks.length).toBeGreaterThan(10);
    // a beat is a taller tick than a sub-beat
    expect(g.rects(COLORS.rulerText)).toContainEqual([24, 39, 1, 5]);
  });

  it('thins the labels when zoomed out so they do not overlap', () => {
    const r = rig();
    const g = newCtx();
    paintRuler(asCtx(g), r.store.project, new TimelineGeometry(4, 0), 800, 44, 4);
    // 16 px a bar: a label every 4 bars (64 px)
    expect(g.texts().slice(0, 3)).toEqual(['1', '5', '9']);
  });

  it('the loop band takes the active colour only when the loop is on', () => {
    const r = rig();
    const off = newCtx();
    paintRuler(asCtx(off), r.store.project, new TimelineGeometry(24, 0), 400, 44, 1);
    expect(off.rects(COLORS.loopOff)).toEqual([[0, RULER.numbers + 1, 384, RULER.loop - 2]]);
    r.store.apply(setLoopRegion({ enabled: true, start: 4, end: 8 }));
    const on = newCtx();
    paintRuler(asCtx(on), r.store.project, new TimelineGeometry(24, 0), 400, 44, 1);
    expect(on.rects(COLORS.loop)).toEqual([[96, RULER.numbers + 1, 96, RULER.loop - 2]]);
  });
});
