/* The rack panel's menus, without the DOM: the header's (nest, save), a macro's (rename, modes, Map),
 * a spring's return times, and "+ Parameter": a device of the rack (or a rack inside), then its
 * parameter (or macro). Each item does what the panel gives it. */
import { activeSections } from '../../devices/device-type';
import { deviceAt, deviceTypeAt, macroSpec } from '../../devices/rack-params';
import type { ChainOwner, Project } from '../../model/project';
import { innerRacks, MACRO_MODES, SPRING_TIMES, type DeviceKey, type MacroMode, type MacroSpring, type Rack } from '../../model/rack';
import { SEPARATOR, type MenuItem } from '../context-menu';

/** The header's menu: the copy and paste items (`clip`), putting the rack in the one before or after, saving. */
export function rackHeadMenu(clip: readonly MenuItem[], canNest: (dir: -1 | 1) => boolean, nest: (dir: -1 | 1) => void, save: readonly MenuItem[]): MenuItem[] {
  return [
    ...clip, ...(clip.length ? [SEPARATOR] : []),
    { label: 'Put in the rack before', disabled: !canNest(-1), run: () => nest(-1) },
    { label: 'Put in the rack after', disabled: !canNest(1), run: () => nest(1) },
    SEPARATOR,
    ...save,
  ];
}

/** What a macro's menu does. */
export interface MacroMenuActions {
  /** The first items (the automation's). */
  readonly first: readonly MenuItem[];
  /** The macro has a name of its own. */
  readonly named: boolean;
  readonly mode: MacroMode;
  /** The items mapping it to the macros of the surrounding racks (none if it isn't inside another). */
  readonly outer: readonly MenuItem[];
  rename(): void;
  autoName(): void;
  setMode(mode: MacroMode): void;
  map(): void;
}

export function macroMenu(a: MacroMenuActions): MenuItem[] {
  return [
    ...a.first,
    { label: 'Rename the macro', run: () => a.rename() },
    { label: 'Automatic name', disabled: !a.named, run: () => a.autoName() },
    SEPARATOR,
    ...MACRO_MODES.map(([value, label]) => ({ label, checked: a.mode === value, run: () => a.setMode(value) })),
    SEPARATOR,
    { label: 'Map…', run: () => a.map() },
    // inside another rack, the macro maps to the macros of the surrounding ones
    ...(a.outer.length ? [SEPARATOR, ...a.outer] : []),
  ];
}

/** A spring's return times: in time with the tempo, then in milliseconds, then one typed (`more`). */
export function springTimeMenu(s: MacroSpring, pick: (time: number, sync: boolean) => void, more: () => void): MenuItem[] {
  const items = (sync: boolean): MenuItem[] => SPRING_TIMES.filter(([, x]) => x === sync)
    .map(([t, x, label]) => ({ label, checked: s.time === t && s.sync === x, run: () => pick(t, x) }));
  return [...items(true), SEPARATOR, ...items(false), SEPARATOR, { label: 'More…', run: () => more() }];
}

/** Where "+ Parameter" looks: the project, the chain, the rack, its devices' names. */
export interface ParamChoices {
  readonly project: Project;
  readonly owner: ChainOwner;
  readonly rack: Rack;
  readonly deviceLabel: (key: DeviceKey) => string;
  /** The parameter is already mapped to the macro (it's checked). */
  mapped(device: DeviceKey, param: string): boolean;
  /** Maps the parameter (or the inner rack's macro) to the macro. */
  map(device: DeviceKey, param: string): void;
  /** Shows the second menu. */
  open(items: MenuItem[]): void;
}

/** The first menu of "+ Parameter": the rack's devices, then the racks it has inside. */
export function paramChoices(c: ParamChoices): MenuItem[] {
  const racks = innerRacks(c.project.racksOf(c.owner), c.rack).map(rack => ({
    label: c.deviceLabel(rack.id),
    run: () => c.open(innerMacroItems(c, rack)),
  }));
  return [...c.rack.devices.map(device => ({
    label: c.deviceLabel(device),
    disabled: !deviceTypeAt(c.project, c.owner, device),
    run: () => c.open(paramItems(c, device)),
  })), ...(racks.length ? [SEPARATOR, ...racks] : [])];
}

/** The macros of a rack inside. */
export function innerMacroItems(c: ParamChoices, rack: Rack): MenuItem[] {
  return rack.macros.map((_, i) => {
    const spec = macroSpec(c.project, c.owner, rack, i);
    return { label: spec.label, checked: c.mapped(rack.id, spec.id), run: () => c.map(rack.id, spec.id) };
  });
}

/** The device's visible parameters (prefixed with their section when it has several). */
export function paramItems(c: ParamChoices, device: DeviceKey): MenuItem[] {
  const type = deviceTypeAt(c.project, c.owner, device), settings = deviceAt(c.project, c.owner, device);
  if (!type) return [];
  const several = type.sections.length > 1;
  return activeSections(type, settings?.params ?? {}).flatMap(section => section.params.filter(spec => !spec.hidden).map(spec => ({
    label: several ? `${section.label} · ${spec.label}` : spec.label,
    checked: c.mapped(device, spec.id),
    run: () => c.map(device, spec.id),
  })));
}
