/* The menu bar (File, Edit, …), as in desktop applications. The items are data,
 * asked for every time a menu opens: so check marks, disabled items and names
 * («Undo: Move clip») are always those of the moment. The drop-downs are the context menus. */
import { showContextMenu, type MenuItem } from './context-menu';

export interface Menu {
  readonly label: string;
  readonly items: () => readonly MenuItem[];
}

export class MenuBar {
  readonly element = Object.assign(document.createElement('nav'), { className: 'menubar', role: 'menubar' });
  private readonly titles: HTMLButtonElement[] = [];
  private readonly title = Object.assign(document.createElement('span'), { className: 'title' });
  private readonly aside = Object.assign(document.createElement('div'), { className: 'aside' });
  /** The open menu (index), or null. */
  private open: number | null = null;
  /** The menu just closed by the click on its own title: that click mustn't reopen it. */
  private justClosed: number | null = null;

  constructor(private readonly menus: readonly Menu[], private readonly projectTitle: () => string) {
    menus.forEach((menu, i) => {
      const b = Object.assign(document.createElement('button'), {
        className: 'menu-title', textContent: menu.label, role: 'menuitem', title: `Alt+${menu.label[0]}`,
      });
      b.onpointerdown = e => {
        if (e.button !== 0) return;
        e.preventDefault(); // the focus stays on the menu that opens
        if (this.justClosed !== i) this.show(i);
      };
      b.onpointerenter = () => { if (this.open !== null && this.open !== i) this.show(i); };
      b.onclick = e => { if (e.detail === 0) this.show(i); }; // Enter or Space on the title
      this.titles.push(b);
    });
    this.element.append(...this.titles, this.title, this.aside);
    // Alt + initial opens the menu (the initials are all different)
    document.addEventListener('keydown', e => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const i = menus.findIndex(m => m.label[0].toLowerCase() === e.key.toLowerCase());
      if (i < 0) return;
      e.preventDefault();
      this.show(i);
    });
    this.render();
  }

  /** Puts some controls on the right, after the title. */
  addAside(...nodes: Node[]): void {
    this.aside.append(...nodes);
  }

  render(): void {
    const t = this.projectTitle();
    this.title.textContent = t;
    document.title = `${t} — studiomio`;
  }

  private show(i: number): void {
    const b = this.titles[i], r = b.getBoundingClientRect();
    const step = (dir: 1 | -1) => () => this.show((i + dir + this.menus.length) % this.menus.length);
    showContextMenu(r.left, r.bottom + 2, this.menus[i].items(), {
      keys: { ArrowLeft: step(-1), ArrowRight: step(1) },
      onClose: () => {
        b.classList.remove('open');
        if (this.open === i) this.open = null;
        this.justClosed = i;
        setTimeout(() => { if (this.justClosed === i) this.justClosed = null; });
      },
    });
    this.open = i;
    b.classList.add('open');
  }
}
