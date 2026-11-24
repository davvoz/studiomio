import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClipId } from '../../src/core/id';
import { MemoryDirectory, type Directory } from '../../src/persistence/directory';
import { DesktopDirectory } from '../../src/persistence/desktop-directory';
import { FsAccessDirectory } from '../../src/persistence/fs-access-directory';
import { ProjectFiles, diskFolders, projectPicker, recentEntry, reopenRecent, type ProjectFilesDeps } from '../../src/app/project-files';
import { keepUiInProject } from '../../src/app/ui-upkeep';
import { automationClip, browserTarget, importTarget } from '../../src/app/work-targets';
import { addMidiClip, groupTracks, removeTrack, setGroupFolded } from '../../src/store/edits';
import { newSlotMidiClip } from '../../src/store/session-edits';
import { placementRef, slotRef } from '../../src/store/clip-ref';
import { UiState } from '../../src/ui/ui-state';
import { setup } from '../helpers/fixtures';

/** The project files with a fake session and dialogs: `answers` are the dialogs' choices, in order. */
function files(opts: { changed?: boolean; recovery?: boolean; answers?: (string | null)[]; reopen?: Directory | null; hasProject?: boolean } = {}) {
  const calls: string[] = [], said: string[] = [], answers = [...(opts.answers ?? [])];
  const work: Promise<unknown>[] = [];
  const dir = { name: 'folder' } as unknown as Directory;
  const session = {
    name: 'Song', changed: opts.changed ?? false,
    newProject: (blank?: boolean) => { calls.push(blank ? 'new blank' : 'new'); },
    open: async (d?: Directory) => { calls.push(d ? 'open dir' : 'open pick'); },
    save: async () => { calls.push('save'); },
    saveAs: async () => { calls.push('saveAs'); },
    openArchive: async (f: File) => { calls.push(`archive ${f.name}`); },
    importFrom: async () => { calls.push('import'); },
    collectAndSave: async () => new File([], 'Song.zip'),
    hasRecovery: async () => opts.recovery ?? false,
    restoreRecovery: async () => { calls.push('restore'); },
    discardRecovery: async () => { calls.push('discard'); },
    forgetChanges: () => { calls.push('forget'); },
  };
  const deps: ProjectFilesDeps = {
    session: session as unknown as ProjectFilesDeps['session'],
    recent: { remove: async () => { calls.push('recent removed'); } } as unknown as ProjectFilesDeps['recent'],
    choose: async <T,>(title: string) => { calls.push(`ask ${title}`); return (answers.shift() ?? null) as T | null; },
    chooseImport: async () => null,
    reopen: async () => (opts.reopen === undefined ? dir : opts.reopen),
    pathFolder: path => (path ? dir : null),
    hasProject: async () => opts.hasProject ?? true,
    buildDemo: async () => { calls.push('demo'); },
    download: (_f, name) => { calls.push(`download ${name}`); },
    run: action => { work.push(Promise.resolve().then(action)); },
    say: t => said.push(t),
  };
  return { files: new ProjectFiles(deps), calls, said, done: () => Promise.all(work) };
}

