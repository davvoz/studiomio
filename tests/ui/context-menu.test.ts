// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEPARATOR, showContextMenu, type MenuItem } from '../../src/ui/context-menu';

const menu = () => document.querySelector<HTMLElement>('.context-menu');
const items = () => [...document.querySelectorAll<HTMLButtonElement>('.context-menu button')];
const key = (k: string) => menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

afterEach(() => document.body.replaceChildren());

describe('context menu', () => {
  it('shows the commands with their mark and shortcut; a click closes it and runs the command', () => {
    const run = vi.fn(), onClose = vi.fn();
    showContextMenu(10, 20, [
      { label: 'Copy', shortcut: 'Ctrl+C', run },
      SEPARATOR,
      { label: 'Loop', checked: true, run: vi.fn() },
      { label: 'Paste', disabled: true, run: vi.fn() },
    ], { onClose });
    expect(menu()!.style.left).toBe('10px');
    expect(menu()!.style.top).toBe('20px');
    expect(document.querySelectorAll('.separator')).toHaveLength(1);
    expect(items().map(b => b.textContent)).toEqual(['CopyCtrl+C','✓Loop', 'Paste']);
    expect(items()[2].disabled).toBe(true);
    items()[0].click();
    expect(run).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(menu()).toBeNull();
  });

  it('stays inside the window near its edges', () => {
    showContextMenu(5000, -50, [{ label: 'A', run: vi.fn() }]);
    expect(menu()!.style.left).toBe(`${innerWidth - 4}px`);
    expect(menu()!.style.top).toBe('4px');
  });

  it('the arrows move among the enabled items, round; Esc and Tab close it; the opener\'s keys work too', () => {
    const right = vi.fn(), onClose = vi.fn();
    const list: MenuItem[] = [
      { label: 'A', run: vi.fn() }, { label: 'B', disabled: true, run: vi.fn() }, { label: 'C', run: vi.fn() },
    ];
    showContextMenu(0, 0, list, { keys: { ArrowRight: right }, onClose });
    const [a, , c] = items();
    key('ArrowDown');
    expect(document.activeElement).toBe(a);
    key('ArrowDown');
    expect(document.activeElement).toBe(c);
    key('ArrowDown');
    expect(document.activeElement).toBe(a);
    key('ArrowUp');
    expect(document.activeElement).toBe(c);
    key('ArrowRight');
    expect(right).toHaveBeenCalledOnce();
    // other keys stay in the menu and do nothing
    const other = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
    menu()!.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
    key('Escape');
    expect(menu()).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
    showContextMenu(0, 0, list);
    key('Tab');
    expect(menu()).toBeNull();
  });

  it('a pointer over an item focuses it', () => {
    showContextMenu(0, 0, [{ label: 'A', run: vi.fn() }, { colors: ['#f00'], pick: vi.fn() }]);
    for (const b of items()) {
      b.dispatchEvent(new PointerEvent('pointerenter'));
      expect(document.activeElement).toBe(b);
    }
  });

  it('closes on a press or a wheel outside it, on blur and resize, not on a press inside it', () => {
    for (const [target, type] of [[document.body, 'pointerdown'], [document.body, 'wheel'], [window, 'blur'], [window, 'resize']] as const) {
      const onClose = vi.fn();
      showContextMenu(0, 0, [{ label: 'A', run: vi.fn() }], { onClose });
      items()[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      expect(menu()).not.toBeNull();
      target.dispatchEvent(new Event(type, { bubbles: true }));
      expect(menu(), type).toBeNull();
      expect(onClose).toHaveBeenCalledOnce();
    }
  });

  it('only one is open: opening another closes the first', () => {
    const first = vi.fn();
    showContextMenu(0, 0, [{ label: 'A', run: vi.fn() }], { onClose: first });
    showContextMenu(0, 0, [{ label: 'B', run: vi.fn() }]);
    expect(first).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('.context-menu')).toHaveLength(1);
    expect(items()[0].textContent).toBe('B');
    // closing an old menu leaves the new one as the current
    menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menu()).toBeNull();
  });

  it('the colours: the current one marked, «no colour» unless required, a pick closes and gives the colour', () => {
    const pick = vi.fn();
    showContextMenu(0, 0, [{ colors: ['#FF0000', '#00ff00'], current: '#ff0000', noneTitle: 'Default', pick }]);
    const swatches = items();
    expect(swatches.map(s => s.title)).toEqual(['#FF0000', '#00ff00', 'Default']);
    expect(swatches.map(s => s.classList.contains('current'))).toEqual([true, false, false]);
    expect(swatches[0].style.getPropertyValue('--swatch')).toBe('#FF0000');
    expect(swatches[2].className).toContain('none');
    swatches[1].click();
    expect(pick).toHaveBeenCalledWith('#00ff00');
    expect(menu()).toBeNull();

    showContextMenu(0, 0, [{ colors: ['#f00'], pick }]);
    items()[1].click();
    expect(pick).toHaveBeenLastCalledWith(undefined);
    showContextMenu(0, 0, [{ colors: ['#f00'], required: true, pick }]);
    expect(items().map(s => s.title)).toEqual(['#f00']);
    showContextMenu(0, 0, [{ colors: [], pick }]);
    expect(items()[0].title).toBe('No colour');
  });
});
