/* The Sampler's panel. At the top, in the Sample tab, the waveform of the chosen zone (with
 * the sample to choose or load); in the Zones tab the zone editor on the keyboard. On the
 * right the drawn envelopes; below the tabs of the sample (with the controls of the chosen mode) or
 * of the zone, of the pitch, of the filter, of the voice and of the output; on the right the LFO. Everything,
 * except the mode, the voice and the output, belongs to the chosen zone: the controls have the names of the
 * first zone's parameters and write into the zone's (whose sound, once touched, becomes its own). The mode (Classic,
 * One-Shot, Slice) is in the device's header. An audio file from disk or a sample from the
 * browser dropped on the panel becomes the chosen zone's sample; several files together, or dropped
 * on the zone editor, become new zones (from the key under the pointer). */
import type { SampleId } from '../../../core/id';
import { paramActive, paramSpec, resolveParams } from '../../../devices/device-type';
import {
  ENV_NAMES, FIRST_SLICE_NOTE, FIRST_ZONE_KEYS, layoutZones, MAX_ZONES, MODE, ownSound, SENSITIVITY, SLICE, SLICE_COUNT, SOUND_KEYS,
  sliceValues, spreadRanges, zoneDefaults, zoneKeys, zoneMap, zoneParam, zoneSlot, zoneSource, type ZoneKey,
} from '../../../devices/instruments/sampler/sampler';
import type { ParamSpec } from '../../../devices/params';
import { sampleAt, type DeviceSettings, type ParamValues } from '../../../model/device';
import { acceptBrowserDrops } from '../../browser/browser-drag';
import { SEPARATOR, showContextMenu } from '../../context-menu';
import { el } from '../../dom';
import { controlFor, setActive, type ParamControl } from '../controls';
import type { DeviceDisplay, DisplayContext } from '../displays';
import { EnvView } from '../prisma/env-view';
import { findTransients } from './slices';
import { WaveView } from './wave-view';
import { ZoneView, type ZoneRow } from './zone-view';

/** The files that can be dropped on the panel. */
const isAudio = (f: File) => f.type.startsWith('audio/') || /\.(wav|aiff?|flac|mp3|ogg|m4a)$/i.test(f.name);

/** The controls of the sample tab, in their order; then those visible in every mode. */
const SAMPLE_ORDER = ['start', 'end', 'sliceBy', 'sliceGrid', SENSITIVITY, 'loop', 'loopStart', 'loopEnd', 'xfade', 'loopRelease', 'trigger', 'reverse'];
const SAMPLE_CONTROLS: Readonly<Record<number, readonly string[]>> = {
  [MODE.classic]: ['start', 'end', 'loop', 'loopStart', 'loopEnd', 'xfade', 'loopRelease', 'reverse'],
  [MODE.oneShot]: ['start', 'end', 'trigger', 'reverse'],
  [MODE.slice]: ['sliceBy', 'sliceGrid', SENSITIVITY, 'trigger', 'reverse'],
};
const SAMPLE_KEYS = new Set(Object.values(SAMPLE_CONTROLS).flat());
/** The controls of the zone tab: changing zone they're redone. */
const ZONE_CONTROLS: readonly ZoneKey[] = ['lo', 'hi', 'vlo', 'vhi', 'gain', 'pan'];
/** The keys that have the names of the first zone's parameters and apply to the chosen zone. */
const OF_ZONE = FIRST_ZONE_KEYS as ReadonlySet<string>;
const SOUND = new Set<string>(SOUND_KEYS);
/** The choices that sit better in a menu than in a row of buttons. */
const MENUS = new Set(['loop', 'loopRelease', 'sliceBy', 'sliceGrid', 'root', 'voiceMode', 'fType', 'lfoShape', 'lfoDiv', 'lo', 'hi']);
/** The controls that, when they don't count, are removed instead of dimmed (they sit in the same place). */
const SWAPPED = new Set(['lfoRate', 'lfoDiv', 'sliceGrid', SENSITIVITY]);

/** Velocity of the test notes (the slices, the zones). */
const AUDITION_VELOCITY = 110;
/** The first key of the zones loaded one per key: C1, like a drum kit's pads. */
const FIRST_ZONE_KEY = 36;

type Tab = 'sample' | 'zones';

/** The envelope being looked at, the top tab and the chosen zone (they stay from one panel to the next). */
const view = { env: 1, tab: 'sample' as Tab, zone: 0 };

