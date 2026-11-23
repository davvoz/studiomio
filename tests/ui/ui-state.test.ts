import { describe, expect, it } from 'vitest';
import type { DeviceId, PlacementId, TrackId } from '../../src/core/id';
import { TimeSignature } from '../../src/core/music-time';
import type { KeyTarget } from '../../src/model/key-map';
import type { MidiTarget } from '../../src/model/midi-map';
import { FIXED_GRIDS, TimelineGeometry } from '../../src/ui/timeline/geometry';
import { clickTrack, UiState } from '../../src/ui/ui-state';

const pid = (s: string) => s as PlacementId;
const tid = (s: string) => s as TrackId;
const [A, B, C, D] = ['a', 'b', 'c', 'd'].map(tid);
const ORDER = [A, B, C, D];
const MACRO: KeyTarget = { kind: 'macro', owner: A, rack: 'r1' as DeviceId, index: 0 };
const MIXER: MidiTarget = { kind: 'mixer', owner: A, control: 'volume' };

/** A state and the number of 'change' notifications it has sent. */
function watched() {
  const ui = new UiState();
  const count = { change: 0, grid: 0 };
  ui.onChange(() => count.change++);
  ui.onGridChange(() => count.grid++);
  return { ui, count };
}

describe('UiState: selection and view', () => {
  it('select replaces the clips; a range counts only if it has length; toggle adds and removes', () => {
    const { ui, count } = watched();
    ui.select([pid('x'), pid('y')], { start: 1, end: 3 });
    expect([...ui.selection]).toEqual(['x', 'y']);
    expect(ui.range).toEqual({ start: 1, end: 3 });
    ui.select([pid('x')], { start: 2, end: 2 });
    expect(ui.range).toBeNull();
    ui.toggle(pid('z'));
    expect([...ui.selection]).toEqual(['x', 'z']);
    ui.toggle(pid('x'));
    expect([...ui.selection]).toEqual(['z']);
    expect(count.change).toBe(4);
  });

  it('setGeometry replaces the view and notifies; the unsubscribe stops it', () => {
    const ui = new UiState();
    let n = 0;
    const off = ui.onChange(() => n++);
    const g = new TimelineGeometry(50, 4);
    ui.setGeometry(g);
    expect(ui.geometry).toBe(g);
    off();
    ui.setSnap(false);
    expect(ui.snap).toBe(false);
    expect(n).toBe(1);
  });

  it('the grid notifies on its own channel too, and sets the step', () => {
    const { ui, count } = watched();
    ui.setGrid({ fixed: 3, density: 0, triplet: false });
    expect(count).toEqual({ change: 1, grid: 1 });
    expect(ui.grid.fixed).toBe(3);
    expect(FIXED_GRIDS[3].label).toBe('1/4');
    expect(ui.gridStep(10, new TimeSignature(4, 4))).toBe(1);
    ui.setGrid({ fixed: null, density: 0, triplet: false });
    expect(ui.gridStep(100, new TimeSignature(4, 4), 14)).toBe(1 / 4);
  });
});

describe('UiState: tracks', () => {
  it('selectTrack chooses one track and does nothing when it is already the only one', () => {
    const { ui, count } = watched();
    ui.selectTrack(A);
    ui.selectTrack(A);
    expect(ui.track).toBe(A);
    expect([...ui.selectedTracks]).toEqual([A]);
    expect(count.change).toBe(1);
    ui.selectTrack(null);
    expect(ui.track).toBeNull();
    expect(ui.selectedTracks.size).toBe(0);
    ui.selectTrack(null);
    expect(count.change).toBe(2);
  });

  it('Shift extends from the chosen track in both directions, the chosen one stays the anchor', () => {
    const { ui } = watched();
    ui.selectTrack(B);
    ui.extendTrackSelection(D, 'range', ORDER);
    expect([...ui.selectedTracks]).toEqual([B, C, D]);
    expect(ui.track).toBe(B);
    ui.extendTrackSelection(A, 'range', ORDER);
    expect([...ui.selectedTracks]).toEqual([A, B]);
  });

  it('Ctrl adds a track and removes it again; removing the chosen one moves the choice', () => {
    const { ui } = watched();
    ui.selectTrack(A);
    ui.extendTrackSelection(C, 'toggle', ORDER);
    expect([...ui.selectedTracks]).toEqual([A, C]);
    expect(ui.track).toBe(C);
    ui.extendTrackSelection(C, 'toggle', ORDER);
    expect([...ui.selectedTracks]).toEqual([A]);
    expect(ui.track).toBe(A);
    // the only track left can't be toggled away: it's added again as the chosen one
    ui.extendTrackSelection(A, 'toggle', ORDER);
    expect([...ui.selectedTracks]).toEqual([A]);
  });

  it('a range without a chosen track just adds the track', () => {
    const { ui } = watched();
    ui.extendTrackSelection(C, 'range', ORDER);
    expect([...ui.selectedTracks]).toEqual([C]);
    expect(ui.track).toBe(C);
  });

  it('clickTrack: plain chooses, Shift extends, Ctrl and Meta toggle, right click keeps a chosen selection', () => {
    const { ui } = watched();
    const click = (id: TrackId, e: Partial<MouseEvent>) => clickTrack(ui, id, { button: 0, ...e } as MouseEvent, () => ORDER);
    click(A, {});
    click(C, { shiftKey: true });
    expect([...ui.selectedTracks]).toEqual([A, B, C]);
    click(D, { ctrlKey: true });
    expect(ui.selectedTracks.has(D)).toBe(true);
    click(D, { metaKey: true });
    expect(ui.selectedTracks.has(D)).toBe(false);
    // right click on a chosen track leaves everything as it is
    click(B, { button: 2 });
    expect([...ui.selectedTracks]).toEqual([A, B, C]);
    // right click outside the selection chooses it
    click(D, { button: 2 });
    expect([...ui.selectedTracks]).toEqual([D]);
  });

  it('keyboard tracks toggle and the ones that are gone are dropped', () => {
    const { ui, count } = watched();
    ui.toggleKeyboardTrack(A);
    ui.toggleKeyboardTrack(B);
    expect([...ui.keyboardTracks]).toEqual([A, B]);
    ui.toggleKeyboardTrack(A);
    expect([...ui.keyboardTracks]).toEqual([B]);
    const before = count.change;
    ui.keepKeyboardTracks(() => true);
    expect(count.change).toBe(before);
    ui.keepKeyboardTracks(id => id !== B);
    expect(ui.keyboardTracks.size).toBe(0);
    expect(count.change).toBe(before + 1);
  });
});

