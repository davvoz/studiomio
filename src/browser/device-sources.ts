/* The device categories: instruments, drums, audio effects, and the user's presets and racks
 * gathered by device. The items come from the device registry, from the presets
 * (factory and user) and from the saved racks: a new device in the registry shows up here
 * by itself. */
import type { Unsubscribe } from '../core/emitter';
import type { DeviceType, Preset } from '../devices/device-type';
import type { RackPreset } from '../model/rack-preset';
import type { BrowserItem, BrowserPayload, BrowserSource } from './item';

/** What's needed of the user's presets (UserPresets satisfies it). */
export interface UserPresetList {
  list(type: string): Preset[];
  onChange?(fn: () => void): Unsubscribe;
}

/** What's needed of the saved racks (UserRacks satisfies it). */
export interface UserRackList {
  list(): RackPreset[];
  onChange?(fn: () => void): Unsubscribe;
}

type DeviceKind = 'instrument' | 'effect';

/** The lists whose changes a source follows. */
function onChangeOf(...lists: readonly ({ onChange?(fn: () => void): Unsubscribe } | undefined)[]): BrowserSource['onChange'] {
  const watched = lists.filter(l => l?.onChange);
  if (!watched.length) return undefined;
  return fn => {
    const offs = watched.map(l => l!.onChange!(fn));
    return () => offs.forEach(off => off());
  };
}

/** The folder of racks of a kind, as in Live: "Instrument Rack" among the instruments (the racks
 *  with the instrument), "Audio Effect Rack" among the effects; first the saved ones, then the
 *  factory ones; none if there are none. */
function rackFolder(prefix: string, kind: DeviceKind, racks: UserRackList | undefined, factory: readonly RackPreset[] = []): BrowserItem[] {
  const ofKind = (r: RackPreset) => !!r.instrument === (kind === 'instrument');
  const list = racks?.list().filter(ofKind) ?? [], fixed = factory.filter(ofKind);
  if (!list.length && !fixed.length) return [];
  // the kind in the id: among the User Presets the two folders sit in the same source
  const id = `${prefix}/rack:${kind}`;
  const item = (r: RackPreset, key: string): BrowserItem => ({ id: `${id}/${key}`, name: r.name, icon: 'rack', payload: { kind: 'rack', rack: r } });
  return [{
    id, name: kind === 'instrument' ? 'Instrument Rack' : 'Audio Effect Rack', icon: 'folder',
    children: async () => [...list.map(r => item(r, r.name)), ...fixed.map(r => item(r, `f:${r.name}`))],
  }];
}

const payload = (kind: DeviceKind, type: DeviceType, preset: Preset | null): BrowserPayload => ({ kind, type: type.type, preset });

/** A device's user presets as items. */
const userItems = (prefix: string, kind: DeviceKind, type: DeviceType, user: UserPresetList, hint?: string): BrowserItem[] =>
  user.list(type.type).map((p): BrowserItem => ({ id: `${prefix}/u:${p.name}`, name: p.name, icon: 'user-preset', hint, payload: payload(kind, type, p) }));

/** A device's presets as items: first the user's, then the factory ones. */
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
  /** The saved racks, in a folder before the devices. */
  readonly racks?: UserRackList;
  /** The factory racks, in the same folder after the saved ones. */
  readonly factoryRacks?: readonly RackPreset[];
}

/** A device category, like Live's "Instruments" and "Audio Effects": the saved racks,
 *  then a folder per device (which loads as it is) with its presets inside. */
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

/** The presets of some instruments all in a row, like Live's "Drums": the Drum
 *  Machine kits, ready to load. */
export function kitSource(id: string, label: string, types: readonly DeviceType[], user: UserPresetList): BrowserSource {
  return {
    id, label, section: 'categories',
    items: async () => types.flatMap(t => presetItems(`${id}/${t.type}`, 'instrument', t, user, types.length > 1 ? t.label : undefined)),
    onChange: user.onChange && (fn => user.onChange!(fn)),
  };
}

/** The racks and presets saved by the user, a folder per rack kind and per device (only
 *  those that have some), like Live's User Library. */
export function userPresetsSource(instruments: readonly DeviceType[], effects: readonly DeviceType[], user: UserPresetList, racks?: UserRackList): BrowserSource {
  const id = 'user-presets';
  const folders = (kind: DeviceKind, types: readonly DeviceType[]) => types.filter(t => user.list(t.type).length).map((t): BrowserItem => ({
    id: `${id}/${t.type}`, name: t.label, icon: 'folder',
    children: async () => userItems(`${id}/${t.type}`, kind, t, user),
  }));
  return {
    id, label: 'User presets', section: 'places',
    empty: 'No saved presets: ★ in the header of a device or a rack saves one.',
    items: async () => [
      ...rackFolder(id, 'instrument', racks), ...rackFolder(id, 'effect', racks),
      ...folders('instrument', instruments), ...folders('effect', effects),
    ],
    onChange: onChangeOf(user, racks),
  };
}