export class SamplerDisplay implements DeviceDisplay {
  readonly element = el('div', { className: 'smp' });
  readonly head: HTMLElement;
  /** The controls by parameter id, with the key ordering them (for the zones: "start", "lo"…). */
  private readonly controls = new Map<string, { control: ParamControl; spec: ParamSpec; key: string }>();
  /** The slots of the controls applying to the chosen zone. */
  private readonly slots = new Map<ZoneKey, HTMLElement>();
  /** The ids of the controls of the current zone tab (z2lo…), to remove when changing zone. */
  private zoneControls: string[] = [];
  private readonly wave: WaveView;
  private readonly zoneView: ZoneView;
  private readonly envView: EnvView;
  private readonly envTabs: HTMLButtonElement[] = [];
  private readonly envKnobs = el('div', { className: 'device-controls smp-knobs' });
  private readonly tabs: Record<Tab, HTMLButtonElement>;
  private readonly zoneChoice = el<HTMLSelectElement>('select', { className: 'smp-zone-pick', title: 'The zone being looked at' });
  private readonly sampleChoice = el<HTMLSelectElement>('select', { className: 'smp-sample', title: 'The zone\'s sample (among the project\'s)' });
  private readonly addZones = el<HTMLButtonElement>('button', { className: 'mini', textContent: '+ Zones…', title: 'Load audio files into new zones, one key each (or on the notes written in the names)' });
  /** The chosen zone's sound: like the first or its own. */
  private readonly link = el<HTMLButtonElement>('button', { className: 'mini smp-link', textContent: 'Like zone 1' });
  private readonly info = el('span', { className: 'smp-info muted' });
  private readonly detect = el<HTMLButtonElement>('button', { className: 'mini smp-detect', textContent: 'Detect', title: 'Find the slices at the transients (with the chosen sensitivity)' });
  private readonly sampleCard: HTMLElement;
  private readonly zoneCard: HTMLElement;
  private readonly zoneTitle = el('span', { className: 'smp-card-title' });
  /** The titles of the tabs applying to the chosen zone, with their name ("Filter" → "Filter · zone 2"). */
  private readonly soundTitles: [HTMLElement, string][] = [];
  private values: Record<string, number>;
  private params: ParamValues | null = null;
  private settings: DeviceSettings;
  private enabled = true;
  /** The zone the zone-dependent controls are made for. */
  private builtZone = -1;
  /** The values as the chosen zone sees them (see zoneValues). */
  private shownValues: { values: Record<string, number>; zone: number; out: Record<string, number> } | null = null;
  /** The panel has been in the document: when it leaves it stops watching the voices. */
  private shown = false;
  private hadAudio = false;

