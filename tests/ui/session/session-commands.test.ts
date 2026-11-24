import { describe, expect, it } from 'vitest';
import type { ClipId, TrackId } from '../../../src/core/id';
import { Clipboard } from '../../../src/store/clipboard';
import type { ClipRef } from '../../../src/store/clip-ref';
import { moveSlots, newSlotMidiClip, type SlotRef } from '../../../src/store/session-edits';
import { findBinding } from '../../../src/ui/keymap';
import {
  SESSION_KEYS, SessionCommands, copiedMessage, editFailure, type SessionControls, type SlotRecorder,
} from '../../../src/ui/session/session-commands';
import { SlotSelection } from '../../../src/ui/session/slot-selection';
import { UiState } from '../../../src/ui/ui-state';
import { setup } from '../../helpers/fixtures';

class FakeRecorder implements SlotRecorder {
  slot: { track: TrackId; slot: number } | null = null;
  readonly toggled: SlotRef[] = [];
  recordingSlot(track: TrackId) { return this.slot?.track === track ? this.slot.slot : null; }
  toggle(ref: SlotRef) { this.toggled.push(ref); }
  onChange() { return () => {}; }
}

/** One audio track (column 0) and two MIDI tracks (columns 1, 2), clips at `clips` (MIDI columns). */
function harness(clips: readonly [number, number][] = []) {
  const { store, track } = setup({ audio: 1, midi: 2 });
  for (const [t, slot] of clips) store.apply(newSlotMidiClip({ track: track(t), slot }));
  const launched: [TrackId, number][] = [], said: string[] = [], opened: ClipRef[] = [];
  let playing = new Map<TrackId, ClipId>(), focused = 0, devicesPasted = 0;
  const engine = { launchSlot: (t: TrackId, s: number) => { launched.push([t, s]); }, playingClips: () => playing };
  const clipboard = new Clipboard(), recorder = new FakeRecorder(), ui = new UiState();
  const selection = new SlotSelection(() => store.project);
  const commands = new SessionCommands({
    store, engine, clipboard, recorder, ui,
    openClip: r => opened.push(r), pasteDevices: () => { devicesPasted++; }, say: t => said.push(t),
  }, selection, { focus: () => { focused++; } });
  const ref = (t: number, slot: number): SlotRef => ({ track: track(t), slot });
  const clipAt = (t: number, slot: number) => store.project.track(track(t))!.slots[slot];
  return {
    store, commands, selection, clipboard, recorder, ui, launched, said, opened, ref, clipAt,
    setPlaying: (m: Map<TrackId, ClipId>) => { playing = m; },
    get focused() { return focused; },
    get devicesPasted() { return devicesPasted; },
  };
}

describe('session commands: messages', () => {
  it('a change refused because of the track kind says so; other errors give their message', () => {
    expect(editFailure(new TypeError('x'))).toMatch(/same kind/);
    expect(editFailure(new Error('boom'))).toBe('boom');
    expect(editFailure('plain')).toBe('plain');
  });

  it('copied: one clip or many', () => {
    expect(copiedMessage(1)).toMatch(/^Clip copied: Ctrl\+V pastes it/);
    expect(copiedMessage(3)).toMatch(/^3 clips copied: Ctrl\+V pastes them/);
  });
});

