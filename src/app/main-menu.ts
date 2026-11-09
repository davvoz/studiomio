/* The app's menu bar: File, Edit, Create, View, Options, Help (as in Live).
 * Each item calls an app command; the shortcuts written here are those of KEYMAP. */
import { KEY, SEPARATOR, type MenuAction, type MenuItem } from '../ui/context-menu';
import { definitionTable, showDialog } from '../ui/dialog';
import type { Menu } from '../ui/menu-bar';
import type { App } from './app';

/** Shortcuts that aren't in any menu, for the shortcuts window. */
const OTHER_KEYS: readonly (readonly [string, string])[] = [
  ['Play / Stop', 'Space'],
  ['Stop and return to the start', 'Enter'],
  ['Timeline zoom', 'Ctrl+wheel'],
  ['Piano roll horizontal zoom', 'Ctrl+wheel'],
  ['Piano roll vertical zoom', 'Ctrl+wheel on the keys, Ctrl+Shift+wheel anywhere'],
  ['Drag without the grid', 'Alt'],
  ['Opening a menu', 'Alt+initial'],
];

/** The recent projects, in a row under "Open" (menus have no submenus), numbered as
 *  in Live. */
function recentItems(app: App): MenuItem[] {
  const list = app.recent.list;
  if (!list.length) return [];
  return [
    SEPARATOR,
    ...list.map((h, i) => ({ label: `${i + 1}  ${h.name}`, run: () => app.openRecent(h) })),
    { label: 'Clear the recent list', run: () => void app.recent.clear() },
  ];
}

