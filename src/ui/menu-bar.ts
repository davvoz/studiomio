/* La barra dei menu (File, Modifica, …), come nelle applicazioni desktop. Le voci sono dati,
 * chiesti ogni volta che un menu si apre: così segni di spunta, voci disattivate e nomi
 * («Annulla: Sposta clip») sono sempre quelli del momento. Le tendine sono i menu contestuali. */
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
  /** Il menu aperto (indice), o null. */
  private open: number | null = null;
  /** Il menu appena chiuso dal clic sul suo stesso titolo: quel clic non deve riaprirlo. */
  private justClosed: number | null = null;

  constructor(private readonly menus: readonly Menu[], private readonly projectTitle: () => string) {
    menus.forEach((menu, i) => {
      const b = Object.assign(document.createElement('button'), {
        className: 'menu-title', textContent: menu.label, role: 'menuitem', title: `Alt+${menu.label[0]}`,
      });
      b.onpointerdown = e => {
        if (e.button !== 0) return;
        e.preventDefault(); // il fuoco resta al menu che si apre
        if (this.justClosed !== i) this.show(i);
      };
      b.onpointerenter = () => { if (this.open !== null && this.open !== i) this.show(i); };
      b.onclick = e => { if (e.detail === 0) this.show(i); }; // Invio o Spazio sul titolo
      this.titles.push(b);
    });
    this.element.append(...this.titles, this.title, this.aside);
    // Alt + iniziale apre il menu (le iniziali sono tutte diverse)
    document.addEventListener('keydown', e => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const i = menus.findIndex(m => m.label[0].toLowerCase() === e.key.toLowerCase());
      if (i < 0) return;
      e.preventDefault();
      this.show(i);
    });
    this.render();
  }

  /** Mette dei controlli a destra, dopo il titolo. */
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
