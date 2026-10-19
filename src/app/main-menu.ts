/* La barra dei menu dell'app: File, Modifica, Crea, Vista, Opzioni, Aiuto (come in Live).
 * Ogni voce chiama un comando dell'app; le scorciatoie scritte qui sono quelle di KEYMAP. */
import { KEY, SEPARATOR, type MenuAction } from '../ui/context-menu';
import { definitionTable, showDialog } from '../ui/dialog';
import type { Menu } from '../ui/menu-bar';
import type { App } from './app';

/** Scorciatoie che non stanno in nessun menu, per la finestra delle scorciatoie. */
const OTHER_KEYS: readonly (readonly [string, string])[] = [
  ['Play / Stop', 'Spazio'],
  ['Stop e torna all\'inizio', 'Invio'],
  ['Zoom della timeline', 'Ctrl+rotella'],
  ['Trascinare senza griglia', 'Alt'],
  ['Aprire un menu', 'Alt+iniziale'],
];

export function mainMenu(app: App): Menu[] {
  const store = app.store, engine = app.audio.engine;
  const menus: Menu[] = [
    {
      label: 'File',
      items: () => [
        { label: 'Nuovo progetto', shortcut: 'Ctrl+N', run: () => app.newProject() },
        { label: 'Apri progetto…', shortcut: 'Ctrl+O', run: () => app.open() },
        SEPARATOR,
        { label: 'Salva', shortcut: 'Ctrl+S', run: () => app.save() },
        { label: 'Salva con nome…', shortcut: 'Ctrl+Maiusc+S', run: () => app.saveAs() },
        SEPARATOR,
        { label: 'Importa audio…', run: () => app.chooseAudioFiles() },
        { label: 'Esporta il mix in WAV…', run: () => app.exportMix() },
        SEPARATOR,
        { label: 'Carica il progetto demo', run: () => app.loadDemo() },
      ],
    },
    {
      label: 'Modifica',
      items: () => [
        { label: store.undoLabel ? `Annulla: ${store.undoLabel}` : 'Annulla', shortcut: 'Ctrl+Z', disabled: !store.canUndo, run: () => app.undo() },
        { label: store.redoLabel ? `Ripeti: ${store.redoLabel}` : 'Ripeti', shortcut: 'Ctrl+Y', disabled: !store.canRedo, run: () => app.redo() },
        SEPARATOR,
        { label: 'Taglia', shortcut: KEY.cut, run: () => app.cutSelection() },
        { label: 'Copia', shortcut: KEY.copy, run: () => app.copySelection() },
        { label: 'Incolla', shortcut: KEY.paste, disabled: !app.canPaste, run: () => app.paste() },
        { label: 'Duplica', shortcut: KEY.duplicate, run: () => app.duplicateSelection() },
        { label: 'Dividi al cursore', shortcut: KEY.split, run: () => app.splitAtCursor() },
        { label: 'Elimina', shortcut: KEY.delete, run: () => app.deleteSelection() },
        SEPARATOR,
        { label: 'Seleziona tutto', shortcut: KEY.selectAll, run: () => app.selectAll() },
      ],
    },
    {
      label: 'Crea',
      items: () => [
        { label: 'Nuova traccia audio', run: () => app.addTrack('audio') },
        { label: 'Nuova traccia MIDI', run: () => app.addTrack('midi') },
        { label: 'Nuovo bus', run: () => app.addBus() },
        SEPARATOR,
        { label: 'Raggruppa le tracce', shortcut: 'Ctrl+G', run: () => app.groupTracks() },
        { label: 'Separa il gruppo', shortcut: 'Ctrl+Maiusc+G', run: () => app.ungroupTracks() },
      ],
    },
    {
      label: 'Vista',
      items: () => [
        { label: 'Arrangement', shortcut: 'Tab', checked: !app.sessionView.isVisible, run: () => app.showView('arrangement') },
        { label: 'Session', shortcut: 'Tab', checked: app.sessionView.isVisible, run: () => app.showView('session') },
        SEPARATOR,
        { label: 'Zoom avanti', shortcut: '+', run: () => app.zoom(1.25) },
        { label: 'Zoom indietro', shortcut: '−', run: () => app.zoom(0.8) },
        SEPARATOR,
        { label: 'Torna all\'arrangement', disabled: !engine.arrangementOverridden, run: () => engine.backToArrangement() },
      ],
    },
    {
      label: 'Opzioni',
      items: () => {
        const surfaces = app.surfaces, name = surfaces.connected;
        return [
          { label: 'Aggancio alla griglia', shortcut: 'Ctrl+4', checked: app.ui.snap, run: () => app.toggleSnap() },
          { label: 'Loop', shortcut: 'Ctrl+L', checked: store.project.loop.enabled, run: () => app.toggleLoop() },
          { label: 'Metronomo', shortcut: 'Ctrl+Maiusc+M', checked: engine.metronomeOn, run: () => app.toggleMetronome() },
          SEPARATOR,
          name ? { label: `Controller MIDI: ${name}`, checked: true, disabled: true, run: () => {} }
            : surfaces.enabled ? { label: 'Controller MIDI: collega un APC40 mkII o un Launchpad', disabled: true, run: () => {} }
              : { label: 'Attiva i controller MIDI…', run: () => app.run(() => surfaces.enable()) },
        ];
      },
    },
    {
      label: 'Aiuto',
      items: () => [
        { label: 'Scorciatoie da tastiera', run: () => showShortcuts(menus) },
        SEPARATOR,
        { label: 'Informazioni su studiomio', run: showAbout },
      ],
    },
  ];
  return menus;
}

/** Le scorciatoie, prese dai menu stessi (così non si scrivono due volte). */
function showShortcuts(menus: readonly Menu[]): void {
  const sections = menus.map(m => ({
    title: m.label,
    rows: m.items().filter((i): i is MenuAction => typeof i === 'object' && 'shortcut' in i && !!i.shortcut)
      .map(i => [i.label.replace(/:.*/, ''), i.shortcut!] as const),
  })).filter(s => s.rows.length);
  showDialog('Scorciatoie da tastiera', definitionTable([...sections, { title: 'Altro', rows: OTHER_KEYS }]));
}

function showAbout(): void {
  const p = (text: string, className = '') => Object.assign(document.createElement('p'), { textContent: text, className });
  showDialog('studiomio',
    p(`Versione ${__APP_VERSION__}`, 'version'),
    p('DAW con warp in stile Ableton Live: arrangement, session, strumenti ed effetti, controller APC40 mkII e Launchpad.'),
    p('© David'));
}
