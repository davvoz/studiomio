import { describe, expect, it } from 'vitest';
import type { ClipId } from '../../src/core/id';
import { TimeSignature } from '../../src/core/music-time';
import { MidiClip, type Note } from '../../src/model/midi-clip';
import type { NoteChange, TimeRange } from '../../src/model/note-edits';
import { BeatAxis } from '../../src/ui/clip-editor/clip-geometry';
import { PitchAxis } from '../../src/ui/piano-roll/pitch-axis';
import {
  DrawNoteGesture, MarqueeGesture, MoveNotesGesture, ResizeNotesGesture, VelocityGesture, rollCursor, rollGestureFor, rollHit,
  type RollHit, type RollHost,
} from '../../src/ui/piano-roll/roll-gestures';
import { rollMenu, type RollMenuActions } from '../../src/ui/piano-roll/roll-menu';
import { paintRoll, ROLL } from '../../src/ui/piano-roll/roll-painter';
import type { MenuAction, MenuItem } from '../../src/ui/context-menu';
import type { Pointer } from '../../src/ui/kit/pointer';
import { fakeContext } from '../helpers/canvas';

const at = (x: number, y: number, mods: Partial<Pointer> = {}): Pointer => ({ x, y, shift: false, alt: false, ctrl: false, ...mods });

/** 40 px per beat, 10 px rows with pitch 60 at y 98–108 and 64 at 58–68; the velocity lane from y 336.
 *  Notes: 60 at beat 1 (1 long), 64 at beat 2 (1 long, velocity 80). */
function roll(opts: { draw?: boolean; step?: number | null } = {}) {
  const grid = opts.step === undefined ? 0.25 : opts.step;
  let clip = MidiClip.empty('c1' as ClipId, 'Clip', '#fff', 8).withNotes([
    { pitch: 60, start: 1, duration: 1, velocity: 100 }, { pitch: 64, start: 2, duration: 1, velocity: 80 },
  ]);
  const labels: string[] = [], auditions: number[] = [];
  let insert: number | null = null;
  const host: RollHost & { selection: Set<Note>; time: TimeRange | null } = {
    axis: new BeatAxis(40, 0), pitches: new PitchAxis(10, 600, ROLL.ruler), height: 400,
    selection: new Set<Note>(), time: null, noteLength: 0.25, drawMode: opts.draw ?? false,
    get timeSelection() { return this.time; },
    snapStep: p => (p.alt ? null : grid),
    select(notes, time = null) { this.selection = new Set(notes); this.time = time; },
    setInsertPoint: b => { insert = b; },
    commitNotes(label: string, change: NoteChange) { labels.push(label); clip = clip.withNotes(change.notes); this.selection = new Set(change.selected); },
    audition: p => auditions.push(p),
    commit: () => {}, seekContent: () => {}, setAxis: () => {}, invalidate: () => {},
  };
  const note = (pitch: number) => clip.notes.find(n => n.pitch === pitch)!;
  return { host, labels, auditions, note, get clip() { return clip; }, get insert() { return insert; } };
}

describe('piano roll: what is under the pointer', () => {
  it('ruler, note body and edges, empty space, velocity bars, the bare lane', () => {
    const r = roll();
    const hit = (x: number, y: number) => rollHit(r.host, r.clip, x, y);
    expect(hit(60, 5).kind).toBe('loop');
    expect(hit(60, 100)).toMatchObject({ kind: 'note', zone: 'body' });
    expect(hit(78, 100)).toMatchObject({ kind: 'note', zone: 'end' });
    expect(hit(42, 100)).toMatchObject({ kind: 'note', zone: 'start' });
    expect(hit(200, 100)).toEqual({ kind: 'empty', beat: 5, pitch: 60 });
    expect(hit(60, 90)).toMatchObject({ kind: 'empty', pitch: 61 });
    expect(hit(41, 350)).toMatchObject({ kind: 'velocity', note: r.note(60) });
    expect(hit(600, 350)).toEqual({ kind: 'lane' });
  });

  it('each thing starts its gesture and shows its cursor', () => {
    const r = roll(), draw = roll({ draw: true });
    const noteHit = (zone: 'body' | 'start' | 'end'): Extract<RollHit, { kind: 'note' }> => ({ kind: 'note', note: r.note(60), zone });
    expect(rollGestureFor.note(r.host, r.clip, noteHit('body'), at(60, 100))).toBeInstanceOf(MoveNotesGesture);
    expect(rollGestureFor.note(r.host, r.clip, noteHit('end'), at(78, 100))).toBeInstanceOf(ResizeNotesGesture);
    expect(rollGestureFor.empty(r.host, r.clip, { kind: 'empty', beat: 5, pitch: 60 }, at(200, 100))).toBeInstanceOf(MarqueeGesture);
    expect(rollGestureFor.empty(draw.host, draw.clip, { kind: 'empty', beat: 5, pitch: 60 }, at(200, 100))).toBeInstanceOf(DrawNoteGesture);
    expect(rollGestureFor.velocity(r.host, r.clip, { kind: 'velocity', note: r.note(60) }, at(41, 350))).toBeInstanceOf(VelocityGesture);
    expect(rollGestureFor.lane(r.host, r.clip, { kind: 'lane' }, at(600, 350)).cursor).toBe('default');
    const erase = rollGestureFor.note(draw.host, draw.clip, { kind: 'note', note: draw.note(60), zone: 'body' }, at(60, 100));
    erase.end(at(60, 100));
    expect(draw.labels).toEqual(['Delete note']);
    expect(draw.clip.notes).toHaveLength(1);
    expect([
      rollCursor.note(noteHit('body'), false), rollCursor.note(noteHit('body'), true), rollCursor.note(noteHit('end'), false),
      rollCursor.empty({ kind: 'empty', beat: 0, pitch: 0 }, true), rollCursor.empty({ kind: 'empty', beat: 0, pitch: 0 }, false),
      rollCursor.velocity({ kind: 'velocity', note: r.note(60) }, false), rollCursor.lane({ kind: 'lane' }, false),
    ]).toEqual(['grab', 'not-allowed', 'ew-resize', 'crosshair', 'default', 'ns-resize', 'default']);
  });
});