  constructor(private readonly ctx: DisplayContext) {
    this.settings = ctx.settings;
    this.values = resolveParams(ctx.type, ctx.settings.params);
    const set = (values: ParamValues, final: boolean) => ctx.setParams(values, final);
    this.wave = new WaveView({
      values: () => this.zoneValues(),
      audio: () => this.audio(),
      name: () => this.sampleName(this.zone),
      set: (values, final) => ctx.setParams(this.toZone(values), final),
      playSlice: i => ctx.audition(FIRST_SLICE_NOTE + i, AUDITION_VELOCITY),
      playheads: () => (ctx.playheads?.() ?? []).filter(p => Math.floor(p) === this.zone).map(p => p - this.zone),
      menu: (x, y) => this.menu(x, y),
    });
    this.zoneView = new ZoneView({
      values: () => this.values,
      rows: () => this.rows(),
      selected: () => this.zone,
      select: zone => this.selectZone(zone),
      set,
      audition: pitch => ctx.audition(pitch, AUDITION_VELOCITY),
      sounding: () => new Set((ctx.playheads?.() ?? []).map(p => Math.floor(p))),
      played: () => ctx.playedNotes(),
      add: () => this.pickFiles(files => this.newZones(files, this.nextKey())),
      pitched: () => this.values.mode !== MODE.slice,
      menu: (x, y) => this.zoneMenu(x, y),
    });
    // the envelope's name is in the chosen tab (and the zone in the title): the drawing uses the whole height
    this.envView = new EnvView(() => this.zoneValues(), (values, final) => ctx.setParams(this.toZone(values), final), () => '', true);
    this.envView.canvas.classList.add('smp-env');

    const mode = this.control('mode', v => this.setMode(v));
    mode.classList.add('smp-mode');
    this.head = el('div', { className: 'smp-head' }, mode);

    this.tabs = {
      sample: el<HTMLButtonElement>('button', { className: 'mini', textContent: 'Sample', title: 'The chosen zone\'s waveform', onclick: () => this.showTab('sample') }),
      zones: el<HTMLButtonElement>('button', { className: 'mini', textContent: 'Zones', title: 'The samples on the keyboard: keys and velocities of each zone', onclick: () => this.showTab('zones') }),
    };
    this.zoneChoice.onchange = () => this.selectZone(Number(this.zoneChoice.value));
    this.link.onclick = () => {
      const zone = this.zone, own = ownSound(this.values, zone);
      ctx.setParams(Object.keys(own).length ? own : { [zoneParam(zone, 'own')]: 0 }, true);
    };
    this.sampleChoice.onchange = () => this.assign((this.sampleChoice.value || null) as SampleId | null);
    const load = el<HTMLButtonElement>('button', { className: 'mini', textContent: 'Load…', title: 'Load an audio file into the chosen zone', onclick: () => this.pickFiles(files => this.loadFiles(files), false) });
    this.addZones.onclick = () => this.pickFiles(files => this.newZones(files, this.nextKey()));
    this.detect.onclick = () => this.findSlices(this.values[SENSITIVITY], true);
    const waveBox = el('div', { className: 'smp-wave-box' },
      el('div', { className: 'smp-wave-bar' }, el('div', { className: 'smp-tabs' }, this.tabs.sample, this.tabs.zones),
        this.zoneChoice, this.link, this.sampleChoice, load, this.addZones, this.info),
      this.wave.canvas, this.zoneView.canvas);

    const envCard = el('div', { className: 'smp-card smp-env-card' },
      el('div', { className: 'smp-card-head' }, this.title('Envelopes'), el('div', { className: 'smp-tabs' }, ...ENV_NAMES.map((name, i) => {
        const b = el<HTMLButtonElement>('button', { className: 'mini', textContent: name, onclick: () => this.showEnv(i + 1) });
        this.envTabs.push(b);
        return b;
      }))), el('div', { className: 'smp-env-body' }, el('div', { className: 'smp-env-box' }, this.envView.canvas), this.envKnobs));

    this.sampleCard = el('div', { className: 'smp-card' },
      el('div', { className: 'smp-card-head' }, this.title('Sample'), this.detect), this.row(...SAMPLE_ORDER));
    this.sampleCard.classList.add('smp-sample-card');
    const remove = el<HTMLButtonElement>('button', { className: 'mini', textContent: 'Remove', title: 'Removes the zone and its sample', onclick: () => this.removeZone(this.zone) });
    this.zoneCard = el('div', { className: 'smp-card smp-zone-card' },
      el('div', { className: 'smp-card-head' }, this.zoneTitle, remove), this.zoneRow(ZONE_CONTROLS));
    const pitchCard = this.card(this.title('Pitch'), [], this.row('root', 'transpose', 'detune', 'keyTrack', 'pitchEnv'));
    const filterCard = this.card(this.title('Filter'), [this.power('fOn'), this.control('fType', undefined, true)],
      this.row('fCutoff', 'fRes', 'fDrive', 'fVar', 'fKey', 'fEnv', 'fVel'));
    // what's left of the whole Sampler: the voice (a single voice belongs to all the zones) and the output
    const outCard = this.card(el('span', { className: 'smp-card-title', textContent: 'Voice and output' }), [],
      this.row('voiceMode', 'glide', 'velocity', 'pan', 'volume'));
    const lfoCard = this.card(this.title('LFO'), [this.control('lfoShape', undefined, true)],
      el('div', { className: 'smp-lfo-grid' }, ...['lfoSync', 'lfoRate', 'lfoDiv', 'lfoTrig', 'lfoFade', 'lfoPitch', 'lfoCutoff', 'lfoVolume', 'lfoPan']
        .map(id => this.control(id))));
    lfoCard.classList.add('smp-lfo-card');

    this.element.append(
      el('div', { className: 'smp-main' },
        el('div', { className: 'smp-top' }, waveBox, envCard),
        el('div', { className: 'smp-row' }, this.sampleCard, this.zoneCard, pitchCard, filterCard, outCard)),
      lfoCard);
    this.bindDrops();
    this.showEnv(view.env);
    this.update(ctx.settings, true);
    const resized = new ResizeObserver(() => this.paint());
    resized.observe(this.wave.canvas);
    resized.observe(this.zoneView.canvas);
    resized.observe(this.envView.canvas);
    requestAnimationFrame(this.frame);
  }

