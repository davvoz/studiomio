/* I luoghi con l'audio: i sample del progetto aperto ("Current Project" di Live) e le cartelle
 * del disco che l'utente aggiunge ("Places"). Il disco si legge attraverso `FolderReader`: nel
 * browser e in Electron è la File System Access API (fs-folder.ts), nei test una finta. */
import type { Unsubscribe } from '../core/emitter';
import type { SampleRef } from '../model/sample';
import type { BrowserItem, BrowserSource } from './item';

/** I file audio che il browser mostra (gli altri file di una cartella si saltano). */
export const AUDIO_FILE = /\.(wav|wave|aif|aiff|flac|mp3|ogg|oga|opus|m4a)$/i;

/** "0:04", "1:02": la durata di un sample. */
export function duration(seconds: number): string {
  if (seconds < 10) return `${seconds.toFixed(1).replace('.', ',')} s`;
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Ciò che serve del progetto aperto (ProjectStore lo soddisfa). */
export interface SampleProvider {
  readonly project: { readonly samples: readonly SampleRef[] };
  onChange(fn: () => void): Unsubscribe;
}

/** I sample del progetto aperto, in ordine di nome. */
export function projectSamplesSource(store: SampleProvider): BrowserSource {
  const id = 'project';
  return {
    id, label: 'Progetto corrente', section: 'places',
    empty: 'Nessun sample nel progetto: importa o trascina dei file audio.',
    items: async () => [...store.project.samples].sort((a, b) => a.name.localeCompare(b.name)).map((s): BrowserItem => ({
      id: `${id}/${s.id}`, name: s.name, icon: 'sample', hint: duration(s.frames / s.sampleRate), payload: { kind: 'sample', sample: s },
    })),
    // si rilegge solo quando cambiano i sample, non a ogni modifica del progetto
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

/** Una voce di una cartella del disco. */
export type FolderEntry =
  | { readonly kind: 'folder'; readonly name: string; readonly folder: FolderReader }
  | { readonly kind: 'file'; readonly name: string; readonly file: () => Promise<File> };

/** Una cartella del disco, da leggere. */
export interface FolderReader {
  readonly name: string;
  entries(): Promise<readonly FolderEntry[]>;
  /** Si può leggere senza chiedere il permesso? (Senza: sì.) */
  readable?(): Promise<boolean>;
  /** Chiede il permesso di leggerla (dopo un clic dell'utente). */
  request?(): Promise<boolean>;
}

/** Le voci di una cartella: prima le sottocartelle, poi i file audio, ognuno in ordine di nome. */
async function folderItems(prefix: string, folder: FolderReader): Promise<BrowserItem[]> {
  const entries = [...await folder.entries()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const folders = entries.flatMap((e): BrowserItem[] => (e.kind === 'folder' && !e.name.startsWith('.')
    ? [{ id: `${prefix}/${e.name}`, name: e.name, icon: 'folder', children: () => folderItems(`${prefix}/${e.name}`, e.folder) }] : []));
  const files = entries.flatMap((e): BrowserItem[] => (e.kind === 'file' && AUDIO_FILE.test(e.name)
    ? [{ id: `${prefix}/${e.name}`, name: e.name.replace(/\.[^.]+$/, ''), icon: 'sample', hint: e.name.slice(e.name.lastIndexOf('.') + 1).toLowerCase(), payload: { kind: 'file', name: e.name, file: e.file } }] : []));
  return [...folders, ...files];
}

/** Una cartella del disco come luogo del browser; `id` la distingue dalle altre con lo stesso nome. */
export function folderSource(id: string, folder: FolderReader): BrowserSource {
  return {
    id, label: folder.name, section: 'places', removable: true, empty: 'Nessun file audio in questa cartella.',
    items: () => folderItems(id, folder),
    locked: folder.readable && (async () => !(await folder.readable!())),
    unlock: folder.request && (() => folder.request!()),
  };
}
