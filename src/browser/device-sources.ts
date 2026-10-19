/* Le categorie dei dispositivi: strumenti, batterie, effetti audio, e i preset dell'utente
 * raccolti per dispositivo. Le voci vengono dal registro dei dispositivi e dai preset (di
 * fabbrica e dell'utente): un dispositivo nuovo nel registro compare qui da solo. */
import type { Unsubscribe } from '../core/emitter';
import type { DeviceType, Preset } from '../devices/device-type';
import type { BrowserItem, BrowserPayload, BrowserSource } from './item';

/** Ciò che serve dei preset dell'utente (UserPresets lo soddisfa). */
export interface UserPresetList {
  list(type: string): Preset[];
  onChange?(fn: () => void): Unsubscribe;
}

type DeviceKind = 'instrument' | 'effect';

const payload = (kind: DeviceKind, type: DeviceType, preset: Preset | null): BrowserPayload => ({ kind, type: type.type, preset });

/** I preset dell'utente di un dispositivo come voci. */
const userItems = (prefix: string, kind: DeviceKind, type: DeviceType, user: UserPresetList, hint?: string): BrowserItem[] =>
  user.list(type.type).map((p): BrowserItem => ({ id: `${prefix}/u:${p.name}`, name: p.name, icon: 'user-preset', hint, payload: payload(kind, type, p) }));

/** I preset di un dispositivo come voci: prima quelli dell'utente, poi quelli di fabbrica. */
const presetItems = (prefix: string, kind: DeviceKind, type: DeviceType, user: UserPresetList, hint?: string): BrowserItem[] => [
  ...userItems(prefix, kind, type, user, hint),
  ...type.presets.map((p): BrowserItem => ({ id: `${prefix}/f:${p.name}`, name: p.name, icon: 'preset', hint, payload: payload(kind, type, p) })),
];

export interface DeviceSourceOptions {
  readonly id: string;
  readonly label: string;
  readonly kind: DeviceKind;
  readonly types: readonly DeviceType[];
  readonly user: UserPresetList;
}

/** Una categoria di dispositivi, come "Instruments" e "Audio Effects" di Live: una cartella
 *  per dispositivo (che si carica così com'è) con dentro i suoi preset. */
export function deviceSource({ id, label, kind, types, user }: DeviceSourceOptions): BrowserSource {
  return {
    id, label, section: 'categories',
    items: async () => types.map((t): BrowserItem => ({
      id: `${id}/${t.type}`, name: t.label, icon: kind, payload: payload(kind, t, null),
      children: async () => presetItems(`${id}/${t.type}`, kind, t, user),
    })),
    onChange: user.onChange && (fn => user.onChange!(fn)),
  };
}

/** I preset di alcuni strumenti messi tutti in fila, come "Drums" di Live: i kit della Drum
 *  Machine, pronti da caricare. */
export function kitSource(id: string, label: string, types: readonly DeviceType[], user: UserPresetList): BrowserSource {
  return {
    id, label, section: 'categories',
    items: async () => types.flatMap(t => presetItems(`${id}/${t.type}`, 'instrument', t, user, types.length > 1 ? t.label : undefined)),
    onChange: user.onChange && (fn => user.onChange!(fn)),
  };
}

/** I preset salvati dall'utente, una cartella per dispositivo (solo quelli che ne hanno), come
 *  la User Library di Live. */
export function userPresetsSource(instruments: readonly DeviceType[], effects: readonly DeviceType[], user: UserPresetList): BrowserSource {
  const id = 'user-presets';
  const folders = (kind: DeviceKind, types: readonly DeviceType[]) => types.filter(t => user.list(t.type).length).map((t): BrowserItem => ({
    id: `${id}/${t.type}`, name: t.label, icon: 'folder',
    children: async () => userItems(`${id}/${t.type}`, kind, t, user),
  }));
  return {
    id, label: 'Preset dell\'utente', section: 'places',
    empty: 'Nessun preset salvato: ★ nell\'intestazione di un dispositivo ne salva uno.',
    items: async () => [...folders('instrument', instruments), ...folders('effect', effects)],
    onChange: user.onChange && (fn => user.onChange!(fn)),
  };
}