  /** At every frame: the voices' cursors, and the sample when it finishes loading. */
  private readonly frame = () => {
    if (this.element.isConnected) this.shown = true;
    else if (this.shown) return;
    const has = !!this.audio();
    if (has !== this.hadAudio) {
      this.hadAudio = has;
      this.refreshSample();
      this.wave.paint();
    }
    if (this.tab === 'zones') this.zoneView.tick();
    else this.wave.tick();
    requestAnimationFrame(this.frame);
  };

  update(settings: DeviceSettings, enabled: boolean): void {
    if (settings.params !== this.params) {
      this.params = settings.params;
      this.values = resolveParams(this.ctx.type, settings.params);
    }
    this.settings = settings;
    this.enabled = enabled;
    // the chosen zone is gone (removed): it moves to the first that exists
    if (view.zone !== 0 && !sampleAt(settings, zoneSlot(view.zone))) view.zone = this.rows()[0]?.index ?? 0;
    if (this.zone !== this.builtZone) this.buildZoneControls();
    const shown = new Set(SAMPLE_CONTROLS[this.values.mode] ?? []), values = this.zoneValues();
    for (const [id, { control, spec, key }] of this.controls) {
      control.set(values[id]);
      const active = paramActive(spec, values);
      setActive(control, active);
      control.element.hidden = (SAMPLE_KEYS.has(key) && !shown.has(key)) || (SWAPPED.has(key) && !active);
    }
    // the sensitivity counts only with the slices at the transients (it's an interface parameter)
    const transients = this.values.mode === MODE.slice && this.values.sliceBy === SLICE.transients;
    const sens = this.controls.get(SENSITIVITY);
    if (sens) sens.control.element.hidden = !transients;
    this.detect.hidden = !transients;
    this.showTab(this.tab, false);
    this.refreshSample();
    this.paint();
  }

  // ---------------------------------------------------------------- zone

  /** The top tab: in Slice there's only the sample (the slices belong to the first zone). */
  private get tab(): Tab {
    return this.values.mode === MODE.slice ? 'sample' : view.tab;
  }

  /** The zone being looked at: in Slice the first, which has the slices. */
  private get zone(): number {
    return this.values.mode === MODE.slice ? 0 : view.zone;
  }

  /** The zones that have a sample, in order. */
  private rows(): ZoneRow[] {
    const out: ZoneRow[] = [];
    for (let i = 0; i < MAX_ZONES; i++) if (sampleAt(this.settings, zoneSlot(i))) out.push({ index: i, name: this.sampleName(i) ?? '…' });
    return out;
  }

  private showTab(tab: Tab, remember = true): void {
    if (remember) view.tab = tab;
    const zones = this.tab === 'zones', sliced = this.values.mode === MODE.slice;
    this.tabs.sample.classList.toggle('on', !zones);
    this.tabs.zones.classList.toggle('on', zones);
    this.tabs.zones.hidden = sliced;
    this.wave.canvas.hidden = zones;
    this.zoneView.canvas.hidden = !zones;
    this.sampleCard.hidden = zones;
    this.zoneCard.hidden = !zones;
    this.addZones.hidden = !zones;
    if (remember) this.paint();
  }

  private selectZone(zone: number): void {
    if (zone === view.zone) return;
    view.zone = zone;
    this.wave.zoomAll();
    this.update(this.settings, this.enabled);
  }

  /** Redoes the controls applying to the chosen zone, in their places. */
  private buildZoneControls(): void {
    const zone = this.zone;
    this.builtZone = zone;
    for (const id of this.zoneControls) this.controls.delete(id);
    this.zoneControls = [...this.slots.keys()].map(key => zoneParam(zone, key));
    for (const [key, slot] of this.slots) slot.replaceChildren(this.control(zoneParam(zone, key), undefined, MENUS.has(key), key));
    this.zoneTitle.textContent = `Zone ${zone + 1}`;
    this.ctx.controlsChanged();
  }

  /** The key the new zones start from: after the last single-key zone, or C1. */
  private nextKey(): number {
    const single = this.rows().map(r => zoneMap(this.values, r.index)).filter(z => z.lo === z.hi);
    return single.length ? Math.min(127, Math.max(...single.map(z => z.hi)) + 1) : FIRST_ZONE_KEY;
  }

