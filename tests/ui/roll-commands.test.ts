import { describe, expect, it } from 'vitest';
import type { ClipId } from '../../src/core/id';
import type { ClipLoop } from '../../src/model/clip';
import { MidiClip, type Note } from '../../src/model/midi-clip';
import type { MidiTrack } from '../../src/model/track';
import type { NoteChange, TimeRange } from '../../src/model/note-edits';
import { Clipboard } from '../../src/store/clipboard';
import type { ClipRef } from '../../src/store/clip-ref';
import type { Edit } from '../../src/store/project-store';
import { BeatAxis } from '../../src/ui/clip-editor/clip-geometry';
import { DrawMode } from '../../src/ui/draw-mode';
import { PitchAxis } from '../../src/ui/piano-roll/pitch-axis';
import { RollCommands } from '../../src/ui/piano-roll/roll-commands';
import { ROLL } from '../../src/ui/piano-roll/roll-painter';
import { fitRows, FOLD_ROW_MAX, followRows, instrumentLabel, NAMED_ROW, noteNames, sameNames } from '../../src/ui/piano-roll/roll-rows';
import { rollWheel, type RollWheelAt } from '../../src/ui/piano-roll/roll-wheel';
import type { WheelInput } from '../../src/ui/kit/wheel';
import { setup } from '../helpers/fixtures';

/** A clip of 8 beats looped whole: 60 at beat 1, 64 at beat 2 (velocity 80). Grid 0.25. */
function editor(opts: { clip?: boolean; pasteDevices?: boolean; fails?: boolean; loop?: ClipLoop } = {}) {
  const made = MidiClip.empty('c1' as ClipId, 'Clip', '#fff', 8).withNotes([
    { pitch: 60, start: 1, duration: 1, velocity: 100 }, { pitch: 64, start: 2, duration: 1, velocity: 80 },
  ]);
  const looped = opts.loop ? made.withLoop(opts.loop) : made;
  let clip: MidiClip | null = opts.clip === false ? null : looped;
  const said: string[] = [], labels: string[] = [], applied: string[] = [], heard: number[] = [], events: string[] = [];
  let selection = new Set<Note>(), time: TimeRange | null = null, insert: number | null = null, devices = 0;
  const clipboard = new Clipboard(), drawMode = new DrawMode();
  const commands = new RollCommands({
    clip: () => clip, selection: () => selection, time: () => time, insert: () => insert,
    grid: () => 0.25, noteLength: () => 0.5, clipboard, drawMode,
    pasteDevices: () => {
      if (opts.pasteDevices) devices++;
      return !!opts.pasteDevices;
    },
    commitNotes: (label: string, change: NoteChange) => {
      labels.push(label);
      clip = clip!.withNotes(change.notes);
      selection = new Set(change.selected);
      time = null;
    },
    select: (notes, t = null) => { selection = new Set(notes); time = t; },
    setInsertPoint: b => { insert = b; },
    audition: p => heard.push(p),
    say: t => said.push(t),
    apply: (label, edit: (ref: ClipRef) => Edit) => {
      if (opts.fails || !clip) return false;
      expect(edit({ kind: 'slot', track: 't', slot: 0 } as unknown as ClipRef)).toBeDefined();
      applied.push(label);
      return true;
    },
    refit: () => events.push('refit'),
    toggleFold: () => events.push('fold'),
    close: () => events.push('close'),
  });
  const note = (pitch: number) => clip!.notes.find(n => n.pitch === pitch)!;
  return {
    commands, said, labels, applied, heard, events, clipboard, drawMode, note,
    get clip() { return clip!; }, get selection() { return selection; }, get time() { return time; }, get insert() { return insert; },
    get devices() { return devices; },
    pick: (...pitches: number[]) => { selection = new Set(pitches.map(note)); },
  };
}

const notes = (c: MidiClip) => c.notes.map(n => [n.pitch, n.start, n.duration]);