describe('project files', () => {
  it('without changes: new, open, save, save as, import, collect go straight', async () => {
    const f = files();
    f.files.newProject();
    f.files.open();
    f.files.save();
    f.files.saveAs();
    f.files.importFromProject();
    f.files.collectAndSave();
    await f.done();
    expect(f.calls).toEqual(['save', 'saveAs', 'import', 'new', 'open pick', 'download Song.zip']);
  });

  it.each([
    ['save', ['ask Save changes?', 'save', 'new']],
    ['discard', ['ask Save changes?', 'discard', 'new']],
    ['cancel', ['ask Save changes?']],
    [null, ['ask Save changes?']],
  ])('with changes, answering %s: save, don\'t save (the recovery copy goes) or give up', async (answer, expected) => {
    const f = files({ changed: true, answers: [answer] });
    f.files.newProject();
    await f.done();
    expect(f.calls).toEqual(expected);
  });

  it.each([
    ['restore', 'restore'],
    ['discard', 'discard'],
    [null, 'ask Recover unsaved changes?'],
  ])('opening a project with changes never saved, answering %s', async (answer, last) => {
    const f = files({ recovery: true, answers: [answer] });
    f.files.open();
    await f.done();
    expect(f.calls.at(-1)).toBe(last);
  });

  it('a recent project that is gone leaves the list', async () => {
    const gone = files({ reopen: null });
    gone.files.openRecent('C:/x/Song');
    await gone.done();
    expect(gone.calls).toEqual(['recent removed']);
    expect(gone.said[0]).toMatch(/^"Song" is gone/);
    const empty = files({ hasProject: false });
    empty.files.openRecent('C:/x/Song');
    await empty.done();
    expect(empty.calls).toEqual(['recent removed']);
    const ok = files();
    ok.files.openRecent('C:/x/Song');
    await ok.done();
    expect(ok.calls).toEqual(['open dir']);
  });

  it('a path from Windows opens (outside the desktop app nothing happens); a ZIP dropped opens, other files import', async () => {
    const f = files();
    f.files.openPath('');
    f.files.openPath('C:/x/Song');
    let imported = 0;
    f.files.dropFiles([new File([], 'a.wav')], async () => { imported++; });
    f.files.dropFiles([new File([], 'a.wav'), new File([], 'Song.ZIP')], async () => { imported++; });
    await f.done();
    expect(imported).toBe(1);
    expect(f.calls).toEqual(['open dir', 'archive Song.ZIP']);
  });

  it('the demo: a blank project, filled, without changes to save', async () => {
    const f = files();
    f.files.loadDemo();
    await f.done();
    expect(f.calls).toEqual(['new blank', 'demo', 'forget']);
    expect(f.said).toEqual(['Demo project loaded: press Space to listen to it.']);
    const kept = files({ changed: true, answers: ['cancel'] });
    kept.files.loadDemo();
    await kept.done();
    expect(kept.calls).toEqual(['ask Save changes?']);
  });

  it('a folder that is neither a browser handle nor a desktop path isn\'t remembered', () => {
    expect(recentEntry({} as Directory)).toBeNull();
  });
});

describe('ui upkeep', () => {
  it('deleted clips leave the selection; removed tracks leave the armed ones and the choice', () => {
    const { store, track } = setup({ midi: 2 });
    store.apply(addMidiClip(track(0), 0, 4));
    store.apply(addMidiClip(track(1), 0, 4));
    const ui = new UiState(), [a, b] = [track(0), track(1)];
    ui.select(store.project.tracks.flatMap(t => t.arrangement.map(x => x.id)));
    ui.toggleKeyboardTrack(b);
    ui.selectTrack(b);
    store.apply(removeTrack(b));
    keepUiInProject(store.project, ui);
    expect(ui.selection.size).toBe(1);
    expect(ui.keyboardTracks.has(b)).toBe(false);
    expect(ui.track).toBeNull();
    ui.selectTrack(a);
    keepUiInProject(store.project, ui);
    expect(ui.track).toBe(a);
  });

  it('a chosen track hidden in a closed group passes the choice to the group', () => {
    const { store, track } = setup({ midi: 2 });
    const inner = track(1);
    store.apply(groupTracks([inner]));
    const group = store.project.tracks.find(t => t.id !== inner && t.kind !== 'midi')!;
    const ui = new UiState();
    ui.selectTrack(inner);
    store.apply(setGroupFolded(group.id, true));
    keepUiInProject(store.project, ui);
    expect(ui.track).toBe(group.id);
  });
});