  /** The free zones (without sample), as many as needed, and the values to put `names` there from `first`. */
  private place(names: readonly string[], first: number): { zones: number[]; values: Record<string, number> } | null {
    const free = Array.from({ length: MAX_ZONES }, (_, i) => i).filter(i => !sampleAt(this.settings, zoneSlot(i)));
    if (free.length < names.length) {
      this.info.textContent = `At most ${MAX_ZONES} zones: ${free.length} left.`;
      return null;
    }
    const layout = layoutZones(names, first), zones = free.slice(0, names.length), values: Record<string, number> = {};
    // only the new map of the zone stays: what was left from before goes back to the defaults
    for (const [k, z] of zones.entries()) {
      for (const [id, def] of Object.entries(zoneDefaults(z))) if (this.values[id] !== def) values[id] = def;
      Object.assign(values, zoneKeys(z, layout[k].lo, layout[k].hi, layout[k].root));
    }
    return { zones, values };
  }

  /** Files into new zones, from `first` (a single step); then the zones are shown. */
  private async newZones(files: readonly File[], first: number): Promise<void> {
    const samples = this.ctx.samples;
    const placed = samples?.loadAll && this.place(files.map(f => f.name), first);
    if (!samples?.loadAll || !placed) return;
    try {
      await samples.loadAll(Object.fromEntries(placed.zones.map((z, k) => [zoneSlot(z), files[k]])), placed.values);
    } catch (err) {
      this.info.textContent = `Can't load the files: ${err instanceof Error ? err.message : err}`;
      return;
    }
    this.afterZones(placed.zones);
  }

  /** A project sample in a new zone, on key `key`. */
  private newZone(id: SampleId, name: string, key: number): void {
    const placed = this.place([name], key);
    if (!placed || !this.ctx.samples) return;
    this.ctx.samples.assign({ [zoneSlot(placed.zones[0])]: id }, placed.values);
    this.afterZones(placed.zones);
  }

  private afterZones(zones: readonly number[]): void {
    view.zone = zones[0];
    this.showTab('zones');
    this.update(this.settings, this.enabled);
    this.ctx.audition(this.zonePitch(zones[0]), AUDITION_VELOCITY);
  }

  private removeZone(zone: number): void {
    this.ctx.samples?.assign({ [zoneSlot(zone)]: null }, zoneDefaults(zone));
  }

  /** The note that makes the zone heard: its root note, if it fits inside. */
  private zonePitch(zone: number): number {
    const z = zoneMap(this.values, zone);
    return z.root >= z.lo && z.root <= z.hi ? z.root : z.lo;
  }

  private zoneMenu(x: number, y: number): void {
    const rows = this.rows(), zone = this.zone, has = rows.some(r => r.index === zone);
    const all = (fn: (r: ZoneRow, k: number) => Record<string, number>) => () =>
      this.ctx.setParams(Object.assign({}, ...rows.map(fn)), true);
    const roots = rows.map(r => zoneMap(this.values, r.index).root), ranges = spreadRanges(roots);
    showContextMenu(x, y, [
      { label: 'Load into new zones…', run: () => this.pickFiles(files => this.newZones(files, this.nextKey())) },
      { label: `Change the sample of zone ${zone + 1}…`, disabled: !has, run: () => this.pickFiles(files => this.loadFiles(files), false) },
      { label: `Remove zone ${zone + 1}`, disabled: !has, run: () => this.removeZone(zone) },
      SEPARATOR,
      { label: 'One key per zone, from C1', disabled: !rows.length,
        run: all((r, k) => zoneKeys(r.index, Math.min(127, FIRST_ZONE_KEY + k), Math.min(127, FIRST_ZONE_KEY + k), Math.min(127, FIRST_ZONE_KEY + k))) },
      { label: 'Split the keyboard between the root notes', disabled: rows.length < 2,
        run: all((r, k) => zoneKeys(r.index, ranges[k].lo, ranges[k].hi, roots[k])) },
      { label: 'All on the whole keyboard', disabled: !rows.length, run: all((r, k) => zoneKeys(r.index, 0, 127, roots[k])) },
      SEPARATOR,
      { label: 'Show the whole keyboard', run: () => this.zoneView.zoomAll() },
    ]);
  }

  // ---------------------------------------------------------------- sample

  private audio() {
    return this.ctx.samples?.audio?.(zoneSlot(this.zone));
  }

