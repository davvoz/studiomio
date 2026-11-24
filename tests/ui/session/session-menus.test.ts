import { describe, expect, it } from 'vitest';
import type { TrackId } from '../../../src/core/id';
import { GroupTrack, type BusTrack } from '../../../src/model/track';
import { Clipboard } from '../../../src/store/clipboard';
import { addBus, groupTracks, setBusFolded } from '../../../src/store/edits';
import { newSlotMidiClip, type SlotRef } from '../../../src/store/session-edits';
import { SEPARATOR, type MenuAction, type MenuItem } from '../../../src/ui/context-menu';
import { SessionCommands, type SlotRecorder } from '../../../src/ui/session/session-commands';
import { busHeadMenu, recordItems, sceneMenu, slotMenu, trackHeadMenu, type SessionMenuDeps } from '../../../src/ui/session/session-menus';
import { SlotSelection } from '../../../src/ui/session/slot-selection';
import { UiState } from '../../../src/ui/ui-state';
import { setup } from '../../helpers/fixtures';

const actions = (items: readonly MenuItem[]): MenuAction[] => items.filter((i): i is MenuAction => i !== SEPARATOR && 'label' in i);
const labels = (items: readonly MenuItem[]) => actions(items).map(i => (i.disabled ? `(off) ${i.label}` : i.label));
const run = (items: readonly MenuItem[], label: string) => actions(items).find(i => i.label === label)!.run();

/** Audio (0), two MIDI (1, 2); clips at `clips`. */
function harness(clips: readonly [number, number][] = []) {
  const { store, track } = setup({ audio: 1, midi: 2 });
  for (const [t, slot] of clips) store.apply(newSlotMidiClip({ track: track(t), slot }));
  const calls: string[] = [];
  let recording: SlotRef | null = null;
  const recorder: SlotRecorder = {
    recordingSlot: (t: TrackId) => (recording?.track === t ? recording.slot : null),
    toggle: r => calls.push(`record ${r.slot}`),
    onChange: () => () => {},
  };
  const ui = new UiState(), clipboard = new Clipboard(), selection = new SlotSelection(() => store.project);
  const engine = {
    launchSlot: (_t: TrackId, s: number) => calls.push(`launch ${s}`),
    stopTrack: () => calls.push('stop'),
    launchScene: (i: number) => calls.push(`scene ${i}`),
    playingClips: () => new Map(),
  };
  const commands = new SessionCommands({ store, engine, clipboard, recorder, ui, openClip: () => calls.push('open'), pasteDevices: () => {}, say: () => {} },
    selection, { focus: () => {} });
  const deps: SessionMenuDeps = {
    store, ui, engine, clipboard, recorder, commands, selection,
    openDevices: () => calls.push('devices'),
    pasteDeviceItems: () => [],
    sceneToArrangement: i => calls.push(`arrangement ${i}`),
    exportScene: i => calls.push(`export ${i}`),
    importAudioTo: r => calls.push(`import ${r.slot}`),
  };
  const ref = (t: number, slot: number): SlotRef => ({ track: track(t), slot });
  return { store, deps, calls, ref, track, selection, clipboard, setRecording: (r: SlotRef | null) => { recording = r; } };
}