describe('work targets', () => {
  const sample = { payload: { kind: 'sample' } } as never, device = { payload: { kind: 'device' } } as never;
  const at = { chain: null, session: null, track: 't1' as never, cursor: 8 };

  it('a double-clicked item: a device in the open chain, a sample in the session slot, otherwise at the cursor', () => {
    expect(browserTarget(device, { ...at, chain: 't2' as never })).toEqual({ kind: 'chain', owner: 't2' });
    expect(browserTarget(sample, { ...at, chain: 't2' as never })).toEqual({ kind: 'lane', track: 't1', beat: 8 });
    expect(browserTarget(sample, { ...at, session: { slot: { track: 't3' as never, slot: 2 } } })).toEqual({ kind: 'slot', track: 't3', slot: 2 });
    expect(browserTarget(sample, { ...at, session: { slot: null } })).toEqual({ kind: 'slot', track: 't1', slot: 0 });
    expect(browserTarget(device, { ...at, session: { slot: null } })).toEqual({ kind: 'lane', track: 't1', beat: 8 });
  });

  it('imported files: the session slot (or a new track), otherwise the cursor', () => {
    expect(importTarget({ session: { slot: { track: 't3' as never, slot: 1 } }, cursor: 4 })).toEqual({ kind: 'slots', track: 't3', slot: 1 });
    expect(importTarget({ session: { slot: null }, cursor: 4 })).toEqual({ kind: 'slots', track: null, slot: 0 });
    expect(importTarget({ session: null, cursor: 4 })).toEqual({ kind: 'timeline', beat: 4 });
  });

  it('the clip "Show automation" draws in: the last opened, the playing one, a slot\'s, the timeline\'s', () => {
    const { store, track } = setup({ midi: 2 });
    const t = track(0), p = () => store.project;
    expect(automationClip(p(), 'gone' as never, undefined, undefined)).toBeNull();
    expect(automationClip(p(), t, undefined, undefined)).toBeNull();
    store.apply(addMidiClip(t, 0, 4));
    const placed = placementRef(t, p().track(t)!.arrangement[0].id);
    expect(automationClip(p(), t, undefined, undefined)).toEqual(placed);
    store.apply(newSlotMidiClip({ track: t, slot: 1 }));
    const slot = slotRef(t, p().track(t)!.slots[1]!.id);
    expect(automationClip(p(), t, undefined, undefined)).toEqual(slot);
    expect(automationClip(p(), t, undefined, 'c9' as ClipId)).toEqual(slotRef(t, 'c9' as ClipId));
    expect(automationClip(p(), t, placed, 'c9' as ClipId)).toEqual(placed);
    expect(automationClip(p(), t, slotRef(t, 'gone' as ClipId), undefined)).toEqual(slot);
  });
});

describe('project folders on disk', () => {
  afterEach(() => vi.unstubAllGlobals());
  const handle = (perm: () => Promise<string>) => ({ name: 'Song', queryPermission: perm }) as unknown as FileSystemDirectoryHandle;

  it('in the browser: folders by handle; a recent one gone or refused', async () => {
    expect(projectPicker()).toBe(FsAccessDirectory.pick);
    const dir = new FsAccessDirectory(handle(async () => 'granted'));
    expect(recentEntry(dir)).toBe(dir.root);
    expect(await reopenRecent('C:/x/Song')).toBeNull();
    expect(await reopenRecent(handle(async () => 'granted'))).toBeInstanceOf(FsAccessDirectory);
    expect(await reopenRecent(handle(async () => { throw new DOMException('gone', 'NotFoundError'); }))).toBeNull();
    await expect(reopenRecent(handle(async () => { throw new Error('broken'); }))).rejects.toThrow('broken');
    expect(diskFolders.pathFolder('C:/x')).toBeNull();
    expect(await diskFolders.hasProject(new MemoryDirectory('empty'))).toBe(false);
  });

  it('in the desktop app: folders by path', async () => {
    vi.stubGlobal('window', { studiomioDesktop: { folders: {} } });
    expect(projectPicker()).not.toBe(FsAccessDirectory.pick);
    const reopened = await reopenRecent('C:/x/Song');
    expect(reopened).toBeInstanceOf(DesktopDirectory);
    expect(recentEntry(reopened!)).toBe('C:/x/Song');
    expect(diskFolders.pathFolder('C:/x')).toBeInstanceOf(DesktopDirectory);
  });
});