  private sampleName(zone: number): string | null {
    const id = sampleAt(this.settings, zoneSlot(zone));
    return (id && this.ctx.samples?.list().find(s => s.id === id)?.name) || null;
  }

  /** The values as the chosen zone sees them: positions, root note and sound (see OF_ZONE) are
   *  its own, under the names of the first zone's parameters. */
  private zoneValues(): Record<string, number> {
    const zone = this.zone;
    if (zone === 0) return this.values;
    const cached = this.shownValues;
    if (cached?.values === this.values && cached.zone === zone) return cached.out;
    const out = { ...this.values };
    for (const key of OF_ZONE) out[key] = this.values[zoneSource(this.values, zone, key as ZoneKey)];
    this.shownValues = { values: this.values, zone, out };
    return out;
  }

  /** Values with the first zone's names into the chosen zone's parameters. Touching the sound of a
   *  zone following the first, the zone takes its own (from the first) and then the change. */
  private toZone(values: ParamValues): ParamValues {
    const zone = this.zone;
    if (zone === 0) return values;
    const out: Record<string, number> = Object.keys(values).some(id => SOUND.has(id)) ? ownSound(this.values, zone) : {};
    for (const [id, v] of Object.entries(values)) out[OF_ZONE.has(id) ? zoneParam(zone, id as ZoneKey) : id] = v;
    return out;
  }

