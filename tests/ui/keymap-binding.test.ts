import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindKeys, findBinding, KEYMAP, ownedByField, releaseSelectsAfterClick, type Binding, type Commands } from '../../src/ui/keymap';

/** Stand-in for HTMLInputElement: ownedByField checks `instanceof` on it. */
class FakeInput {
  isContentEditable = false;
  tagName = 'INPUT';
  constructor(readonly type: string) {}
}

const ev = (over: Partial<KeyboardEvent>) =>
  ({ key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over }) as KeyboardEvent;

afterEach(() => vi.unstubAllGlobals());

describe('which keys a focused field owns', () => {
  it('nothing focused, or a plain element: the keys are shortcuts', () => {
    vi.stubGlobal('HTMLInputElement', FakeInput);
    expect(ownedByField(null, ev({ key: 'b' }))).toBe(false);
    expect(ownedByField({ tagName: 'DIV', isContentEditable: false } as HTMLElement, ev({ key: 'b' }))).toBe(false);
  });

  it('editable content owns every key', () => {
    vi.stubGlobal('HTMLInputElement', FakeInput);
    expect(ownedByField({ tagName: 'DIV', isContentEditable: true } as HTMLElement, ev({ key: 'b' }))).toBe(true);
  });

  it('text-like inputs own every key, a slider only the arrows and paging keys', () => {
    vi.stubGlobal('HTMLInputElement', FakeInput);
    for (const type of ['text', 'number', 'search', 'email', 'url', 'password', 'tel']) {
      expect(ownedByField(new FakeInput(type) as unknown as HTMLElement, ev({ key: 'b' }))).toBe(true);
    }
    const slider = new FakeInput('range') as unknown as HTMLElement;
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
      expect(ownedByField(slider, ev({ key }))).toBe(true);
    }
    expect(ownedByField(slider, ev({ key: 'z', ctrlKey: true }))).toBe(false);
    expect(ownedByField(slider, ev({ key: ' ' }))).toBe(false);
  });
});