describe('UiState: follow', () => {
  it('pausing and resuming; a pause only exists while follow is on', () => {
    const { ui, count } = watched();
    expect(ui.following).toBe(true);
    ui.pauseFollow();
    expect([ui.follow, ui.followPaused, ui.following]).toEqual([true, true, false]);
    ui.pauseFollow(); // already paused
    ui.resumeFollow();
    ui.resumeFollow(); // nothing to resume
    expect(ui.following).toBe(true);
    expect(count.change).toBe(2);
  });

  it('setFollow(off) clears a pause; setting the same value again is silent', () => {
    const { ui, count } = watched();
    ui.setFollow(true);
    expect(count.change).toBe(0);
    ui.pauseFollow();
    ui.setFollow(true); // wakes it up again
    expect(ui.followPaused).toBe(false);
    ui.setFollow(false);
    ui.pauseFollow(); // not following: nothing to pause
    expect([ui.follow, ui.followPaused, ui.following]).toEqual([false, false, false]);
  });
});

describe('UiState: controller state', () => {
  it('the session ring only notifies when it really changes', () => {
    const { ui, count } = watched();
    ui.setSessionRing({ track: 0, scene: 0, width: 8, height: 5 });
    ui.setSessionRing({ track: 0, scene: 0, width: 8, height: 5 });
    expect(count.change).toBe(1);
    ui.setSessionRing({ track: 1, scene: 0, width: 8, height: 5 });
    ui.setSessionRing(null);
    expect(ui.sessionRing).toBeNull();
    ui.setSessionRing(null);
    expect(count.change).toBe(3);
  });

  it('the controlled device only notifies when it really changes', () => {
    const { ui, count } = watched();
    ui.setControlledDevice({ owner: A, device: 'instrument' });
    ui.setControlledDevice({ owner: A, device: 'instrument' });
    expect(count.change).toBe(1);
    ui.setControlledDevice({ owner: 'master', device: 'instrument' });
    ui.setControlledDevice(null);
    expect(ui.controlledDevice).toBeNull();
    expect(count.change).toBe(3);
  });

  it('KEY and MIDI mapping exclude each other and clear their targets', () => {
    const { ui } = watched();
    ui.setKeyMapping(true);
    ui.chooseKeyTarget(MACRO);
    expect(ui.keyTarget).toEqual(MACRO);
    ui.setMidiMapping(true);
    expect([ui.keyMapping, ui.keyTarget, ui.midiMapping]).toEqual([false, null, true]);
    ui.chooseMidiTarget(MIXER);
    expect(ui.midiTarget).toEqual(MIXER);
    ui.setKeyMapping(true);
    expect([ui.midiMapping, ui.midiTarget, ui.keyMapping]).toEqual([false, null, true]);
    ui.setKeyMapping(false);
    expect(ui.keyTarget).toBeNull();
  });

  it('targets are only chosen while their mapping is on, and equal targets are ignored', () => {
    const { ui, count } = watched();
    ui.chooseKeyTarget(MACRO);
    ui.chooseMidiTarget(MIXER);
    expect(count.change).toBe(0);
    ui.setKeyMapping(true);
    ui.chooseKeyTarget(MACRO);
    ui.chooseKeyTarget({ ...MACRO });
    expect(count.change).toBe(2);
    ui.chooseKeyTarget(null);
    expect(ui.keyTarget).toBeNull();
    ui.setMidiMapping(true);
    ui.chooseMidiTarget(MIXER);
    ui.chooseMidiTarget({ ...MIXER });
    const n = count.change;
    ui.chooseMidiTarget({ kind: 'send', owner: A, bus: B });
    expect(count.change).toBe(n + 1);
    // setting the same mapping state again does nothing
    ui.setMidiMapping(true);
    expect(count.change).toBe(n + 1);
  });
});