describe('session menus: slots', () => {
  it('an empty MIDI slot: record, new clip, paste (off without clips), stop', () => {
    const h = harness();
    const items = slotMenu(h.deps, h.ref(1, 0), () => {});
    expect(labels(items)).toEqual(['Record here', 'New MIDI clip', '(off) Paste', 'Stop the track']);
    run(items, 'New MIDI clip');
    expect(h.store.project.track(h.ref(1, 0).track)!.slots[0]).not.toBeNull();
    expect(h.calls).toContain('open');
  });

  it('an empty audio slot imports audio and has no recording', () => {
    const h = harness();
    const items = slotMenu(h.deps, h.ref(0, 2), () => {});
    expect(labels(items)).toEqual(['Import audio…', '(off) Paste', 'Stop the track']);
    run(items, 'Import audio…');
    run(items, 'Stop the track');
    expect(h.calls).toEqual(['import 2', 'stop']);
  });

  it('one clip: launch, open, record over it, edit, rename, colour, delete', () => {
    const h = harness([[1, 0]]);
    h.selection.select(h.ref(1, 0));
    let renamed = 0;
    const items = slotMenu(h.deps, h.ref(1, 0), () => { renamed++; });
    expect(labels(items)).toEqual(['Launch', 'Open in the editor', 'Record here (replaces the clip)', 'Cut', 'Copy', 'Duplicate', 'Rename', 'Delete']);
    expect(items.some(i => typeof i === 'object' && 'colors' in i)).toBe(true);
    run(items, 'Rename');
    run(items, 'Launch');
    expect(renamed).toBe(1);
    expect(h.calls).toEqual(['launch 0']);
  });

  it('several chosen clips: the count in the labels, launch and delete them all', () => {
    const h = harness([[1, 0], [2, 0]]);
    h.selection.pickRange(h.ref(1, 0), h.ref(2, 0));
    const items = slotMenu(h.deps, h.ref(1, 0), () => {});
    expect(labels(items)).toEqual(['Launch 2 clips', 'Cut', 'Copy', 'Duplicate', 'Delete 2 clips']);
    run(items, 'Delete 2 clips');
    expect(h.store.project.track(h.ref(2, 0).track)!.slots[0]).toBeNull();
  });

  it('the colour of several clips applies to all of them', () => {
    const h = harness([[1, 0], [2, 0]]);
    h.selection.pickRange(h.ref(1, 0), h.ref(2, 0));
    const colors = slotMenu(h.deps, h.ref(1, 0), () => {}).find(i => typeof i === 'object' && 'colors' in i) as { pick(c: string | null): void };
    colors.pick('#123456');
    expect(h.store.project.track(h.ref(1, 0).track)!.slots[0]!.color).toBe('#123456');
    expect(h.store.project.track(h.ref(2, 0).track)!.slots[0]!.color).toBe('#123456');
  });

  it('a group\'s slot launches its row or stops its tracks', () => {
    const h = harness();
    h.store.apply(groupTracks([h.track(1), h.track(2)]));
    const group = h.store.project.tracks.find(t => t instanceof GroupTrack)!;
    const items = slotMenu(h.deps, { track: group.id, slot: 1 }, () => {});
    expect(labels(items)).toEqual(['Launch the group\'s row', 'Stop the group\'s tracks']);
    run(items, 'Launch the group\'s row');
    expect(h.calls).toEqual(['launch 1']);
  });

  it('while recording only the recording slot offers to stop; other tracks are not affected', () => {
    const h = harness();
    h.setRecording(h.ref(1, 2));
    const track = h.store.project.track(h.ref(1, 0).track)!;
    expect(recordItems(h.deps, h.ref(1, 0), track)).toEqual([]);
    const stop = recordItems(h.deps, h.ref(1, 2), track);
    expect(labels(stop)).toEqual(['Stop recording']);
    run(stop, 'Stop recording');
    expect(h.calls).toEqual(['record 2']);
    expect(labels(recordItems(h.deps, h.ref(2, 0), h.store.project.track(h.ref(2, 0).track)!))).toEqual(['Record here']);
  });
});

