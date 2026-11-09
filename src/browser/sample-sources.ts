/* The places with audio: the open project's samples (Live's "Current Project") and the disk
 * folders the user adds ("Places"). The disk is read through `FolderReader`: in the
 * browser and in Electron it's the File System Access API (fs-folder.ts), in tests a fake. */
import type { Unsubscribe } from '../core/emitter';
import type { SampleRef } from '../model/sample';
import type { BrowserItem, BrowserSource } from './item';

/** The audio files the browser shows (a folder's other files are skipped). */
export const AUDIO_FILE = /\.(wav|wave|aif|aiff|flac|mp3|ogg|oga|opus|m4a)$/i;

/** "0:04", "1:02": a sample's duration. */
export function duration(seconds: number): string {
  if (seconds < 10) return `${seconds.toFixed(1).replace('.', ',')} s`;
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** What's needed of the open project (ProjectStore satisfies it). */
export interface SampleProvider {
  readonly project: { readonly samples: readonly SampleRef[] };
  onChange(fn: () => void): Unsubscribe;
}

/** The open project's samples, in name order. */
export function projectSamplesSource(store: SampleProvider): BrowserSource {
  const id = 'project';
  return {
    id, label: 'Current project', section: 'places',
    empty: 'No samples in the project: import or drag in some audio files.',
    items: async () => [...store.project.samples].sort((a, b) => a.name.localeCompare(b.name)).map((s): BrowserItem => ({
      id: `${id}/${s.id}`, name: s.name, icon: 'sample', hint: duration(s.frames / s.sampleRate), payload: { kind: 'sample', sample: s },
    })),
    // reread only when the samples change, not at every project change
    onChange: fn => {
      let samples = store.project.samples;
      return store.onChange(() => {
        if (store.project.samples === samples) return;
        samples = store.project.samples;
        fn();
      });
    },
  };
}

/** An item of a disk folder. */
export type FolderEntry =
  | { readonly kind: 'folder'; readonly name: string; readonly folder: FolderReader }
  | { readonly kind: 'file'; readonly name: string; readonly file: () => Promise<File> };

/** A disk folder, to be read. */
export interface FolderReader {
  readonly name: string;
  entries(): Promise<readonly FolderEntry[]>;
  /** Can it be read without asking for permission? (Without: yes.) */
  readable?(): Promise<boolean>;
  /** Asks for permission to read it (after a user click). */
  request?(): Promise<boolean>;
}

/** A folder's items: first the subfolders, then the audio files, each in name order. */
async function folderItems(prefix: string, folder: FolderReader): Promise<BrowserItem[]> {
  const entries = [...await folder.entries()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const folders = entries.flatMap((e): BrowserItem[] => (e.kind === 'folder' && !e.name.startsWith('.')
    ? [{ id: `${prefix}/${e.name}`, name: e.name, icon: 'folder', children: () => folderItems(`${prefix}/${e.name}`, e.folder) }] : []));
  const files = entries.flatMap((e): BrowserItem[] => (e.kind === 'file' && AUDIO_FILE.test(e.name)
    ? [{ id: `${prefix}/${e.name}`, name: e.name.replace(/\.[^.]+$/, ''), icon: 'sample', hint: e.name.slice(e.name.lastIndexOf('.') + 1).toLowerCase(), payload: { kind: 'file', name: e.name, file: e.file } }] : []));
  return [...folders, ...files];
}

/** A disk folder as a browser place; `id` tells it apart from others with the same name. */
export function folderSource(id: string, folder: FolderReader): BrowserSource {
  return {
    id, label: folder.name, section: 'places', removable: true, empty: 'No audio files in this folder.',
    items: () => folderItems(id, folder),
    locked: folder.readable && (async () => !(await folder.readable!())),
    unlock: folder.request && (() => folder.request!()),
  };
}