describe('piano roll: gestures', () => {
  it('dragging a note moves it on the grid and up, auditioning the new pitch; Ctrl copies', () => {
    const r = roll();
    const g = new MoveNotesGesture(r.host, r.clip, r.note(60), at(60, 100));
    g.move(at(61, 100));
    expect(g.previewSelection()).toBeNull();
    expect(g.preview(r.clip)).toBe(r.clip);
    g.move(at(100, 80));
    expect(g.preview(r.clip).notes.map(n => [n.pitch, n.start])).toContainEqual([62, 2]);
    expect(g.previewSelection()!.size).toBe(1);
    g.end();
    expect(r.labels).toEqual(['Move notes']);
    expect(r.auditions).toEqual([60, 62]);
    const copy = new MoveNotesGesture(r.host, r.clip, r.note(62), at(100, 80, { ctrl: true }));
    copy.move(at(180, 80));
    copy.cancel();
    copy.move(at(180, 80));
    copy.end();
    expect(r.labels.at(-1)).toBe('Copy notes');
    expect(r.clip.notes).toHaveLength(3);
  });

  it('Shift takes a note out of the selection (then nothing moves); a click in a selection keeps only it', () => {
    const r = roll();
    r.host.select(r.clip.notes);
    const out = new MoveNotesGesture(r.host, r.clip, r.note(60), at(60, 100, { shift: true }));
    expect(r.host.selection.has(r.note(60))).toBe(false);
    out.move(at(120, 100));
    out.end();
    const added = new MoveNotesGesture(r.host, r.clip, r.note(60), at(60, 100, { shift: true }));
    added.end();
    expect(r.host.selection.size).toBe(2);
    new MoveNotesGesture(r.host, r.clip, r.note(60), at(60, 100)).end();
    expect([...r.host.selection]).toEqual([r.note(60)]);
    expect(r.labels).toEqual([]);
  });

  it('an edge resizes the selected notes and remembers the length for new ones', () => {
    const r = roll();
    const g = new ResizeNotesGesture(r.host, r.clip, r.note(60), 'end', at(78, 100));
    g.end();
    g.move(at(79, 100));
    expect(g.previewSelection()).toBeNull();
    g.move(at(118, 100));
    expect(g.preview(r.clip).notes[0].duration).toBe(2);
    expect(g.previewSelection()!.size).toBe(1);
    g.end();
    expect(r.host.noteLength).toBe(2);
    g.cancel();
    expect(g.preview(r.clip)).toBe(r.clip);
    expect(r.labels).toEqual(['Note length']);
  });

  it('a box selects the notes with its time range on the grid; Shift adds to both; a click sets the insert point', () => {
    const r = roll();
    const box = new MarqueeGesture(r.host, r.clip, at(30, 50));
    const ctx = fakeContext();
    box.paint(ctx);
    expect(ctx.calls).toHaveLength(0);
    box.move(at(85, 105));
    box.paint(ctx);
    expect(ctx.calls).toContain('fillRect');
    expect(box.previewSelection()!.size).toBe(2);
    expect(box.preview(r.clip)).toBe(r.clip);
    box.end();
    expect(r.host.time).toEqual({ start: 0.75, end: 2.25 });
    const more = new MarqueeGesture(r.host, r.clip, at(300, 100, { shift: true }));
    more.move(at(330, 120, { shift: true }));
    more.end();
    expect(r.host.time).toEqual({ start: 0.75, end: 8.25 });
    expect(r.host.selection.size).toBe(2);
    const click = new MarqueeGesture(r.host, r.clip, at(205, 100));
    click.move(at(206, 100));
    click.end();
    click.cancel();
    expect(r.insert).toBe(5.25);
    expect(r.host.selection.size).toBe(0);
    const free = roll({ step: null });
    const loose = new MarqueeGesture(free.host, free.clip, at(30, 50));
    loose.move(at(85, 105));
    loose.end();
    expect(free.host.time).toEqual({ start: 0.75, end: 2.125 });
  });

  it('draw mode: a click adds a note on the grid, dragging lengthens it', () => {
    const r = roll({ draw: true });
    const g = new DrawNoteGesture(r.host, r.clip, 70, at(205, 100));
    expect(g.preview(r.clip).notes).toHaveLength(3);
    expect(g.previewSelection()!.size).toBe(1);
    g.move(at(290, 100));
    g.move(at(290, 100, { alt: true }));
    g.cancel();
    g.end();
    expect(r.clip.notes.find(n => n.pitch === 70)).toMatchObject({ start: 5, duration: 2.25 });
    expect(r.host.noteLength).toBe(2.25);
    expect(r.auditions).toEqual([70]);
  });

  it('a velocity bar dragged up raises the velocity', () => {
    const r = roll();
    const g = new VelocityGesture(r.host, r.clip, r.note(64), at(81, 380));
    g.end();
    expect(g.preview(r.clip)).toBe(r.clip);
    expect(g.previewSelection()).toBeNull();
    g.move(at(81, 353));
    expect(g.previewSelection()!.size).toBe(1);
    g.end();
    expect(r.note(64).velocity).toBeGreaterThan(80);
    g.cancel();
    new VelocityGesture(r.host, r.clip, r.note(60), at(41, 380, { shift: true }));
    expect(r.labels).toEqual(['Velocity']);
  });
});