export function mainMenu(app: App): Menu[] {
  const store = app.store, engine = app.audio.engine;
  const menus: Menu[] = [
    {
      label: 'File',
      items: () => [
        { label: 'New project', shortcut: 'Ctrl+N', run: () => app.newProject() },
        { label: 'Open project…', shortcut: 'Ctrl+O', run: () => app.open() },
        { label: 'Open project from ZIP…', run: () => app.chooseArchive() },
        ...recentItems(app),
        SEPARATOR,
        { label: 'Save', shortcut: 'Ctrl+S', run: () => app.save() },
        { label: 'Save as…', shortcut: 'Ctrl+Shift+S', run: () => app.saveAs() },
        { label: 'Collect and save as ZIP…', run: () => app.collectAndSave() },
        SEPARATOR,
        { label: 'Import audio…', run: () => app.chooseAudioFiles() },
        { label: 'Export the mix as WAV…', run: () => app.exportMix() },
        SEPARATOR,
        { label: 'Load the demo project', run: () => app.loadDemo() },
      ],
    },
    {
      label: 'Edit',
      items: () => [
        { label: store.undoLabel ? `Undo: ${store.undoLabel}` : 'Undo', shortcut: 'Ctrl+Z', disabled: !store.canUndo, run: () => app.undo() },
        { label: store.redoLabel ? `Redo: ${store.redoLabel}` : 'Repeat', shortcut: 'Ctrl+Y', disabled: !store.canRedo, run: () => app.redo() },
        SEPARATOR,
        { label: 'Cut', shortcut: KEY.cut, run: () => app.cutSelection() },
        { label: 'Copy', shortcut: KEY.copy, run: () => app.copySelection() },
        { label: 'Paste', shortcut: KEY.paste, disabled: !app.canPaste, run: () => app.paste() },
        { label: 'Duplicate', shortcut: KEY.duplicate, run: () => app.duplicateSelection() },
        { label: 'Duplicate loop', shortcut: KEY.duplicateLoop, run: () => app.duplicateLoop() },
        { label: 'Split at the cursor', shortcut: KEY.split, run: () => app.splitAtCursor() },
        { label: 'Consolidate', shortcut: KEY.consolidate, run: () => app.consolidateSelection() },
        { label: 'Copy to session', run: () => app.selectionToSession() },
        { label: 'Delete', shortcut: KEY.delete, run: () => app.deleteSelection() },
        SEPARATOR,
        { label: 'Select all', shortcut: KEY.selectAll, run: () => app.selectAll() },
      ],
    },
    {
      label: 'Create',
      items: () => [
        { label: 'New audio track', run: () => app.addTrack('audio') },
        { label: 'New MIDI track', run: () => app.addTrack('midi') },
        { label: 'New bus', run: () => app.addBus() },
        SEPARATOR,
        { label: 'Group tracks', shortcut: 'Ctrl+G', run: () => app.groupTracks() },
        { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', run: () => app.ungroupTracks() },
      ],
    },
    {
      label: 'View',
      items: () => [
        { label: 'Arrangement', shortcut: 'Tab', checked: !app.sessionView.isVisible, run: () => app.showView('arrangement') },
        { label: 'Session', shortcut: 'Tab', checked: app.sessionView.isVisible, run: () => app.showView('session') },
        SEPARATOR,
        { label: 'Browser', shortcut: 'Ctrl+Alt+B', checked: app.browser.isOpen, run: () => app.toggleBrowser() },
        { label: 'Search the browser', shortcut: 'Ctrl+F', run: () => app.searchBrowser() },
        SEPARATOR,
        { label: 'Zoom in', shortcut: '+', run: () => app.zoom(1.25) },
        { label: 'Zoom out', shortcut: '−', run: () => app.zoom(0.8) },
        SEPARATOR,
        { label: 'Back to the arrangement', disabled: !engine.arrangementOverridden, run: () => engine.backToArrangement() },
      ],
    },
    {
      label: 'Options',
      items: () => {
        const surfaces = app.surfaces, name = surfaces.connected;
        const controller = () => {
          if (name) return { label: `Controller MIDI: ${name}`, checked: true, disabled: true, run: () => {} };
          if (surfaces.enabled) return { label: 'MIDI controllers: connect an APC40 mkII or a Launchpad', disabled: true, run: () => {} };
          return { label: 'Enable the MIDI controllers…', run: () => app.run(() => surfaces.enable()) };
        };
        return [
          { label: 'Snap to grid', shortcut: 'Ctrl+4', checked: app.ui.snap, run: () => app.toggleSnap() },
          { label: 'Loop', shortcut: 'Ctrl+L', checked: store.project.loop.enabled, run: () => app.toggleLoop() },
          { label: 'Metronome', shortcut: 'Ctrl+Shift+M', checked: engine.metronomeOn, run: () => app.toggleMetronome() },
          { label: 'Follow the playhead', shortcut: 'Ctrl+Shift+F', checked: app.ui.follow, run: () => app.toggleFollow() },
          { label: 'Map the computer keyboard', shortcut: 'Ctrl+K', checked: app.ui.keyMapping, run: () => app.toggleKeyMap() },
          { label: 'Map MIDI', shortcut: 'Ctrl+M', checked: app.ui.midiMapping, run: () => app.toggleMidiMap() },
          SEPARATOR,
          controller(),
        ];
      },
    },
    {
      label: 'Help',
      items: () => [
        { label: 'Keyboard shortcuts', run: () => showShortcuts(menus) },
        SEPARATOR,
        { label: 'About studiomio', run: showAbout },
      ],
    },
  ];
  return menus;
}

/** The shortcuts, taken from the menus themselves (so they're not written twice). */
function showShortcuts(menus: readonly Menu[]): void {
  const sections = menus.map(m => ({
    title: m.label,
    rows: m.items().filter((i): i is MenuAction => typeof i === 'object' && 'shortcut' in i && !!i.shortcut)
      .map(i => [i.label.replace(/:.*/, ''), i.shortcut!] as const),
  })).filter(s => s.rows.length);
  showDialog('Keyboard shortcuts', definitionTable([...sections, { title: 'Other', rows: OTHER_KEYS }]));
}

function showAbout(): void {
  const p = (text: string, className = '') => Object.assign(document.createElement('p'), { textContent: text, className });
  showDialog('studiomio',
    p(`Version ${__APP_VERSION__}`, 'version'),
    p('DAW with Ableton Live-style warp: arrangement, session, instruments and effects, APC40 mkII and Launchpad controllers.'),
    p('© David'));
}