describe('piano roll commands', () => {
  it('without a selection most commands do nothing; transpose moves all and selects none', () => {
    const e = editor();
    e.commands.deleteSelected();
    e.commands.duplicate();
    e.commands.nudge(1);
    expect(e.labels).toEqual([]);
    e.commands.transpose(1);
    expect(notes(e.clip)).toEqual([[61, 1, 1], [65, 2, 1]]);
    expect(e.selection.size).toBe(0);
    expect(e.heard).toEqual([]);
  });

  it('select all takes the loop as time selection (without loop the clip), Ctrl+D repeats it after', () => {
    const e = editor();
    e.commands.selectAll();
    expect(e.selection.size).toBe(2);
    expect(e.time).toEqual({ start: 0, end: 8 });
    e.commands.duplicate();
    expect(e.clip.notes).toHaveLength(4);
    expect(e.time).toEqual({ start: 8, end: 16 });
    const short = editor({ loop: { enabled: true, start: 1, end: 3 } });
    short.commands.selectAll();
    expect(short.time).toEqual({ start: 1, end: 3 });
    const free = editor({ loop: { enabled: false, start: 1, end: 3 } });
    free.commands.selectAll();
    expect(free.time).toEqual({ start: 0, end: 8 });
  });

  it('transpose of one note plays it; nudge by the grid; quantize; delete', () => {
    const e = editor();
    e.pick(60);
    e.commands.transpose(12);
    expect(e.heard).toEqual([72]);
    e.commands.nudge(-1);
    expect(e.note(72).start).toBe(0.75);
    e.commands.quantize();
    expect(e.labels).toEqual(['Transpose notes', 'Move notes', 'Quantize notes']);
    e.commands.deleteSelected();
    expect(notes(e.clip)).toEqual([[64, 2, 1]]);
  });

  it('copy and cut need a selection, and say what they did', () => {
    const e = editor();
    e.commands.copy();
    e.commands.cut();
    expect(e.said).toEqual(['Select some notes to copy.', 'Select some notes to cut.']);
    e.pick(60);
    e.commands.copy();
    expect(e.said[2]).toBe('Copied 1 note: Ctrl+V pastes it at the insertion point (click in empty space to choose it).');
    e.pick(60, 64);
    e.commands.copy();
    expect(e.said[3]).toMatch(/^Copied 2 notes: Ctrl\+V pastes them/);
    e.commands.cut();
    expect(e.clip.notes).toHaveLength(0);
    expect(e.clipboard.notes?.notes).toHaveLength(2);
  });

  it('paste: after the copied notes, then in a row; at the insertion point; at a beat', () => {
    const e = editor();
    e.pick(60);
    e.commands.copy();
    e.commands.paste();
    expect(e.note(60) && e.clip.notes.filter(n => n.pitch === 60).map(n => n.start)).toEqual([1, 2]);
    expect(e.insert).toBe(3);
    e.commands.paste();
    expect(e.clip.notes.filter(n => n.pitch === 60).map(n => n.start)).toEqual([1, 2, 3]);
    e.commands.paste(6);
    expect(e.insert).toBe(7);
    expect(e.commands.canPaste).toBe(true);
  });

  it('paste with nothing to paste says so; devices go to the track if the app can', () => {
    const e = editor();
    e.commands.paste();
    e.clipboard.content = { kind: 'clips' } as never;
    e.commands.paste();
    expect(e.said).toEqual(['The clipboard is empty.', 'The clipboard holds clips: paste them on the timeline.']);
    e.clipboard.content = { kind: 'devices' } as never;
    e.commands.paste();
    expect(e.said[2]).toBe('The clipboard is empty.');
    const d = editor({ pasteDevices: true });
    d.clipboard.content = { kind: 'devices' } as never;
    d.commands.paste();
    expect(d.devices).toBe(1);
    expect(d.said).toEqual([]);
    const none = editor({ clip: false });
    none.commands.paste();
    expect(none.said).toEqual([]);
  });

  it('length ×2 and :2, duplicate loop (framed again only if it worked)', () => {
    const e = editor();
    e.commands.scaleTime(2);
    e.commands.scaleTime(0.5);
    e.commands.duplicateLoop();
    expect(e.applied).toEqual(['Length ×2', 'Length :2', 'Duplicate loop']);
    expect(e.events).toEqual(['refit']);
    const f = editor({ fails: true });
    f.commands.duplicateLoop();
    expect(f.events).toEqual([]);
  });

  it('double click: a note at the start of the cell, played; on a note it goes; not while drawing', () => {
    const e = editor();
    e.commands.doubleClick({ kind: 'empty', beat: 3.3, pitch: 67 });
    expect(e.note(67)).toMatchObject({ start: 3.25, duration: 0.5, velocity: 100 });
    expect(e.heard).toEqual([67]);
    e.commands.doubleClick({ kind: 'note', note: e.note(60), zone: 'body' });
    expect(e.clip.notes.map(n => n.pitch)).toEqual([64, 67]);
    e.commands.doubleClick({ kind: 'lane' });
    e.drawMode.set(true);
    e.commands.doubleClick({ kind: 'empty', beat: 5, pitch: 50 });
    expect(e.labels).toEqual(['Add note', 'Delete note']);
    expect(e.commands.drawMode).toBe(true);
    e.commands.toggleDraw();
    expect(e.drawMode.on).toBe(false);
  });

  it('right click selects an unselected note (also on its velocity), not a selected one', () => {
    const e = editor();
    e.pick(60, 64);
    e.commands.pick({ kind: 'note', note: e.note(60), zone: 'body' });
    expect(e.selection.size).toBe(2);
    e.pick();
    e.commands.pick({ kind: 'velocity', note: e.note(64) });
    expect([...e.selection].map(n => n.pitch)).toEqual([64]);
    e.commands.pick({ kind: 'lane' });
    expect(e.selection.size).toBe(1);
  });

  it('Escape: first the selection, then the editor; F folds; the cell under a beat', () => {
    const e = editor();
    e.pick(60);
    e.commands.escape();
    expect(e.selection.size).toBe(0);
    e.commands.escape();
    e.commands.toggleFold();
    expect(e.events).toEqual(['close', 'fold']);
    expect(e.commands.cellStart(1.374)).toBe(1.25);
    expect(e.commands.cellStart(-3)).toBe(0);
  });
});

