/* Il browser, come quello di Live: a sinistra le categorie (strumenti, batterie, effetti) e i
 * luoghi (il progetto, i preset dell'utente, le cartelle del disco), a destra il loro
 * contenuto ad albero. Qui ci sono solo i dati: una fonte dà delle voci, una voce può
 * contenerne altre (una cartella, un dispositivo con i suoi preset) e può portare qualcosa da
 * caricare. Chi carica (l'app) e chi disegna (ui/browser) stanno altrove: una fonte nuova è un
 * modulo nuovo che soddisfa `BrowserSource`. */
import type { Unsubscribe } from '../core/emitter';
import type { TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import type { Preset } from '../devices/device-type';
import type { ChainOwner } from '../model/project';
import type { SampleRef } from '../model/sample';

/** Ciò che una voce carica: un dispositivo (con o senza preset), un sample del progetto o un
 *  file audio del disco. */
export type BrowserPayload =
  | { readonly kind: 'instrument'; readonly type: string; readonly preset: Preset | null }
  | { readonly kind: 'effect'; readonly type: string; readonly preset: Preset | null }
  | { readonly kind: 'sample'; readonly sample: SampleRef }
  | { readonly kind: 'file'; readonly name: string; readonly file: () => Promise<File> };

/** Dove si lascia una voce: una corsia della timeline (al battito), uno slot della session, la
 *  catena dei dispositivi di una traccia o del master. `track` null: sotto le tracce, cioè su una
 *  traccia nuova. */
export type LoadTarget =
  | { readonly kind: 'lane'; readonly track: TrackId | null; readonly beat: Beats }
  | { readonly kind: 'slot'; readonly track: TrackId | null; readonly slot: number }
  | { readonly kind: 'chain'; readonly owner: ChainOwner };

/** Come si mostra una voce (l'icona). */
export type ItemIcon = 'instrument' | 'effect' | 'preset' | 'user-preset' | 'sample' | 'folder';

export interface BrowserItem {
  /** Unico nel browser: il percorso dalla fonte ("instruments/analog/f:Bass"). */
  readonly id: string;
  readonly name: string;
  readonly icon: ItemIcon;
  /** Testo secondario, a destra (la durata di un sample, il dispositivo di un preset). */
  readonly hint?: string;
  /** Ciò che si carica con il doppio clic, Invio o trascinandola; senza, la voce è solo una cartella. */
  readonly payload?: BrowserPayload;
  /** Le voci contenute (si chiedono quando la si apre: quelle del disco si leggono allora). */
  readonly children?: () => Promise<readonly BrowserItem[]>;
}

/** Dove sta una fonte nella colonna a sinistra. */
export type SourceSection = 'categories' | 'places';

/** Una voce della colonna a sinistra: dà le voci di primo livello. */
export interface BrowserSource {
  readonly id: string;
  readonly label: string;
  readonly section: SourceSection;
  items(): Promise<readonly BrowserItem[]>;
  /** Le voci sono cambiate (un preset salvato, un sample importato): il browser le rilegge. */
  onChange?(fn: () => void): Unsubscribe;
  /** Serve un permesso per leggerla (una cartella del disco dopo un riavvio)? */
  locked?(): Promise<boolean>;
  /** Chiede quel permesso (dopo un clic dell'utente); vero se ora si legge. */
  unlock?(): Promise<boolean>;
  /** L'utente la può togliere dal browser (le cartelle che ha aggiunto). */
  readonly removable?: boolean;
  /** Cosa dire quando non ha voci (e come averne). */
  readonly empty?: string;
}

/** Le voci contenute in `item` (nessuna se non è una cartella). */
export const childrenOf = (item: BrowserItem): Promise<readonly BrowserItem[]> =>
  item.children ? item.children() : Promise.resolve([]);

/** Il nome per la ricerca: minuscolo e senza accenti ("Città" → "citta"). */
export const searchKey = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
