import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alsoMoves, KeyMapper } from '../../src/app/key-mapper';
import type { KeyTarget } from '../../src/model/key-map';
import type { MidiTrack } from '../../src/model/track';
import type { MacroSprings } from '../../src/store/macro-springs';
import { addEffect } from '../../src/store/edits';
import { setKey } from '../../src/store/key-edits';
import { groupDevices, mapMacro, setMacroMode } from '../../src/store/rack-edits';
import { UiState } from '../../src/ui/ui-state';
import { setup } from '../helpers/fixtures';

type Listener = (e: unknown) => void;

function key(code: string, over: Record<string, unknown> = {}) {
  const e = {
    code, key: over.key ?? code, ctrlKey: false, metaKey: false, altKey: false, repeat: false, target: null,
    defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
    ...over,
  };
  return e;
}

/** A MIDI track with a Delay and a Tape Stop in a rack. */
function rig(withSprings = false) {
  const s = setup({ midi: 1 });
  const t = s.track(0);
  s.store.apply(addEffect(t, 'delay', 'Delay'));
  s.store.apply(addEffect(t, 'tapeStop', 'Tape Stop'));
  const track = () => s.store.project.tracks[0] as MidiTrack;
  const [delay, stop] = track().effects.map(e => e.id);
  s.store.apply(groupDevices(t, [delay, stop]));
  const rack = track().racks[0].id;
  const target = (index: number): KeyTarget => ({ kind: 'macro', owner: t, rack, index });
  const ui = new UiState();
  const said: string[] = [];
  const springs = { hold: vi.fn() };
  const mapper = new KeyMapper(s.store, ui, t2 => said.push(t2), withSprings ? (springs as unknown as MacroSprings) : undefined);
  return { ...s, t, track, delay, stop, rack, target, ui, said, springs, mapper, macro: (i: number) => track().racks[0].macros[i] };
}