describe('SessionCommands', () => {
  it('apply reports a failed change in the status bar', () => {
    const h = harness([[1, 0]]);
    expect(h.commands.apply(moveSlots([h.ref(1, 0)], -1, 0, false))).toBe(false);
    expect(h.said.at(-1)).toMatch(/same kind/);
    expect(h.clipAt(1, 0)).not.toBeNull();
  });

  it('launch: the cursor\'s slot, or every chosen clip', () => {
    const h = harness([[1, 0], [2, 1]]);
    h.commands.launchSelected();
    expect(h.launched).toEqual([]);
    h.selection.select(h.ref(1, 3));
    h.commands.launchSelected();
    expect(h.launched).toEqual([[h.ref(1, 3).track, 3]]);
    h.selection.selectAll();
    h.commands.launchSelected();
    expect(h.launched.slice(1)).toEqual([[h.ref(1, 0).track, 0], [h.ref(2, 1).track, 1]]);
  });

  it('delete removes the chosen clips (nothing to do without clips)', () => {
    const h = harness([[1, 0]]);
    const undo = h.store.canUndo;
    h.selection.select(h.ref(2, 0));
    h.commands.clearSelected();
    expect(h.store.canUndo).toBe(undo);
    h.selection.select(h.ref(1, 0));
    h.commands.clearSelected();
    expect(h.clipAt(1, 0)).toBeNull();
  });

  it('duplicate copies the block below and chooses the copies', () => {
    const h = harness([[1, 0], [1, 1]]);
    h.commands.duplicateSelected();
    expect(h.clipAt(1, 2)).toBeNull();
    h.selection.pickRange(h.ref(1, 0), h.ref(1, 1));
    h.commands.duplicateSelected();
    expect(h.clipAt(1, 2)).not.toBeNull();
    expect(h.clipAt(1, 3)).not.toBeNull();
    expect(h.selection.cursor).toEqual(h.ref(1, 2));
    expect(h.selection.clips()).toEqual([h.ref(1, 2), h.ref(1, 3)]);
  });

  it('capture and insert: a scene below the cursor\'s, the cursor goes on it', () => {
    const h = harness([[1, 0]]);
    h.selection.select(h.ref(1, 0));
    h.setPlaying(new Map([[h.ref(1, 0).track, h.clipAt(1, 0)!.id]]));
    h.commands.captureAndInsertScene();
    expect(h.store.project.scenes).toHaveLength(5);
    expect(h.clipAt(1, 1)).not.toBeNull();
    expect(h.selection.cursor).toEqual(h.ref(1, 1));
    expect(h.said).toEqual([]);
  });

  it('capture with nothing playing inserts an empty scene (after the last without a cursor) and says so', () => {
    const h = harness();
    h.commands.captureAndInsertScene();
    expect(h.store.project.scenes).toHaveLength(5);
    expect(h.selection.cursor).toBeNull();
    expect(h.said).toEqual(['No clip is playing: an empty scene was inserted.']);
  });

  it('copy puts the clips in the clipboard; cut also removes them', () => {
    const h = harness([[1, 0], [2, 0]]);
    expect(h.commands.copySelected()).toBe(false);
    h.selection.pickRange(h.ref(1, 0), h.ref(2, 0));
    expect(h.commands.copySelected()).toBe(true);
    expect(h.clipboard.clips?.items).toHaveLength(2);
    expect(h.said.at(-1)).toMatch(/^2 clips copied/);
    h.commands.cutSelected();
    expect(h.clipAt(1, 0)).toBeNull();
    expect(h.clipAt(2, 0)).toBeNull();
  });

  it('paste: the devices if the clipboard has them, otherwise the clips from the cursor on', () => {
    const h = harness([[1, 0], [2, 0]]);
    h.commands.pasteSelected();
    expect(h.said).toEqual([]);
    h.selection.select(h.ref(1, 3));
    h.commands.pasteSelected();
    expect(h.said).toEqual(['The clipboard has no clips.']);
    h.selection.pickRange(h.ref(1, 0), h.ref(2, 0));
    h.commands.copySelected();
    h.selection.select(h.ref(1, 2));
    h.commands.pasteSelected();
    expect(h.clipAt(1, 2)).not.toBeNull();
    expect(h.clipAt(2, 2)).not.toBeNull();
    expect(h.selection.clips()).toEqual([h.ref(1, 2), h.ref(2, 2)]);
    h.clipboard.content = { kind: 'devices' } as never;
    h.commands.pasteSelected();
    expect(h.devicesPasted).toBe(1);
  });

  it('record arms the track first, unless it is already armed or recording', () => {
    const h = harness();
    h.commands.record(h.ref(1, 0));
    expect(h.ui.keyboardTracks.has(h.ref(1, 0).track)).toBe(true);
    h.commands.record(h.ref(1, 0));
    expect(h.ui.keyboardTracks.has(h.ref(1, 0).track)).toBe(true);
    h.recorder.slot = h.ref(2, 0);
    h.commands.record(h.ref(2, 0));
    expect(h.ui.keyboardTracks.has(h.ref(2, 0).track)).toBe(false);
    expect(h.recorder.toggled).toHaveLength(3);
  });

  it('open: the slot\'s clip in the editor, the keys stay with the session; an empty slot does nothing', () => {
    const h = harness([[1, 0]]);
    h.commands.openSlot(h.ref(1, 1));
    expect(h.opened).toEqual([]);
    h.commands.openSlot(h.ref(1, 0));
    expect(h.opened).toEqual([{ kind: 'slot', track: h.ref(1, 0).track, clip: h.clipAt(1, 0)!.id }]);
    expect(h.focused).toBe(1);
  });

  it('a new MIDI clip is created and opened', () => {
    const h = harness();
    h.commands.newMidiClip(h.ref(2, 1));
    expect(h.clipAt(2, 1)).not.toBeNull();
    expect(h.opened).toHaveLength(1);
  });
});

describe('session keys', () => {
  const press = (h: ReturnType<typeof harness>, key: string, mods: { ctrlKey?: boolean; shiftKey?: boolean } = {}) => {
    const b = findBinding(SESSION_KEYS, { key, code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods } as KeyboardEvent);
    const controls: SessionControls = { selection: h.selection, commands: h.commands };
    b?.run(controls);
    return b;
  };

  it('arrows move, Shift+arrows extend, Ctrl+A chooses all', () => {
    const h = harness([[1, 0], [2, 3]]);
    press(h, 'ArrowDown');
    press(h, 'ArrowRight');
    expect(h.selection.cursor).toEqual(h.ref(1, 0));
    press(h, 'ArrowDown', { shiftKey: true });
    expect(h.selection.size).toBe(2);
    press(h, 'a', { ctrlKey: true });
    expect(h.selection.clips()).toEqual([h.ref(1, 0), h.ref(2, 3)]);
  });

  it('Enter launches, Delete clears, Ctrl+D duplicates, Ctrl+C/X/V copy, cut and paste', () => {
    const h = harness([[1, 0]]);
    h.selection.select(h.ref(1, 0));
    press(h, 'Enter');
    expect(h.launched).toHaveLength(1);
    press(h, 'd', { ctrlKey: true });
    expect(h.clipAt(1, 1)).not.toBeNull();
    press(h, 'c', { ctrlKey: true });
    expect(h.clipboard.clips).not.toBeNull();
    press(h, 'x', { ctrlKey: true });
    expect(h.clipAt(1, 1)).toBeNull();
    h.selection.select(h.ref(2, 3));
    press(h, 'v', { ctrlKey: true });
    expect(h.clipAt(2, 3)).not.toBeNull();
    press(h, 'Delete');
    expect(h.clipAt(2, 3)).toBeNull();
    press(h, 'i', { ctrlKey: true, shiftKey: true });
    expect(h.store.project.scenes).toHaveLength(5);
  });
});

describe('session keys: all of them', () => {
  it('every binding runs on the chosen slot', () => {
    const h = harness([[1, 0], [2, 3]]);
    const controls: SessionControls = { selection: h.selection, commands: h.commands };
    h.selection.select(h.ref(1, 0));
    for (const b of SESSION_KEYS) b.run(controls);
    expect(h.selection.cursor).not.toBeNull();
  });
});
