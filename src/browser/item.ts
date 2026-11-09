/* The browser, like Live's: on the left the categories (instruments, drums, effects) and the
 * places (the project, the user's presets, disk folders), on the right their
 * content as a tree. Here there's only the data: a source gives items, an item can
 * contain others (a folder, a device with its presets) and can carry something to
 * load. Who loads (the app) and who draws (ui/browser) live elsewhere: a new source is a
 * new module satisfying `BrowserSource`. */
import type { Unsubscribe } from '../core/emitter';
import type { TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import type { Preset } from '../devices/device-type';
import type { ChainOwner } from '../model/project';
import type { RackPreset } from '../model/rack-preset';
import type { SampleRef } from '../model/sample';

/** What an item loads: a device (with or without preset), a saved rack, a project
 *  sample or an audio file from disk. */
export type BrowserPayload =
  | { readonly kind: 'instrument'; readonly type: string; readonly preset: Preset | null }
  | { readonly kind: 'effect'; readonly type: string; readonly preset: Preset | null }
  | { readonly kind: 'rack'; readonly rack: RackPreset }
  | { readonly kind: 'sample'; readonly sample: SampleRef }
  | { readonly kind: 'file'; readonly name: string; readonly file: () => Promise<File> };

/** Where an item is dropped: a timeline lane (at the beat), a session slot, the
 *  device chain of a track or of the master. `track` null: below the tracks, i.e. on a
 *  new track. */
export type LoadTarget =
  | { readonly kind: 'lane'; readonly track: TrackId | null; readonly beat: Beats }
  | { readonly kind: 'slot'; readonly track: TrackId | null; readonly slot: number }
  | { readonly kind: 'chain'; readonly owner: ChainOwner };

/** How an item is shown (the icon). */
export type ItemIcon = 'instrument' | 'effect' | 'preset' | 'user-preset' | 'rack' | 'sample' | 'folder';

export interface BrowserItem {
  /** Unique in the browser: the path from the source ("instruments/analog/f:Bass"). */
  readonly id: string;
  readonly name: string;
  readonly icon: ItemIcon;
  /** Secondary text, on the right (a sample's duration, a preset's device). */
  readonly hint?: string;
  /** What loads with double click, Enter or dragging it; without, the item is only a folder. */
  readonly payload?: BrowserPayload;
  /** The contained items (asked for when it's opened: disk ones are read then). */
  readonly children?: () => Promise<readonly BrowserItem[]>;
}

/** Where a source sits in the left column. */
export type SourceSection = 'categories' | 'places';

/** An item of the left column: gives the top-level items. */
export interface BrowserSource {
  readonly id: string;
  readonly label: string;
  readonly section: SourceSection;
  items(): Promise<readonly BrowserItem[]>;
  /** The items changed (a preset saved, a sample imported): the browser rereads them. */
  onChange?(fn: () => void): Unsubscribe;
  /** Does it need a permission to be read (a disk folder after a restart)? */
  locked?(): Promise<boolean>;
  /** Asks for that permission (after a user click); true if it can be read now. */
  unlock?(): Promise<boolean>;
  /** The user can remove it from the browser (the folders they added). */
  readonly removable?: boolean;
  /** What to say when it has no items (and how to get some). */
  readonly empty?: string;
}

/** The items contained in `item` (none if it's not a folder). */
export const childrenOf = (item: BrowserItem): Promise<readonly BrowserItem[]> =>
  item.children ? item.children() : Promise.resolve([]);

/** The name for searching: lowercase and without accents ("Città" → "citta"). */
export const searchKey = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
