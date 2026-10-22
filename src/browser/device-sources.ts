/* Le categorie dei dispositivi: strumenti, batterie, effetti audio, e i preset e i rack
 * dell'utente raccolti per dispositivo. Le voci vengono dal registro dei dispositivi, dai preset
 * (di fabbrica e dell'utente) e dai rack salvati: un dispositivo nuovo nel registro compare qui
 * da solo. */
import type { Unsubscribe } from '../core/emitter';
import type { DeviceType, Preset } from '../devices/device-type';
import type { RackPreset } from '../model/rack-preset';
import type { BrowserItem, BrowserPayload, BrowserSource } from './item';

/** Ciò che serve dei preset dell'utente (UserPresets lo soddisfa). */
export interface UserPresetList {
  list(type: string): Preset[];
  onChange?(fn: () => void): Unsubscribe;
}

/** Ciò che serve dei rack salvati (UserRacks lo soddisfa). */
export interface UserRackList {
  list(): RackPreset[];
  onChange?(fn: () => void): Unsubscribe;
}

type DeviceKind = 'instrument' | 'effect';

/** Le liste di cui una fonte segue i cambiamenti. */
function onChangeOf(...lists: readonly ({ onChange?(fn: () => void): Unsubscribe } | undefined)[]): BrowserSource['onChange'] {
  const watched = lists.filter(l => l?.onChange);
  if (!watched.length) return undefined;
  return fn => {
    const offs = watched.map(l => l!.onChange!(fn));
    return () => offs.forEach(off => off());
  };
}

/** La cartella dei rack di un tipo, come in Live: "Instrument Rack" tra gli strumenti (i rack
 *  con lo strumento), "Audio Effect Rack" tra gli effetti; prima quelli salvati, poi quelli di
 *  fabbrica; nessuna se non ce ne sono. */
function rackFolder(prefix: string, kind: DeviceKind, racks: UserRackList | undefined, factory: readonly RackPreset[] = []): BrowserItem[] {
  const ofKind = (r: RackPreset) => !!r.instrument === (kind === 'instrument');
  const list = racks?.list().filter(ofKind) ?? [], fixed = factory.filter(ofKind);
  if (!list.length && !fixed.length) return [];
  // il tipo nell'id: tra i Preset dell'utente le due cartelle stanno nella stessa fonte
  const id = `${prefix}/rack:${kind}`;
  const item = (r: RackPreset, key: string): BrowserItem => ({ id: `${id}/${key}`, name: r.name, icon: 'rack', payload: { kind: 'rack', rack: r } });
  return [{
    id, name: kind === 'instrument' ? 'Instrument Rack' : 'Audio Effect Rack', icon: 'folder',
    children: async () => [...list.map(r => item(r, r.name)), ...fixed.map(r => item(r, `f:${r.name}`))],
  }];
}

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
  /** I rack salvati, in una cartella prima dei dispositivi. */
  readonly racks?: UserRackList;
  /** I rack di fabbrica, nella stessa cartella dopo quelli salvati. */
  readonly factoryRacks?: readonly RackPreset[];
}

/** Una categoria di dispositivi, come "Instruments" e "Audio Effects" di Live: i rack salvati,
 *  poi una cartella per dispositivo (che si carica così com'è) con dentro i suoi preset. */
export function deviceSource({ id, label, kind, types, user, racks, factoryRacks }: DeviceSourceOptions): BrowserSource {
  return {
    id, label, section: 'categories',
    items: async () => [
      ...rackFolder(id, kind, racks, factoryRacks),
      ...types.map((t): BrowserItem => ({
        id: `${id}/${t.type}`, name: t.label, icon: kind, payload: payload(kind, t, null),
        children: async () => presetItems(`${id}/${t.type}`, kind, t, user),
      })),
    ],
    onChange: onChangeOf(user, racks),
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

/** I rack e i preset salvati dall'utente, una cartella per tipo di rack e per dispositivo (solo
 *  quelli che ne hanno), come la User Library di Live. */
export function userPresetsSource(instruments: readonly DeviceType[], effects: readonly DeviceType[], user: UserPresetList, racks?: UserRackList): BrowserSource {
  const id = 'user-presets';
  const folders = (kind: DeviceKind, types: readonly DeviceType[]) => types.filter(t => user.list(t.type).length).map((t): BrowserItem => ({
    id: `${id}/${t.type}`, name: t.label, icon: 'folder',
    children: async () => userItems(`${id}/${t.type}`, kind, t, user),
  }));
  return {
    id, label: 'Preset dell\'utente', section: 'places',
    empty: 'Nessun preset salvato: ★ nell\'intestazione di un dispositivo o di un rack ne salva uno.',
    items: async () => [
      ...rackFolder(id, 'instrument', racks), ...rackFolder(id, 'effect', racks),
      ...folders('instrument', instruments), ...folders('effect', effects),
    ],
    onChange: onChangeOf(user, racks),
  };
}