  private refreshSample(): void {
    const all = this.ctx.samples?.list() ?? [], rows = this.rows();
    const current = sampleAt(this.settings, zoneSlot(this.zone));
    this.sampleChoice.replaceChildren(el('option', { value: '', textContent: '— no sample —' }),
      ...all.map(s => el('option', { value: s.id, textContent: s.name })));
    this.sampleChoice.value = current ?? '';
    this.zoneChoice.replaceChildren(...rows.map(r => el('option', { value: String(r.index), textContent: `Zone ${r.index + 1} · ${r.name}` })));
    this.zoneChoice.value = String(this.zone);
    this.zoneChoice.hidden = rows.length < 2 || this.values.mode === MODE.slice;
    const follows = this.values[zoneParam(this.zone, 'own')] !== 1;
    this.link.hidden = this.zone === 0;
    this.link.classList.toggle('on', follows);
    this.link.title = follows
      ? 'This zone\'s sound (loop, pitch, filter, envelopes, LFO) is zone 1\'s. Click (or change one of its controls) to give it its own.'
      : 'This zone has its own sound (loop, pitch, filter, envelopes, LFO). Click: back to zone 1\'s.';
    for (const [title, name] of this.soundTitles) title.textContent = rows.length > 1 ? `${name} · zone ${this.zone + 1}` : name;
    const a = this.audio();
    if (!a) {
      this.info.textContent = rows.length > 1 ? `${rows.length} zone` : '';
      return;
    }
    const seconds = a.channels[0].length / a.sampleRate;
    const length = seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(2)} s`;
    this.info.textContent = `${length} · ${(a.sampleRate / 1000).toFixed(1)} kHz · ${a.channels.length > 1 ? 'stereo' : 'mono'}`;
  }

  /** A project sample in the chosen zone (null: removed). In Slice at the transients, the slices are looked for right away. */
  private assign(id: SampleId | null): void {
    const samples = this.ctx.samples;
    if (!samples) return;
    if (!id && this.zone !== 0) return this.removeZone(this.zone);
    samples.assign({ [zoneSlot(this.zone)]: id }, {});
    if (id) this.afterLoad();
  }

  /** A file in the chosen zone; several files go into new zones. */
  private async loadFiles(files: readonly File[]): Promise<void> {
    const samples = this.ctx.samples;
    if (!samples || !files.length) return;
    if (files.length > 1 && this.values.mode !== MODE.slice) return this.newZones(files, this.nextKey());
    const file = files[0];
    try {
      await samples.load(zoneSlot(this.zone), file, {});
    } catch (err) {
      this.info.textContent = `Can't load "${file.name}": ${err instanceof Error ? err.message : err}`;
      return;
    }
    this.afterLoad();
  }

  /** After a new sample: everything is shown, and in Slice at the transients the slices are its own. */
  private afterLoad(): void {
    this.wave.zoomAll();
    if (this.values.mode === MODE.slice && this.values.sliceBy === SLICE.transients) this.findSlices(this.values[SENSITIVITY], true);
    let pitch: number;
    if (this.values.mode === MODE.slice) pitch = FIRST_SLICE_NOTE;
    else if (this.zone === 0 && this.rows().length < 2) pitch = 60;
    else pitch = this.zonePitch(this.zone);
    this.ctx.audition(pitch, AUDITION_VELOCITY);
  }

  private pickFiles(then: (files: File[]) => void, multiple = true): void {
    const input = el<HTMLInputElement>('input', { type: 'file', accept: 'audio/*', multiple });
    input.onchange = () => {
      const files = [...input.files ?? []];
      if (files.length) then(files);
    };
    input.click();
  }

  /** Files from disk and samples (or files) from the browser, dropped on the panel. On the zone editor
   *  they go into new zones from the key under the pointer (on a zone's name: they change its sample). */
  private bindDrops(): void {
    const target = this.element;
    if (!this.ctx.samples) return;
    const files = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    /** Where what arrives at (x, y) goes: a new zone from a key, or a row's zone. */
    const where = (x: number, y: number): { key: number } | { zone: number } | null => {
      if (this.tab !== 'zones' || !this.zoneView.canvas.contains(document.elementFromPoint(x, y))) return null;
      const key = this.zoneView.keyAt(x), zone = this.zoneView.zoneAt(y);
      return key === null && zone !== null ? { zone } : { key: key ?? this.nextKey() };
    };
    target.addEventListener('dragover', e => {
      if (!files(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer!.dropEffect = 'copy';
      target.classList.add('drop');
    });
    target.addEventListener('dragleave', e => {
      if (!target.contains(e.relatedTarget as Node | null)) target.classList.remove('drop');
    });
    target.addEventListener('drop', e => {
      if (!files(e)) return;
      e.preventDefault();
      e.stopPropagation();
      target.classList.remove('drop');
      const audio = [...e.dataTransfer!.files].filter(isAudio);
      if (!audio.length) return;
      const at = where(e.clientX, e.clientY);
      if (at && 'key' in at) void this.newZones(audio, at.key);
      else {
        if (at) view.zone = at.zone;
        void this.loadFiles(audio);
      }
    });
    acceptBrowserDrops(target, (item, e) => {
      const p = item.payload, at = where(e.clientX, e.clientY);
      if (p?.kind === 'sample') {
        if (at && 'key' in at) this.newZone(p.sample.id, p.sample.name, at.key);
        else {
          if (at) view.zone = at.zone;
          this.assign(p.sample.id);
        }
      } else if (p?.kind === 'file') {
        void p.file().then(f => (at && 'key' in at ? this.newZones([f], at.key) : this.loadFiles([f])));
      }
    }, { accept: item => item.payload?.kind === 'sample' || item.payload?.kind === 'file' });
  }

  // ---------------------------------------------------------------- slices

  /** Looks for the slices at the transients with sensitivity `sens` (0…100) and saves them (on the first zone's sample). */
  private findSlices(sens: number, final: boolean): void {
    const audio = this.ctx.samples?.audio?.(zoneSlot(0));
    if (!audio) return;
    const v = this.values;
    const found = findTransients(audio, v.reverse === 1, sens / 100, v.start / 100, v.end / 100);
    this.ctx.setParams({ [SENSITIVITY]: sens, ...sliceValues(found) }, final);
  }

  private setMode(mode: number): void {
    const v = this.values, audio = this.ctx.samples?.audio?.(zoneSlot(0));
    // switching to Slice at the transients the first time, the slices are found by themselves
    if (mode === MODE.slice && v.sliceBy === SLICE.transients && !v[SLICE_COUNT] && audio) {
      const found = findTransients(audio, v.reverse === 1, v[SENSITIVITY] / 100, v.start / 100, v.end / 100);
      this.ctx.setParams({ mode, ...sliceValues(found) }, true);
    } else this.ctx.setParams({ mode }, true);
  }

  private menu(x: number, y: number): void {
    const samples = this.ctx.samples, loaded = sampleAt(this.settings, zoneSlot(this.zone));
    const sliced = this.values.mode === MODE.slice, transients = sliced && this.values.sliceBy === SLICE.transients;
    showContextMenu(x, y, [
      { label: 'Load a sample…', run: () => this.pickFiles(files => this.loadFiles(files), false) },
      { label: 'Remove the sample', disabled: !loaded || !samples, run: () => this.assign(null) },
      ...(sliced ? [] : [{ label: 'Load into new zones…', run: () => this.pickFiles(files => this.newZones(files, this.nextKey())) }]),
      SEPARATOR,
      { label: 'Show the whole sample', run: () => this.wave.zoomAll() },
      ...(transients ? [
        SEPARATOR,
        { label: 'Detect the slices at the transients', disabled: !this.audio(), run: () => this.findSlices(this.values[SENSITIVITY], true) },
        { label: 'Remove all the slices', disabled: !this.values[SLICE_COUNT], run: () => this.ctx.setParams(sliceValues([]), true) },
      ] : []),
    ]);
  }

  // ---------------------------------------------------------------- envelopes

  private showEnv(env: number): void {
    view.env = env;
    this.envTabs.forEach((b, i) => b.classList.toggle('on', i + 1 === env));
    for (const id of [...this.controls.keys()]) if (/^e\d[AHDSR]$/.test(id)) this.controls.delete(id);
    this.envKnobs.replaceChildren(...['A', 'H', 'D', 'S', 'R'].map(k => this.control(`e${env}${k}`)));
    this.envView.show(env);
    this.update(this.settings, this.enabled);
    this.ctx.controlsChanged();
  }

  // ---------------------------------------------------------------- controls

  private card(title: HTMLElement, head: readonly Node[], ...body: Node[]): HTMLElement {
    return el('div', { className: 'smp-card' }, el('div', { className: 'smp-card-head' }, title, ...head), ...body);
  }

  /** The title of a tab applying to the chosen zone (with several zones it says which). */
  private title(name: string): HTMLElement {
    const title = el('span', { className: 'smp-card-title', textContent: name });
    this.soundTitles.push([title, name]);
    return title;
  }

  /** A row of controls. */
  private row(...ids: string[]): HTMLElement {
    return el('div', { className: 'device-controls smp-knobs' }, ...ids.map(id => this.control(id)));
  }

  /** The row of the zone tab: one slot per control, filled by buildZoneControls. */
  private zoneRow(keys: readonly ZoneKey[]): HTMLElement {
    return el('div', { className: 'device-controls smp-knobs' }, ...keys.map(key => {
      const slot = el('span', { className: 'smp-slot' });
      this.slots.set(key, slot);
      return slot;
    }));
  }

  /** The control of parameter `id`; `change` in place of the normal change (e.g. the mode). */
  private control(id: string, change?: (v: number) => void, menu = MENUS.has(id), key = id): HTMLElement {
    const spec = paramSpec(this.ctx.type, id)!;
    let onChange: (v: number, final: boolean) => void;
    if (id === SENSITIVITY) onChange = (v, final) => this.findSlices(v, final);
    else if (id === 'sliceBy') onChange = v => this.setSliceBy(v);
    else if (change) onChange = v => change(v);
    else onChange = (v, final) => this.ctx.setParams(this.toZone({ [id]: v }), final);
    const control = controlFor(spec, this.zoneValues()[id], onChange, { menu });
    this.controls.set(id, { control, spec, key });
    return control.element;
  }

  private setSliceBy(sliceBy: number): void {
    const v = this.values, audio = this.ctx.samples?.audio?.(zoneSlot(0));
    if (sliceBy === SLICE.transients && !v[SLICE_COUNT] && audio) {
      const found = findTransients(audio, v.reverse === 1, v[SENSITIVITY] / 100, v.start / 100, v.end / 100);
      this.ctx.setParams({ sliceBy, ...sliceValues(found) }, true);
    } else this.ctx.setParams({ sliceBy }, true);
  }

  /** On/off of the filter, a button in the tab's header. */
  private power(id: string): HTMLElement {
    const b = el<HTMLButtonElement>('button', { className: 'mini smp-power', textContent: '⏻', title: 'Turn the filter on/off' });
    b.dataset.param = id;
    b.onclick = () => this.ctx.setParams(this.toZone({ [id]: this.zoneValues()[id] === 1 ? 0 : 1 }), true);
    this.controls.set(id, { control: { element: b, set: v => b.classList.toggle('on', v === 1) }, spec: paramSpec(this.ctx.type, id)!, key: id });
    return b;
  }

  private paint(): void {
    this.wave.setEnabled(this.enabled);
    this.zoneView.setEnabled(this.enabled);
    if (this.tab === 'zones') this.zoneView.paint();
    else this.wave.paint();
    this.envView.paint(this.enabled);
  }
}