describe('KeyMapper', () => {
  const listeners = new Map<string, Listener>();
  const fire = (type: string, e: unknown) => listeners.get(type)?.(e);

  beforeEach(() => {
    listeners.clear();
    vi.stubGlobal('addEventListener', (type: string, fn: Listener) => { listeners.set(type, fn); });
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('playing mapped keys', () => {
    it('a mapped key moves its target, swallowing the event; a repeat does nothing', () => {
      const r = rig();
      r.store.apply(mapMacro(r.t, r.rack, 0, r.delay, 'mix'));
      r.store.apply(setKey(r.target(0), 'KeyQ'));
      const down = key('KeyQ');
      fire('keydown', down);
      expect(down.defaultPrevented && down.stopped).toBe(true);
      expect(r.macro(0).value).toBe(127);
      fire('keydown', key('KeyQ', { repeat: true }));
      fire('keydown', key('KeyQ'));
      expect(r.macro(0).value).toBe(127);
      fire('keyup', key('KeyQ'));
      fire('keydown', key('KeyQ'));
      expect(r.macro(0).value).toBe(0);
    });

    it('keys that are not mapped, or with Ctrl/Alt/Meta, or in a text field, are left alone', () => {
      const r = rig();
      r.store.apply(mapMacro(r.t, r.rack, 0, r.delay, 'mix'));
      r.store.apply(setKey(r.target(0), 'KeyQ'));
      const start = r.macro(0).value;
      const other = key('KeyW');
      fire('keydown', other);
      expect(other.defaultPrevented).toBe(false);
      for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
        const e = key('KeyQ', { [mod]: true });
        fire('keydown', e);
        expect(e.defaultPrevented).toBe(false);
      }
      const typing = key('KeyQ', { target: { tagName: 'TEXTAREA', isContentEditable: false } });
      fire('keydown', typing);
      expect(typing.defaultPrevented).toBe(false);
      expect(r.macro(0).value).toBe(start);
    });

    it('a button macro is on while the key is down and releasing an unknown key does nothing', () => {
      const r = rig();
      r.store.apply(mapMacro(r.t, r.rack, 0, r.delay, 'mix'));
      r.store.apply(setMacroMode(r.t, r.rack, 0, 'button'));
      r.store.apply(setKey(r.target(0), 'KeyB'));
      fire('keydown', key('KeyB'));
      expect(r.macro(0).value).toBe(127);
      const stray = key('KeyZ');
      fire('keyup', stray);
      expect(stray.defaultPrevented).toBe(false);
      const up = key('KeyB');
      fire('keyup', up);
      expect(up.defaultPrevented).toBe(true);
      expect(r.macro(0).value).toBe(0);
    });

    it('losing the window focus releases the held buttons', () => {
      const r = rig();
      r.store.apply(mapMacro(r.t, r.rack, 0, r.delay, 'mix'));
      r.store.apply(setMacroMode(r.t, r.rack, 0, 'button'));
      r.store.apply(setKey(r.target(0), 'KeyB'));
      fire('keydown', key('KeyB'));
      fire('blur', {});
      expect(r.macro(0).value).toBe(0);
    });

    it('turning KEY on releases the held buttons', () => {
      const r = rig();
      r.store.apply(mapMacro(r.t, r.rack, 0, r.delay, 'mix'));
      r.store.apply(setMacroMode(r.t, r.rack, 0, 'button'));
      r.store.apply(setKey(r.target(0), 'KeyB'));
      fire('keydown', key('KeyB'));
      r.ui.setKeyMapping(true);
      expect(r.macro(0).value).toBe(0);
    });

    it('a spring macro is held while the key is down and released with it', () => {
      const r = rig(true);
      r.store.apply(mapMacro(r.t, r.rack, 0, r.delay, 'mix'));
      r.store.apply(setMacroMode(r.t, r.rack, 0, 'spring'));
      r.store.apply(setKey(r.target(0), 'KeyS'));
      fire('keydown', key('KeyS'));
      expect(r.springs.hold).toHaveBeenLastCalledWith(r.t, r.rack, 0, true);
      fire('keyup', key('KeyS'));
      expect(r.springs.hold).toHaveBeenLastCalledWith(r.t, r.rack, 0, false);
      expect(r.springs.hold).toHaveBeenCalledTimes(2);
    });
  });

  describe('assigning keys (KEY on)', () => {
    let r: ReturnType<typeof rig>;
    beforeEach(() => {
      r = rig();
      r.store.apply(mapMacro(r.t, r.rack, 0, r.delay, 'mix'));
      r.ui.setKeyMapping(true);
    });

    it('gives the pressed key to the chosen target and says so', () => {
      const start = r.macro(0).value;
      r.ui.chooseKeyTarget(r.target(0));
      const e = key('KeyQ');
      fire('keydown', e);
      expect(e.defaultPrevented).toBe(true);
      expect(r.store.project.keyMap).toEqual([{ key: 'KeyQ', target: r.target(0) }]);
      expect(r.said.at(-1)).toMatch(/^Mapped to key .*Del removes it, Esc turns KEY off\.$/);
      expect(r.macro(0).value).toBe(start); // assigning doesn't move it
    });

    it('says when the key also moves other controls', () => {
      r.store.apply(mapMacro(r.t, r.rack, 1, r.stop, 'stop'));
      r.store.apply(setKey(r.target(1), 'KeyQ'));
      r.ui.chooseKeyTarget(r.target(0));
      fire('keydown', key('KeyQ'));
      expect(r.said.at(-1)).toContain('(it also moves another control)');
    });

    it('Del and Backspace remove the key', () => {
      r.store.apply(setKey(r.target(0), 'KeyQ'));
      r.ui.chooseKeyTarget(r.target(0));
      fire('keydown', key('KeyW', { key: 'Delete' }));
      expect(r.store.project.keyMap).toEqual([]);
      expect(r.said.at(-1)).toBe('Key removed.');
      r.store.apply(setKey(r.target(0), 'KeyQ'));
      fire('keydown', key('KeyW', { key: 'Backspace' }));
      expect(r.store.project.keyMap).toEqual([]);
    });

    it('refuses reserved keys and the app shortcuts', () => {
      r.ui.chooseKeyTarget(r.target(0));
      fire('keydown', key('ArrowUp', { key: 'ArrowUp' }));
      fire('keydown', key('Space', { key: ' ' }));
      expect(r.store.project.keyMap).toEqual([]);
      expect(r.said).toHaveLength(2);
      expect(r.said[0]).toContain('is already used by the app');
    });

    it('does nothing without a chosen target or for modifier keys', () => {
      const e = key('KeyQ');
      fire('keydown', e);
      expect(e.defaultPrevented).toBe(false);
      r.ui.chooseKeyTarget(r.target(0));
      fire('keydown', key('ShiftLeft', { key: 'Shift' }));
      expect(r.store.project.keyMap).toEqual([]);
      expect(r.said).toEqual([]);
    });

    it('Esc turns KEY off', () => {
      const e = key('Escape', { key: 'Escape' });
      fire('keydown', e);
      expect(r.ui.keyMapping).toBe(false);
      expect(e.stopped).toBe(true);
    });
  });

  it('alsoMoves words the number of other controls', () => {
    expect(alsoMoves(0)).toBe('');
    expect(alsoMoves(-1)).toBe('');
    expect(alsoMoves(1)).toBe(' (it also moves another control)');
    expect(alsoMoves(3)).toBe(' (it also moves 3 other controls)');
  });
});