describe('piano roll: menu and painting', () => {
  const actions = (over: Partial<RollMenuActions> = {}) => {
    const called: string[] = [];
    const record = (name: string) => (...a: unknown[]) => { called.push([name, ...a].join(' ')); };
    const r: RollMenuActions = {
      canPaste: true, drawMode: false, selection: new Set([1, 2]),
      cut: record('cut'), copy: record('copy'), paste: record('paste'), duplicate: record('duplicate'), duplicateLoop: record('duplicateLoop'),
      deleteSelected: record('delete'), quantize: record('quantize'), transpose: record('transpose'), selectAll: record('selectAll'),
      toggleDraw: record('toggleDraw'), cellStart: b => Math.floor(b), ...over,
    };
    return { r, called };
  };
  const run = (items: MenuItem[]) => items.filter((i): i is MenuAction => typeof i === 'object' && 'label' in i).forEach(i => i.run());
  const labels = (items: MenuItem[]) => items.filter((i): i is MenuAction => typeof i === 'object' && 'label' in i).map(i => i.label);

  it('on notes, on empty space, elsewhere', () => {
    const { r, called } = actions();
    const note = { kind: 'note', note: {} as Note, zone: 'body' } as RollHit;
    expect(labels(rollMenu(r, note)).at(-1)).toBe('Delete (2 notes)');
    run(rollMenu(r, note));
    run(rollMenu(r, { kind: 'empty', beat: 3.7, pitch: 60 }));
    for (const kind of ['velocity', 'lane', 'ruler'] as const) run(rollMenu(r, (kind === 'velocity' ? { kind, note: {} as Note } : { kind }) as RollHit));
    run(rollMenu(r, { kind: 'loop', part: 'body' }));
    run(rollMenu(r, { kind: 'flag', edge: 'start' }));
    expect(called).toEqual(expect.arrayContaining(['cut', 'transpose 12', 'transpose -12', 'paste 3', 'quantize', 'toggleDraw', 'duplicateLoop']));
    expect(labels(rollMenu(actions({ selection: new Set([1]) }).r, note)).at(-1)).toBe('Delete');
  });

  it('paints rows, notes, velocity, the selection, the insert point and the playhead', () => {
    const r = roll();
    const base = {
      width: 600, height: 400, axis: r.host.axis, clip: r.clip.withRegion({ start: 0, end: 1.5 }), signature: TimeSignature.COMMON, grid: 0.25,
      selection: new Set([r.note(60)]),
    };
    const g = fakeContext();
    paintRoll({ ...base, g, pitches: r.host.pitches, playhead: 1.5, insert: 2, time: { start: 1, end: 3 }, named: null });
    paintRoll({ ...base, g, pitches: new PitchAxis(10, 0, ROLL.ruler, [64, 62, 60]), playhead: null, insert: null, time: null, named: new Map([[60, 'Kick']]) });
    paintRoll({ ...base, g, axis: new BeatAxis(40, 50), pitches: r.host.pitches, playhead: null, insert: null, time: null, named: null });
    expect(g.calls.filter(c => c === 'strokeRect').length).toBeGreaterThanOrEqual(4);
  });
});