describe('piano roll rows', () => {
  it('without Fold the notes in the centre at 12 px; with names the rows grow to fit the pads', () => {
    const plain = fitRows([60, 64], null, false, 200);
    expect(plain.rowHeight).toBe(12);
    expect(plain.rows).toBeNull();
    expect(plain).toEqual(new PitchAxis(12, 0, ROLL.ruler).centeredOn(60, 64, 200));
    expect(fitRows([], null, false, 200)).toEqual(new PitchAxis(12, 0, ROLL.ruler).centeredOn(60, 72, 200));
    const names = new Map([[36, 'Kick'], [38, 'Snare']]);
    expect(fitRows([], names, false, 200).rowHeight).toBe(NAMED_ROW.max);
    expect(fitRows([36, 80], names, false, 200).rowHeight).toBe(NAMED_ROW.min);
  });

  it('with Fold only the notes\' rows, as tall as they fit', () => {
    const folded = fitRows([36, 42, 38], null, true, 300);
    expect(folded.rows).toEqual([42, 38, 36]);
    expect(folded.rowHeight).toBe(FOLD_ROW_MAX);
    expect(fitRows([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], null, true, 50).rowHeight).toBe(8);
    expect(fitRows([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], new Map([[1, 'a']]), true, 50).rowHeight).toBe(NAMED_ROW.min);
    expect(fitRows([], null, true, 300).rows).toBeNull();
  });

  it('Fold follows the notes: a new row, everything framed again, or nothing', () => {
    const folded = fitRows([36, 38], null, true, 300);
    expect(followRows(folded, [38, 36], true, 300)).toBeNull();
    expect((followRows(folded, [36, 38, 40], true, 300) as PitchAxis).rows).toEqual([40, 38, 36]);
    expect(followRows(folded, [], true, 300)).toBe('refit');
    expect(followRows(folded, [36], false, 300)).toBe('refit');
    expect(followRows(fitRows([36], null, false, 300), [40], false, 300)).toBeNull();
  });

  it('the pads\' names from the instrument, the instrument\'s label', () => {
    const { store } = setup({ midi: 1 });
    const track = store.project.tracks[0] as MidiTrack;
    expect(noteNames(track, store.project)).toBeNull();
    const drums = track.withInstrument({ type: 'drums', preset: null, params: {} } as never);
    expect(noteNames(drums, store.project)?.size).toBeGreaterThan(0);
    expect(instrumentLabel({ type: 'analog', preset: 'Init', params: {} })).toMatch(/ · Init$/);
    expect(instrumentLabel({ type: 'nope', params: {} } as never)).toBe('nope');
    const a = new Map([[1, 'a']]);
    expect(sameNames(a, new Map([[1, 'a']]))).toBe(true);
    expect(sameNames(a, new Map([[1, 'b']]))).toBe(false);
    expect(sameNames(a, null)).toBe(false);
    expect(sameNames(null, null)).toBe(true);
  });
});

describe('piano roll wheel', () => {
  const at = (over: Partial<RollWheelAt> = {}): RollWheelAt =>
    ({ axis: new BeatAxis(40, 2), pitches: new PitchAxis(10, 300, ROLL.ruler), x: 100, y: 150, notesHeight: 300, keys: false, ...over });
  const turn = (over: Partial<WheelInput>): WheelInput => ({ deltaX: 0, deltaY: 0, ctrl: false, shift: false, alt: false, ...over });
  const pitches = (m: ReturnType<typeof rollWheel>) => ('pitches' in m ? m.pitches : null);
  const axis = (m: ReturnType<typeof rollWheel>) => ('axis' in m ? m.axis : null);

  it('scrolls the rows; sideways or with Shift the time', () => {
    expect(pitches(rollWheel(turn({ deltaY: 40 }), at()))?.scrollY).toBe(340);
    expect(axis(rollWheel(turn({ deltaX: 80, deltaY: 10 }), at()))?.startBeat).toBe(4);
    expect(axis(rollWheel(turn({ deltaY: 40, shift: true }), at()))?.startBeat).toBe(3);
  });

  it('Ctrl zooms the time on the grid, the rows on the keys; Ctrl+Shift and Alt the rows', () => {
    expect(axis(rollWheel(turn({ deltaY: -100, ctrl: true }), at()))?.pxPerBeat).toBeCloseTo(40 * Math.exp(0.25), 9);
    for (const t of [turn({ deltaY: -100, ctrl: true }), turn({ deltaX: -100, ctrl: true, shift: true }), turn({ deltaY: -100, alt: true })]) {
      const keys = t.shift || t.alt ? false : true;
      expect(pitches(rollWheel(t, at({ keys })))?.rowHeight).toBeCloseTo(10 * Math.exp(0.2), 9);
    }
  });
});
