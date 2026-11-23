import { describe, expect, it } from 'vitest';
import { addTrack } from '../../../src/store/edits';
import { deleteScene, newSlotMidiClip, type SlotRef } from '../../../src/store/session-edits';
import { SlotSelection, belowBlock, slotAfterSceneMove, slotKey } from '../../../src/ui/session/slot-selection';
import { setup } from '../../helpers/fixtures';

/** Three MIDI tracks, four scenes; clips where `clips` says. */
function grid(clips: readonly [number, number][] = []) {
  const { store, track } = setup({ midi: 3 });
  for (const [t, slot] of clips) store.apply(newSlotMidiClip({ track: track(t), slot }));
  const picks: SlotRef[] = [];
  const sel = new SlotSelection(() => store.project, c => picks.push(c));
  const ref = (t: number, slot: number): SlotRef => ({ track: track(t), slot });
  const keys = () => ['0', '1', '2'].flatMap(t => [0, 1, 2, 3].filter(s => sel.has(ref(Number(t), s))).map(s => `${t}:${s}`));
  return { store, sel, ref, picks, keys, track };
}

describe('slot selection: helpers', () => {
  it('slotKey joins track and slot', () => {
    expect(slotKey('t' as never, 3)).toBe('t:3');
  });

  it('the cursor follows its clip when a scene moves', () => {
    expect(slotAfterSceneMove(2, 2, 0)).toBe(0);
    expect(slotAfterSceneMove(3, 1, 3)).toBe(2);
    expect(slotAfterSceneMove(1, 3, 0)).toBe(2);
    expect(slotAfterSceneMove(0, 2, 3)).toBe(0);
  });

  it('the block below has the same shape, shifted by its height', () => {
    const t = 'a' as never;
    expect(belowBlock([{ track: t, slot: 1 }, { track: t, slot: 2 }])).toEqual([{ track: t, slot: 3 }, { track: t, slot: 4 }]);
    expect(belowBlock([{ track: t, slot: 0 }])).toEqual([{ track: t, slot: 1 }]);
  });
});