describe('finding the binding of a key', () => {
  const calls: string[] = [];
  const map: Binding<string[]>[] = [
    { key: 'a', run: c => c.push('a') },
    { key: 'a', ctrl: true, run: c => c.push('ctrl+a') },
    { key: 'a', ctrl: true, shift: true, run: c => c.push('ctrl+shift+a') },
    { key: 'q', alt: true, run: c => c.push('alt+q') },
    { key: '+', shift: false, run: c => c.push('plus') },
    { key: 'Space', run: c => c.push('space') },
  ];
  const run = (e: KeyboardEvent) => { calls.length = 0; findBinding(map, e)?.run(calls); return calls[0]; };

  it('matches the key case-insensitively, by name or by code', () => {
    expect(run(ev({ key: 'A' }))).toBe('a');
    expect(run(ev({ key: ' ', code: 'Space' }))).toBe('space');
    expect(run(ev({ key: 'x' }))).toBeUndefined();
  });

  it('Ctrl and Meta are the same modifier; Shift picks the shifted shortcut when Ctrl is down', () => {
    expect(run(ev({ key: 'a', ctrlKey: true }))).toBe('ctrl+a');
    expect(run(ev({ key: 'a', metaKey: true }))).toBe('ctrl+a');
    expect(run(ev({ key: 'a', ctrlKey: true, shiftKey: true }))).toBe('ctrl+shift+a');
  });

  it('Shift alone does not stop a plain shortcut, but an explicit shift:false does', () => {
    expect(run(ev({ key: 'a', shiftKey: true }))).toBe('a');
    expect(run(ev({ key: '+' }))).toBe('plus');
    expect(run(ev({ key: '+', shiftKey: true }))).toBeUndefined();
  });

  it('only a shortcut naming Alt looks at it', () => {
    expect(run(ev({ key: 'q', altKey: true }))).toBe('alt+q');
    expect(run(ev({ key: 'q' }))).toBeUndefined();
    expect(run(ev({ key: 'a', altKey: true }))).toBe('a');
  });

  it('every shortcut of the app is unique for its modifiers', () => {
    const ids = KEYMAP.map(k => `${k.key}|${!!k.ctrl}|${k.shift}|${k.alt}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every shortcut runs exactly one command, with the expected zoom factors', () => {
    const table = KEYMAP.map(b => {
      const called: [string, unknown[]][] = [];
      const app = new Proxy({}, { get: (_t, name) => (...args: unknown[]) => { called.push([String(name), args]); } });
      b.run(app as Commands);
      expect(called).toHaveLength(1);
      return `${b.ctrl ? 'ctrl+' : ''}${b.alt ? 'alt+' : ''}${b.shift ? 'shift+' : ''}${b.key}=${called[0][0]}${called[0][1].join(',')}`;
    });
    expect(table).toEqual(expect.arrayContaining([
      'Space=togglePlay', 'tab=toggleView', 'Enter=stopAndRewind', 'ctrl+z=undo', 'ctrl+shift+z=redo', 'ctrl+y=redo',
      'delete=deleteSelection', 'backspace=deleteSelection', 'ctrl+d=duplicateSelection', 'ctrl+shift+d=duplicateLoop',
      'ctrl+x=cutSelection', 'ctrl+c=copySelection', 'ctrl+v=paste', 'ctrl+e=splitAtCursor', 'ctrl+j=consolidateSelection',
      'ctrl+a=selectAll', 'ctrl+l=toggleLoop', 'ctrl+shift+m=toggleMetronome', 'ctrl+1=narrowGrid', 'ctrl+2=widenGrid',
      'ctrl+3=toggleTriplet', 'ctrl+4=toggleSnap', '+=zoom1.25', '==zoom1.25', '-=zoom0.8', 'ctrl+n=newProject',
      'ctrl+s=save', 'ctrl+shift+s=saveAs', 'ctrl+o=open', 'ctrl+g=groupTracks', 'ctrl+shift+g=ungroupTracks',
      'ctrl+alt+b=toggleBrowser', 'ctrl+f=searchBrowser', 'ctrl+shift+f=toggleFollow', 'ctrl+k=toggleKeyMap', 'ctrl+m=toggleMidiMap',
    ]));
  });
});

/** A target that records its listeners, as a Document or an element would. */
function fakeTarget() {
  const listeners: Record<string, ((e: Event) => void)[]> = {};
  return {
    addEventListener: (type: string, fn: (e: Event) => void) => { listeners[type] = [...(listeners[type] ?? []), fn]; },
    fire: (type: string, e: object) => listeners[type]?.forEach(fn => fn(e as Event)),
  };
}

describe('bindKeys', () => {
  const keyEvent = (over: Partial<KeyboardEvent>) => {
    const e = { ...ev(over), target: null, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    return e;
  };

  it('runs the command, prevents the default and, with ownKeys, stops the propagation', () => {
    vi.stubGlobal('HTMLInputElement', FakeInput);
    const target = fakeTarget(), calls: string[] = [];
    bindKeys(target as unknown as HTMLElement, calls, [{ key: 'b', run: c => c.push('b') }], true);
    const e = keyEvent({ key: 'b' });
    target.fire('keydown', e);
    expect(calls).toEqual(['b']);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
  });

  it('without ownKeys the event goes on; unbound keys and field keys are left alone', () => {
    vi.stubGlobal('HTMLInputElement', FakeInput);
    const target = fakeTarget(), calls: string[] = [];
    bindKeys(target as unknown as HTMLElement, calls, [{ key: 'b', run: c => c.push('b') }]);
    const bound = keyEvent({ key: 'b' });
    target.fire('keydown', bound);
    expect(bound.stopPropagation).not.toHaveBeenCalled();
    const unbound = keyEvent({ key: 'q' });
    target.fire('keydown', unbound);
    expect(unbound.preventDefault).not.toHaveBeenCalled();
    const typing = { ...keyEvent({ key: 'b' }), target: new FakeInput('text') };
    target.fire('keydown', typing);
    expect(typing.preventDefault).not.toHaveBeenCalled();
    expect(calls).toEqual(['b']);
  });
});

describe('releaseSelectsAfterClick', () => {
  function fakeDocument() {
    const listeners: Record<string, (e: unknown) => void> = {};
    const doc = { addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; } };
    return { doc: doc as unknown as Document, listeners };
  }
  const select = () => ({ tagName: 'SELECT', blur: vi.fn() });

  it('a select changed right after a mouse click gives the focus back', () => {
    const { doc, listeners } = fakeDocument();
    releaseSelectsAfterClick(doc);
    const s = select();
    listeners.pointerdown({ target: s });
    listeners.change({ target: s });
    expect(s.blur).toHaveBeenCalledOnce();
  });

  it('a select changed with the keyboard, or another element, keeps the focus', () => {
    const { doc, listeners } = fakeDocument();
    releaseSelectsAfterClick(doc);
    const s = select(), other = select(), input = { tagName: 'INPUT', blur: vi.fn() };
    listeners.pointerdown({ target: other });
    listeners.change({ target: s });
    listeners.pointerdown({ target: input });
    listeners.change({ target: input });
    listeners.change({ target: null });
    expect(s.blur).not.toHaveBeenCalled();
    expect(input.blur).not.toHaveBeenCalled();
  });
});