describe('session menus: scenes and headers', () => {
  it('a scene: copy to the arrangement only with clips, delete only if it is not the last', () => {
    const h = harness([[1, 1]]);
    const [s0, s1] = h.store.project.scenes;
    expect(labels(sceneMenu(h.deps, s0, 0, () => {}))).toContain('(off) Copy to the arrangement');
    const items = sceneMenu(h.deps, s1, 1, () => {});
    expect(labels(items)).toEqual([
      'Launch the scene', 'Rename', 'Duplicate', 'Capture and insert scene', 'Copy to the arrangement', 'Export audio…',
      'Insert a scene above', 'Insert a scene below', 'Delete the scene',
    ]);
    run(items, 'Launch the scene');
    run(items, 'Copy to the arrangement');
    run(items, 'Export audio…');
    expect(h.calls).toEqual(['scene 1', 'arrangement 1', 'export 1']);
    run(items, 'Insert a scene below');
    expect(h.store.project.scenes).toHaveLength(5);
  });

  it('the only scene can\'t be deleted', () => {
    const h = harness();
    while (h.store.project.scenes.length > 1) run(sceneMenu(h.deps, h.store.project.scenes[0], 0, () => {}), 'Delete the scene');
    expect(labels(sceneMenu(h.deps, h.store.project.scenes[0], 0, () => {}))).toContain('(off) Delete the scene');
  });

  it('a MIDI track\'s header: instrument, effects to add, rename, groups, delete, new tracks', () => {
    const h = harness();
    const t = h.store.project.track(h.track(1))!;
    const items = labels(trackHeadMenu(h.deps, t, () => {}));
    expect(items[0]).toBe('Instrument and effects');
    expect(items).toContain('Rename');
    expect(items).toContain('Delete track');
    run(trackHeadMenu(h.deps, t, () => {}), 'Instrument and effects');
    expect(h.calls).toEqual(['devices']);
    expect(labels(trackHeadMenu(h.deps, h.store.project.track(h.track(0))!, () => {}))[0]).toBe('Effects');
  });

  it('a group\'s header deletes the group with its tracks', () => {
    const h = harness();
    h.store.apply(groupTracks([h.track(1), h.track(2)]));
    const group = h.store.project.tracks.find(t => t instanceof GroupTrack)!;
    const items = trackHeadMenu(h.deps, group, () => {});
    run(items, 'Delete the group and its tracks');
    expect(h.store.project.tracks).toHaveLength(1);
  });

  it('a bus\'s header: collapse or expand, delete, new bus', () => {
    const h = harness();
    h.store.apply(addBus());
    let bus = h.store.project.buses[0] as BusTrack;
    expect(labels(busHeadMenu(h.deps, bus, () => {}))).toEqual(expect.arrayContaining(['Effects', 'Rename', 'Collapse the bus', 'Delete the bus', 'New bus']));
    run(busHeadMenu(h.deps, bus, () => {}), 'Collapse the bus');
    bus = h.store.project.buses[0];
    expect(bus.folded).toBe(true);
    expect(labels(busHeadMenu(h.deps, bus, () => {}))).toContain('Expand the bus');
    run(busHeadMenu(h.deps, bus, () => {}), 'New bus');
    expect(h.store.project.buses).toHaveLength(2);
    run(busHeadMenu(h.deps, h.store.project.buses[1], () => {}), 'Delete the bus');
    expect(h.store.project.buses).toHaveLength(1);
    h.store.apply(setBusFolded(bus.id, false));
  });
});

describe('session menus: every item runs', () => {
  const runEverything = (items: readonly MenuItem[]) => {
    for (const i of actions(items)) if (!i.disabled) i.run();
    for (const i of items) if (typeof i === 'object' && 'colors' in i) (i as { pick(c: string | undefined): void }).pick('#123456');
  };

  it('slots, scenes and headers', () => {
    const h = harness([[1, 0], [2, 0], [1, 1]]);
    h.selection.select(h.ref(1, 0));
    runEverything(slotMenu(h.deps, h.ref(1, 0), () => {}));
    runEverything(slotMenu(h.deps, h.ref(2, 3), () => {}));
    h.selection.pickRange(h.ref(1, 1), h.ref(2, 1));
    h.store.apply(newSlotMidiClip(h.ref(2, 1)));
    runEverything(slotMenu(h.deps, h.ref(1, 1), () => {}));
    const scene = h.store.project.scenes[1];
    runEverything(sceneMenu(h.deps, scene, 1, () => {}));
    runEverything(trackHeadMenu(h.deps, h.store.project.track(h.track(1))!, () => {}));
    h.store.apply(addBus());
    runEverything(busHeadMenu(h.deps, h.store.project.buses[0], () => {}));
    expect(h.calls).toEqual(expect.arrayContaining(['launch 0', 'open', 'record 0', 'stop', 'scene 1', 'devices']));
  });
});