describe('SlotSelection', () => {
  it('starts empty', () => {
    const { sel } = grid();
    expect(sel.cursor).toBeNull();
    expect(sel.size).toBe(0);
    expect(sel.clips()).toEqual([]);
  });

  it('select puts the cursor on one slot and tells the view', () => {
    const { sel, ref, picks } = grid();
    sel.select(ref(1, 2));
    expect(sel.cursor).toEqual(ref(1, 2));
    expect(sel.size).toBe(1);
    expect(picks).toEqual([ref(1, 2)]);
  });

  it('the arrows move inside the grid, from the first slot when there is no cursor', () => {
    const { sel, ref } = grid();
    sel.move(0, 1);
    expect(sel.cursor).toEqual(ref(0, 0));
    sel.move(1, 1);
    expect(sel.cursor).toEqual(ref(1, 1));
    sel.move(5, 9);
    expect(sel.cursor).toEqual(ref(2, 3));
    sel.move(-9, -9);
    expect(sel.cursor).toEqual(ref(0, 0));
  });

  it('the arrows do nothing without tracks', () => {
    const { store } = setup();
    const sel = new SlotSelection(() => store.project);
    sel.move(1, 1);
    expect(sel.cursor).toBeNull();
  });

  it('Shift+arrows widen a rectangle from the anchor, the cursor at the moving corner', () => {
    const { sel, ref, keys } = grid();
    sel.select(ref(0, 1));
    sel.extend(1, 0);
    sel.extend(0, 1);
    expect(sel.cursor).toEqual(ref(1, 2));
    expect(keys()).toEqual(['0:1', '0:2', '1:1', '1:2']);
    sel.extend(-1, -1);
    expect(keys()).toEqual(['0:1']);
  });

  it('Shift+arrows without a cursor move it instead', () => {
    const { sel, ref } = grid();
    sel.extend(0, 1);
    expect(sel.cursor).toEqual(ref(0, 0));
  });

  it('pickRange covers the rectangle whichever corner it starts from', () => {
    const { sel, ref, keys } = grid();
    sel.pickRange(ref(2, 3), ref(1, 2));
    expect(keys()).toEqual(['1:2', '1:3', '2:2', '2:3']);
    expect(sel.cursor).toEqual(ref(1, 2));
  });

  it('pickRange on a track that is not visible selects only the end', () => {
    const { sel, ref, keys } = grid();
    sel.pickRange({ track: 'gone' as never, slot: 0 }, ref(1, 1));
    expect(keys()).toEqual(['1:1']);
  });

  it('extendTo goes from the anchor (Shift+click), or from the slot itself with nothing chosen', () => {
    const { sel, ref, keys } = grid();
    sel.extendTo(ref(1, 1));
    expect(keys()).toEqual(['1:1']);
    sel.select(ref(0, 0));
    sel.extendTo(ref(1, 1));
    expect(keys()).toEqual(['0:0', '0:1', '1:0', '1:1']);
  });

  it('Ctrl+click adds and removes slots; removing the last one keeps it', () => {
    const { sel, ref, keys } = grid();
    sel.select(ref(0, 0));
    sel.toggle(ref(2, 3));
    expect(keys()).toEqual(['0:0', '2:3']);
    expect(sel.cursor).toEqual(ref(2, 3));
    sel.toggle(ref(2, 3));
    expect(keys()).toEqual(['0:0']);
    expect(sel.cursor).toEqual(ref(0, 0));
    sel.toggle(ref(0, 0));
    expect(keys()).toEqual(['0:0']);
  });

  it('Ctrl+A chooses all the clips, keeping the cursor', () => {
    const { sel, ref, keys } = grid([[0, 0], [2, 1]]);
    sel.selectAll();
    expect(keys()).toEqual(['0:0', '2:1']);
    expect(sel.cursor).toEqual(ref(0, 0));
    sel.select(ref(1, 3));
    sel.selectAll();
    expect(sel.cursor).toEqual(ref(1, 3));
  });

  it('Ctrl+A with no clips changes nothing', () => {
    const { sel, picks } = grid();
    sel.selectAll();
    expect(picks).toEqual([]);
  });

  it('clips are the chosen slots with a clip; a drag carries them if it starts among them', () => {
    const { sel, ref } = grid([[0, 0], [0, 1]]);
    sel.pickRange(ref(0, 0), ref(0, 2));
    expect(sel.clips()).toEqual([ref(0, 0), ref(0, 1)]);
    expect(sel.carried(ref(0, 1))).toEqual([ref(0, 0), ref(0, 1)]);
    expect(sel.carried(ref(2, 2))).toEqual([ref(2, 2)]);
  });

  it('moveCursor moves only the cursor and does not tell the view', () => {
    const { sel, ref, picks, keys } = grid();
    sel.pickRange(ref(0, 0), ref(0, 1));
    picks.length = 0;
    sel.moveCursor(ref(0, 0));
    expect(sel.cursor).toEqual(ref(0, 0));
    expect(keys()).toEqual(['0:0', '0:1']);
    expect(picks).toEqual([]);
  });

  it('followSceneMove keeps the cursor on its clip', () => {
    const { sel, ref } = grid();
    sel.followSceneMove(0, 2);
    expect(sel.cursor).toBeNull();
    sel.select(ref(1, 2));
    sel.followSceneMove(0, 3);
    expect(sel.cursor).toEqual(ref(1, 1));
  });

  it('prune forgets the slots of deleted scenes and removed tracks', () => {
    const { store, sel, ref } = grid();
    store.apply(addTrack('midi'));
    sel.pickRange(ref(0, 2), ref(1, 3));
    store.apply(deleteScene(store.project.scenes[3].id));
    sel.prune();
    expect(sel.cursor).toBeNull();
    expect(sel.size).toBe(2);
    expect(sel.has(ref(0, 2)) && sel.has(ref(1, 2))).toBe(true);
  });
});
