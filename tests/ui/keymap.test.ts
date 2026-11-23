import { describe, expect, it } from 'vitest';
import { DrawMode } from '../../src/ui/draw-mode';
import { findBinding, KEYMAP, ownedByField, type Commands } from '../../src/ui/keymap';

const key = (k: string) => ({ key: k, code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }) as KeyboardEvent;
const field = (tagName: string) => ({ tagName, isContentEditable: false }) as HTMLElement;

describe('keyboard shortcuts', () => {
  it('a focused select box keeps only the keys that move through its choices', () => {
    const select = field('SELECT');
    for (const k of ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter']) expect(ownedByField(select, key(k))).toBe(true);
    // after a choice the focus stays there: Space, B and the others stay shortcuts
    for (const k of [' ', 'b', 'Delete', 'q']) expect(ownedByField(select, key(k))).toBe(false);
    expect(ownedByField(field('TEXTAREA'), key('b'))).toBe(true);
  });

  it('B is the draw mode everywhere, Ctrl+Alt+B the browser', () => {
    /** The command a key runs: a stand-in for the app records which one is called. */
    const commandOf = (e: KeyboardEvent): string | undefined => {
      let called: string | undefined;
      const app = new Proxy({}, { get: (_t, name) => () => { called = String(name); } }) as Commands;
      findBinding(KEYMAP, e)?.run(app);
      return called;
    };
    expect(commandOf(key('b'))).toBe('toggleDraw');
    // Live's zoom keys
    expect(commandOf(key('z'))).toBe('zoomToSelection');
    expect(commandOf(key('x'))).toBe('zoomBack');
    expect(commandOf(key('w'))).toBe('zoomToFit');
    expect(commandOf({ ...key('z'), ctrlKey: true } as KeyboardEvent)).toBe('undo');
    // Live's grid keys
    expect(commandOf({ ...key('1'), ctrlKey: true } as KeyboardEvent)).toBe('narrowGrid');
    expect(commandOf({ ...key('2'), ctrlKey: true } as KeyboardEvent)).toBe('widenGrid');
    expect(commandOf({ ...key('3'), ctrlKey: true } as KeyboardEvent)).toBe('toggleTriplet');
    expect(commandOf({ ...key('b'), ctrlKey: true, altKey: true } as KeyboardEvent)).toBe('toggleBrowser');
  });

  it('one draw mode shared by whoever listens', () => {
    const mode = new DrawMode(), heard: boolean[] = [];
    mode.onChange(on => heard.push(on));
    mode.onChange(on => heard.push(on));
    mode.toggle();
    mode.set(true); // already on: nobody is told again
    mode.set(false);
    expect(heard).toEqual([true, true, false, false]);
    expect(mode.on).toBe(false);
  });
});
