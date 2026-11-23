/* The device view's menus, without the DOM: copy and paste on a device or a rack, grouping, the
 * parameters' menu (show the curve, remove a modulation, map to a macro), the effects to add. */
import type { DeviceId, TrackId } from '../../core/id';
import { mappingSpec } from '../../devices/rack-params';
import type { DeviceType } from '../../devices/device-type';
import { chainEffectTypes } from '../../devices/registry';
import type { ModTarget } from '../../model/envelope';
import type { ChainOwner } from '../../model/project';
import { findRack, macroName, macroOf, macroParam, outerRacks, rackName, rackOf, racksWith, type DeviceKey, type Rack } from '../../model/rack';
import { MidiTrack } from '../../model/track';
import type { Clipboard } from '../../store/clipboard';
import { setModTarget } from '../../store/edits';
import type { ProjectStore } from '../../store/project-store';
import { mapMacro, ungroupRack, unmapParam } from '../../store/rack-edits';
import { KEY, SEPARATOR, type MenuItem } from '../context-menu';
import { deviceLabels, sameModTarget } from './chain-labels';
import type { DeviceCommands } from './device-commands';
import { lastInChain } from './device-selection';

/** The instrument panel's key (the effects use their id). */
export const INSTRUMENT = 'instrument';

export interface DeviceMenuDeps {
  readonly store: ProjectStore;
  readonly clipboard?: Clipboard;
  readonly commands: DeviceCommands;
  /** Shows a parameter's curve: in the track's clip or, on the master, on the timeline. */
  readonly showAutomation?: (owner: ChainOwner, target: ModTarget) => void;
}

/** The effect types a chain can add (a MIDI track's also the MIDI effects). */
export function effectChoices(d: DeviceMenuDeps, owner: ChainOwner): readonly DeviceType[] {
  return chainEffectTypes(d.store.project.track(owner as TrackId) instanceof MidiTrack);
}

/** The copy and paste items of devices `keys` (or of rack `rack`). */
export function clipboardMenu(d: DeviceMenuDeps, owner: ChainOwner, keys: readonly DeviceKey[], rack: DeviceId | null = null): MenuItem[] {
  const { commands } = d;
  const onlyInstrument = !rack && keys.every(k => k === INSTRUMENT);
  const content = () => commands.content(owner, keys, rack);
  const last = () => lastInChain(d.store.project.chainKeys(owner), keys);
  return [
    { label: 'Cut', shortcut: KEY.cut, disabled: onlyInstrument, run: () => commands.cut(owner, keys, rack, content()) },
    { label: 'Copy', shortcut: KEY.copy, run: () => commands.copy(content()) },
    { label: 'Duplicate', shortcut: KEY.duplicate, disabled: onlyInstrument, run: () => commands.paste(content(), owner, last()) },
    { label: 'Paste after', shortcut: KEY.paste, disabled: !d.clipboard?.devices, run: () => commands.paste(d.clipboard?.devices ?? null, owner, last()) },
  ];
}

/** A device header's menu: on the chosen devices if it's among them (`chosen`), its presets. */
export function deviceHeadMenu(d: DeviceMenuDeps, owner: ChainOwner, key: DeviceKey, chosen: readonly DeviceKey[], presets: readonly MenuItem[]): MenuItem[] {
  const keys = chosen.includes(key) ? chosen : [key];
  const rack = rackOf(d.store.project.racksOf(owner), key);
  return [
    ...clipboardMenu(d, owner, keys),
    SEPARATOR,
    { label: 'Group into a rack', shortcut: 'Ctrl+G', run: () => d.commands.groupSelection(keys) },
    { label: 'Ungroup the rack', shortcut: 'Ctrl+Shift+G', disabled: !rack, run: () => rack && d.commands.guard(ungroupRack(owner, rack.id)) },
    ...(presets.length ? [SEPARATOR, ...presets] : []),
  ];
}

/** The chain's empty space: paste. */
export const emptyChainMenu = (d: DeviceMenuDeps): MenuItem[] => [
  { label: 'Paste', shortcut: KEY.paste, disabled: !d.clipboard?.devices, run: () => d.commands.pasteSelection() },
];

/** "Show automation", if the app knows how to show it. */
export function automationMenu(d: DeviceMenuDeps, owner: ChainOwner, target: ModTarget): MenuItem[] {
  const show = d.showAutomation;
  return show ? [{ label: 'Show automation', run: () => show(owner, target) }, SEPARATOR] : [];
}

/** The targets of the chain's modulators moving `target`, to remove. */
export function modulationMenu(d: DeviceMenuDeps, owner: ChainOwner, target: ModTarget): MenuItem[] {
  const project = d.store.project, labels = deviceLabels(project, owner);
  const items = project.effectsOf(owner).flatMap(e => (e.targets ?? []).flatMap((t, slot): MenuItem[] => (t && sameModTarget(t, target)
    ? [{ label: `Remove the modulation of ${labels.get(e.id) ?? e.type} (target ${slot + 1})`, run: () => d.store.apply(setModTarget(owner, e.id, slot, null)) }]
    : [])));
  return items.length ? [...items, SEPARATOR] : [];
}

/** The items to map a parameter (or a macro) to the macros of the racks `racks`, from the nearest:
 *  if there's more than one rack, each under its name. */
export function mapMenu(d: DeviceMenuDeps, owner: ChainOwner, racks: readonly Rack[], device: DeviceKey, param: string): MenuItem[] {
  const project = d.store.project;
  const current = macroOf(project.racksOf(owner), device, param);
  const label = (x: { device: DeviceKey; param: string }) => mappingSpec(project, owner, x)?.label;
  const items = racks.flatMap((rack, n): MenuItem[] => [
    ...(racks.length > 1 ? [...(n ? [SEPARATOR] : []), { label: rackName(rack), disabled: true, run: () => {} }] : []),
    ...rack.macros.map((m, i): MenuItem => {
      const name = macroName(m, i, label);
      return {
        label: name === `Macro ${i + 1}` ? `Map to ${name}` : `Map to ${name} (macro ${i + 1})`,
        checked: current?.rack.id === rack.id && current.index === i,
        run: () => d.commands.guard(mapMacro(owner, rack.id, i, device, param)),
      };
    }),
  ]);
  if (!items.length) return [];
  return [...items, SEPARATOR, { label: 'Remove from the macro', disabled: !current, run: () => d.commands.guard(unmapParam(owner, device, param)) }];
}

/** A parameter's menu: its curve, the modulations moving it, which macro of its racks to map it
 *  to (first the rack it's in, then the surrounding ones). */
export function paramMenu(d: DeviceMenuDeps, owner: ChainOwner, key: DeviceKey, param: string): MenuItem[] {
  const target: ModTarget = { kind: 'device', device: key, param };
  const mods = [...automationMenu(d, owner, target), ...modulationMenu(d, owner, target)];
  const racks = racksWith(d.store.project.racksOf(owner), key).reverse();
  if (!racks.length) return [...mods, { label: 'Group into a rack to map it to a macro', shortcut: 'Ctrl+G', run: () => d.commands.groupSelection([key]) }];
  return [...mods, ...mapMenu(d, owner, racks, key, param)];
}

/** A rack's macro mapped into the racks around it (from the nearest). */
export function outerMacroMenu(d: DeviceMenuDeps, owner: ChainOwner, rack: DeviceId, index: number): MenuItem[] {
  const racks = d.store.project.racksOf(owner);
  const now = findRack(racks, rack);
  return now ? mapMenu(d, owner, outerRacks(racks, now).reverse(), rack, macroParam(index)) : [];
}
