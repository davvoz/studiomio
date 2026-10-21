/* Il pannello del Sampler. In alto, nella scheda Sample, la forma d'onda della zona scelta (con
 * il sample da scegliere o caricare); nella scheda Zone l'editor delle zone sulla tastiera. A
 * destra gli inviluppi disegnati; sotto le schede del sample (con i controlli del modo scelto) o
 * della zona, dell'intonazione, del filtro, della voce e dell'uscita; a destra l'LFO. Tutto,
 * tranne il modo, la voce e l'uscita, è della zona scelta: i controlli hanno i nomi dei parametri
 * della prima zona e scrivono in quelli della zona (il cui suono, toccato, diventa suo). Il modo (Classic,
 * One-Shot, Slice) sta nell'intestazione del dispositivo. Un file audio dal disco o un sample dal
 * browser lasciato sul pannello diventa il sample della zona scelta; più file insieme, o lasciati
 * sull'editor delle zone, diventano zone nuove (dal tasto sotto il puntatore). */
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

/** I file che si possono lasciare sul pannello. */
const isAudio = (f: File) => f.type.startsWith('audio/') || /\.(wav|aiff?|flac|mp3|ogg|m4a)$/i.test(f.name);

/** I controlli della scheda del sample, nel loro ordine; poi quelli che si vedono in ogni modo. */
const SAMPLE_ORDER = ['start', 'end', 'sliceBy', 'sliceGrid', SENSITIVITY, 'loop', 'loopStart', 'loopEnd', 'xfade', 'loopRelease', 'trigger', 'reverse'];
const SAMPLE_CONTROLS: Readonly<Record<number, readonly string[]>> = {
  [MODE.classic]: ['start', 'end', 'loop', 'loopStart', 'loopEnd', 'xfade', 'loopRelease', 'reverse'],
  [MODE.oneShot]: ['start', 'end', 'trigger', 'reverse'],
  [MODE.slice]: ['sliceBy', 'sliceGrid', SENSITIVITY, 'trigger', 'reverse'],
};
const SAMPLE_KEYS = new Set(Object.values(SAMPLE_CONTROLS).flat());
/** I controlli della scheda della zona: cambiando zona si rifanno. */
const ZONE_CONTROLS: readonly ZoneKey[] = ['lo', 'hi', 'vlo', 'vhi', 'gain', 'pan'];
/** Le chiavi che hanno i nomi dei parametri della prima zona e valgono per la zona scelta. */
const OF_ZONE = FIRST_ZONE_KEYS as ReadonlySet<string>;
const SOUND = new Set<string>(SOUND_KEYS);
/** Le scelte che stanno meglio in un menu che in fila di pulsanti. */
const MENUS = new Set(['loop', 'loopRelease', 'sliceBy', 'sliceGrid', 'root', 'voiceMode', 'fType', 'lfoShape', 'lfoDiv', 'lo', 'hi']);
/** I controlli che, quando non contano, si tolgono invece di attenuarsi (stanno allo stesso posto). */
const SWAPPED = new Set(['lfoRate', 'lfoDiv', 'sliceGrid', SENSITIVITY]);

/** Velocity delle note di prova (le fette, le zone). */
const AUDITION_VELOCITY = 110;
/** Il primo tasto delle zone caricate una per tasto: C1, come i pad di una batteria. */
const FIRST_ZONE_KEY = 36;

type Tab = 'sample' | 'zones';

/** L'inviluppo che si guarda, la scheda in alto e la zona scelta (restano fra un pannello e l'altro). */
const view = { env: 1, tab: 'sample' as Tab, zone: 0 };

export class SamplerDisplay implements DeviceDisplay {
  readonly element = el('div', { className: 'smp' });
  readonly head: HTMLElement;
  /** I controlli per id del parametro, con la chiave che li ordina (per le zone: "start", "lo"…). */
  private readonly controls = new Map<string, { control: ParamControl; spec: ParamSpec; key: string }>();
  /** I posti dei controlli che valgono per la zona scelta. */
  private readonly slots = new Map<ZoneKey, HTMLElement>();
  /** Gli id dei controlli della scheda della zona di adesso (z2lo…), da togliere cambiando zona. */
  private zoneControls: string[] = [];
  private readonly wave: WaveView;
  private readonly zoneView: ZoneView;
  private readonly envView: EnvView;
  private readonly envTabs: HTMLButtonElement[] = [];
  private readonly envKnobs = el('div', { className: 'device-controls smp-knobs' });
  private readonly tabs: Record<Tab, HTMLButtonElement>;
  private readonly zoneChoice = el<HTMLSelectElement>('select', { className: 'smp-zone-pick', title: 'La zona che si guarda' });
  private readonly sampleChoice = el<HTMLSelectElement>('select', { className: 'smp-sample', title: 'Il sample della zona (tra quelli del progetto)' });
  private readonly addZones = el<HTMLButtonElement>('button', { className: 'mini', textContent: '+ Zone…', title: 'Carica dei file audio in zone nuove, un tasto ciascuno (o sulle note scritte nei nomi)' });
  /** Il suono della zona scelta: come la prima o suo. */
  private readonly link = el<HTMLButtonElement>('button', { className: 'mini smp-link', textContent: 'Come zona 1' });
  private readonly info = el('span', { className: 'smp-info muted' });
  private readonly detect = el<HTMLButtonElement>('button', { className: 'mini smp-detect', textContent: 'Rileva', title: 'Trova le fette ai transienti (con la sensibilità scelta)' });
  private readonly sampleCard: HTMLElement;
  private readonly zoneCard: HTMLElement;
  private readonly zoneTitle = el('span', { className: 'smp-card-title' });
  /** I titoli delle schede che valgono per la zona scelta, con il loro nome ("Filtro" → "Filtro · zona 2"). */
  private readonly soundTitles: [HTMLElement, string][] = [];
  private values: Record<string, number>;
  private params: ParamValues | null = null;
  private settings: DeviceSettings;
  private enabled = true;
  /** La zona per cui sono fatti i controlli che dipendono dalla zona. */
  private builtZone = -1;
  /** I valori come li vede la zona scelta (vedi zoneValues). */
  private shownValues: { values: Record<string, number>; zone: number; out: Record<string, number> } | null = null;
  /** Il pannello è stato nel documento: quando ne esce smette di guardare le voci. */
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
    // il nome dell'inviluppo è nella scheda scelta (e la zona nel titolo): il disegno usa tutta l'altezza
    this.envView = new EnvView(() => this.zoneValues(), (values, final) => ctx.setParams(this.toZone(values), final), () => '', true);
    this.envView.canvas.classList.add('smp-env');

    const mode = this.control('mode', v => this.setMode(v));
    mode.classList.add('smp-mode');
    this.head = el('div', { className: 'smp-head' }, mode);

    this.tabs = {
      sample: el<HTMLButtonElement>('button', { className: 'mini', textContent: 'Sample', title: 'La forma d\'onda della zona scelta', onclick: () => this.showTab('sample') }),
      zones: el<HTMLButtonElement>('button', { className: 'mini', textContent: 'Zone', title: 'I sample sulla tastiera: tasti e velocity di ogni zona', onclick: () => this.showTab('zones') }),
    };
    this.zoneChoice.onchange = () => this.selectZone(Number(this.zoneChoice.value));
    this.link.onclick = () => {
      const zone = this.zone, own = ownSound(this.values, zone);
      ctx.setParams(Object.keys(own).length ? own : { [zoneParam(zone, 'own')]: 0 }, true);
    };
    this.sampleChoice.onchange = () => this.assign((this.sampleChoice.value || null) as SampleId | null);
    const load = el<HTMLButtonElement>('button', { className: 'mini', textContent: 'Carica…', title: 'Carica un file audio nella zona scelta', onclick: () => this.pickFiles(files => this.loadFiles(files), false) });
    this.addZones.onclick = () => this.pickFiles(files => this.newZones(files, this.nextKey()));
    this.detect.onclick = () => this.findSlices(this.values[SENSITIVITY], true);
    const waveBox = el('div', { className: 'smp-wave-box' },
      el('div', { className: 'smp-wave-bar' }, el('div', { className: 'smp-tabs' }, this.tabs.sample, this.tabs.zones),
        this.zoneChoice, this.link, this.sampleChoice, load, this.addZones, this.info),
      this.wave.canvas, this.zoneView.canvas);

    const envCard = el('div', { className: 'smp-card smp-env-card' },
      el('div', { className: 'smp-card-head' }, this.title('Inviluppi'), el('div', { className: 'smp-tabs' }, ...ENV_NAMES.map((name, i) => {
        const b = el<HTMLButtonElement>('button', { className: 'mini', textContent: name, onclick: () => this.showEnv(i + 1) });
        this.envTabs.push(b);
        return b;
      }))), el('div', { className: 'smp-env-body' }, el('div', { className: 'smp-env-box' }, this.envView.canvas), this.envKnobs));

    this.sampleCard = el('div', { className: 'smp-card' },
      el('div', { className: 'smp-card-head' }, this.title('Sample'), this.detect), this.row(...SAMPLE_ORDER));
    this.sampleCard.classList.add('smp-sample-card');
    const remove = el<HTMLButtonElement>('button', { className: 'mini', textContent: 'Togli', title: 'Toglie la zona e il suo sample', onclick: () => this.removeZone(this.zone) });
    this.zoneCard = el('div', { className: 'smp-card smp-zone-card' },
      el('div', { className: 'smp-card-head' }, this.zoneTitle, remove), this.zoneRow(ZONE_CONTROLS));
    const pitchCard = this.card(this.title('Intonazione'), [], this.row('root', 'transpose', 'detune', 'keyTrack', 'pitchEnv'));
    const filterCard = this.card(this.title('Filtro'), [this.power('fOn'), this.control('fType', undefined, true)],
      this.row('fCutoff', 'fRes', 'fDrive', 'fVar', 'fKey', 'fEnv', 'fVel'));
    // ciò che resta di tutto il Sampler: la voce (una voce sola è di tutte le zone) e l'uscita
    const outCard = this.card(el('span', { className: 'smp-card-title', textContent: 'Voce e uscita' }), [],
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

  /** A ogni fotogramma: i cursori delle voci, e il sample quando finisce di caricarsi. */
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
    // la zona scelta non c'è più (tolta): si passa alla prima che c'è
    if (view.zone !== 0 && !sampleAt(settings, zoneSlot(view.zone))) view.zone = this.rows()[0]?.index ?? 0;
    if (this.zone !== this.builtZone) this.buildZoneControls();
    const shown = new Set(SAMPLE_CONTROLS[this.values.mode] ?? []), values = this.zoneValues();
    for (const [id, { control, spec, key }] of this.controls) {
      control.set(values[id]);
      const active = paramActive(spec, values);
      setActive(control, active);
      control.element.hidden = (SAMPLE_KEYS.has(key) && !shown.has(key)) || (SWAPPED.has(key) && !active);
    }
    // la sensibilità conta solo con le fette ai transienti (è un parametro dell'interfaccia)
    const transients = this.values.mode === MODE.slice && this.values.sliceBy === SLICE.transients;
    const sens = this.controls.get(SENSITIVITY);
    if (sens) sens.control.element.hidden = !transients;
    this.detect.hidden = !transients;
    this.showTab(this.tab, false);
    this.refreshSample();
    this.paint();
  }

  // ---------------------------------------------------------------- zone

  /** La scheda in alto: in Slice c'è solo il sample (le fette sono della prima zona). */
  private get tab(): Tab {
    return this.values.mode === MODE.slice ? 'sample' : view.tab;
  }

  /** La zona che si guarda: in Slice la prima, che ha le fette. */
  private get zone(): number {
    return this.values.mode === MODE.slice ? 0 : view.zone;
  }

  /** Le zone che hanno un sample, in ordine. */
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

  /** Rifà i controlli che valgono per la zona scelta, ai loro posti. */
  private buildZoneControls(): void {
    const zone = this.zone;
    this.builtZone = zone;
    for (const id of this.zoneControls) this.controls.delete(id);
    this.zoneControls = [...this.slots.keys()].map(key => zoneParam(zone, key));
    for (const [key, slot] of this.slots) slot.replaceChildren(this.control(zoneParam(zone, key), undefined, MENUS.has(key), key));
    this.zoneTitle.textContent = `Zona ${zone + 1}`;
    this.ctx.controlsChanged();
  }

  /** Il tasto da cui partono le zone nuove: dopo l'ultima zona su un tasto solo, o C1. */
  private nextKey(): number {
    const single = this.rows().map(r => zoneMap(this.values, r.index)).filter(z => z.lo === z.hi);
    return single.length ? Math.min(127, Math.max(...single.map(z => z.hi)) + 1) : FIRST_ZONE_KEY;
  }

  /** Le zone libere (senza sample), quante ne servono, e i valori per metterci `names` da `first`. */
  private place(names: readonly string[], first: number): { zones: number[]; values: Record<string, number> } | null {
    const free = Array.from({ length: MAX_ZONES }, (_, i) => i).filter(i => !sampleAt(this.settings, zoneSlot(i)));
    if (free.length < names.length) {
      this.info.textContent = `Al massimo ${MAX_ZONES} zone: ne restano ${free.length}.`;
      return null;
    }
    const layout = layoutZones(names, first), zones = free.slice(0, names.length), values: Record<string, number> = {};
    // della zona resta solo la mappa nuova: ciò che le era rimasto da prima torna ai predefiniti
    for (const [k, z] of zones.entries()) {
      for (const [id, def] of Object.entries(zoneDefaults(z))) if (this.values[id] !== def) values[id] = def;
      Object.assign(values, zoneKeys(z, layout[k].lo, layout[k].hi, layout[k].root));
    }
    return { zones, values };
  }

  /** File in zone nuove, da `first` (un passo solo); poi si guardano le zone. */
  private async newZones(files: readonly File[], first: number): Promise<void> {
    const samples = this.ctx.samples;
    const placed = samples?.loadAll && this.place(files.map(f => f.name), first);
    if (!samples?.loadAll || !placed) return;
    try {
      await samples.loadAll(Object.fromEntries(placed.zones.map((z, k) => [zoneSlot(z), files[k]])), placed.values);
    } catch (err) {
      this.info.textContent = `Impossibile caricare i file: ${err instanceof Error ? err.message : err}`;
      return;
    }
    this.afterZones(placed.zones);
  }

  /** Un sample del progetto in una zona nuova, sul tasto `key`. */
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

  /** La nota che fa sentire la zona: la sua nota base, se ci sta dentro. */
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
      { label: 'Carica in zone nuove…', run: () => this.pickFiles(files => this.newZones(files, this.nextKey())) },
      { label: `Cambia il sample della zona ${zone + 1}…`, disabled: !has, run: () => this.pickFiles(files => this.loadFiles(files), false) },
      { label: `Togli la zona ${zone + 1}`, disabled: !has, run: () => this.removeZone(zone) },
      SEPARATOR,
      { label: 'Un tasto per zona, da C1', disabled: !rows.length,
        run: all((r, k) => zoneKeys(r.index, Math.min(127, FIRST_ZONE_KEY + k), Math.min(127, FIRST_ZONE_KEY + k), Math.min(127, FIRST_ZONE_KEY + k))) },
      { label: 'Dividi la tastiera tra le note base', disabled: rows.length < 2,
        run: all((r, k) => zoneKeys(r.index, ranges[k].lo, ranges[k].hi, roots[k])) },
      { label: 'Tutte su tutta la tastiera', disabled: !rows.length, run: all((r, k) => zoneKeys(r.index, 0, 127, roots[k])) },
      SEPARATOR,
      { label: 'Mostra tutta la tastiera', run: () => this.zoneView.zoomAll() },
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

  /** I valori come li vede la zona scelta: posizioni, nota base e suono (vedi OF_ZONE) sono i
   *  suoi, sotto i nomi dei parametri della prima zona. */
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

  /** Valori con i nomi della prima zona nei parametri della zona scelta. Toccando il suono di una
   *  zona che segue la prima, la zona prende il suo (dalla prima) e poi il cambio. */
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
    this.sampleChoice.replaceChildren(el('option', { value: '', textContent: '— nessun sample —' }),
      ...all.map(s => el('option', { value: s.id, textContent: s.name })));
    this.sampleChoice.value = current ?? '';
    this.zoneChoice.replaceChildren(...rows.map(r => el('option', { value: String(r.index), textContent: `Zona ${r.index + 1} · ${r.name}` })));
    this.zoneChoice.value = String(this.zone);
    this.zoneChoice.hidden = rows.length < 2 || this.values.mode === MODE.slice;
    const follows = this.values[zoneParam(this.zone, 'own')] !== 1;
    this.link.hidden = this.zone === 0;
    this.link.classList.toggle('on', follows);
    this.link.title = follows
      ? 'Il suono di questa zona (loop, intonazione, filtro, inviluppi, LFO) è quello della zona 1. Clic (o cambiane un controllo) per darle il suo.'
      : 'Questa zona ha il suo suono (loop, intonazione, filtro, inviluppi, LFO). Clic: torna quello della zona 1.';
    for (const [title, name] of this.soundTitles) title.textContent = rows.length > 1 ? `${name} · zona ${this.zone + 1}` : name;
    const a = this.audio();
    if (!a) {
      this.info.textContent = rows.length > 1 ? `${rows.length} zone` : '';
      return;
    }
    const seconds = a.channels[0].length / a.sampleRate;
    const length = seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(2)} s`;
    this.info.textContent = `${length} · ${(a.sampleRate / 1000).toFixed(1)} kHz · ${a.channels.length > 1 ? 'stereo' : 'mono'}`;
  }

  /** Un sample del progetto nella zona scelta (null: tolto). In Slice ai transienti, le fette si cercano subito. */
  private assign(id: SampleId | null): void {
    const samples = this.ctx.samples;
    if (!samples) return;
    if (!id && this.zone !== 0) return this.removeZone(this.zone);
    samples.assign({ [zoneSlot(this.zone)]: id }, {});
    if (id) this.afterLoad();
  }

  /** Un file nella zona scelta; più file vanno in zone nuove. */
  private async loadFiles(files: readonly File[]): Promise<void> {
    const samples = this.ctx.samples;
    if (!samples || !files.length) return;
    if (files.length > 1 && this.values.mode !== MODE.slice) return this.newZones(files, this.nextKey());
    const file = files[0];
    try {
      await samples.load(zoneSlot(this.zone), file, {});
    } catch (err) {
      this.info.textContent = `Impossibile caricare "${file.name}": ${err instanceof Error ? err.message : err}`;
      return;
    }
    this.afterLoad();
  }

  /** Dopo un sample nuovo: si vede tutto, e in Slice ai transienti le fette sono le sue. */
  private afterLoad(): void {
    this.wave.zoomAll();
    if (this.values.mode === MODE.slice && this.values.sliceBy === SLICE.transients) this.findSlices(this.values[SENSITIVITY], true);
    this.ctx.audition(this.values.mode === MODE.slice ? FIRST_SLICE_NOTE : this.zone === 0 && this.rows().length < 2 ? 60 : this.zonePitch(this.zone), AUDITION_VELOCITY);
  }

  private pickFiles(then: (files: File[]) => void, multiple = true): void {
    const input = el<HTMLInputElement>('input', { type: 'file', accept: 'audio/*', multiple });
    input.onchange = () => {
      const files = [...input.files ?? []];
      if (files.length) then(files);
    };
    input.click();
  }

  /** File dal disco e sample (o file) dal browser, lasciati sul pannello. Sull'editor delle zone
   *  vanno in zone nuove dal tasto sotto il puntatore (sul nome di una zona: ne cambiano il sample). */
  private bindDrops(): void {
    const target = this.element;
    if (!this.ctx.samples) return;
    const files = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    /** Dove va ciò che arriva a (x, y): una zona nuova da un tasto, o la zona di una riga. */
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

  // ---------------------------------------------------------------- fette

  /** Cerca le fette ai transienti con la sensibilità `sens` (0…100) e le salva (sul sample della prima zona). */
  private findSlices(sens: number, final: boolean): void {
    const audio = this.ctx.samples?.audio?.(zoneSlot(0));
    if (!audio) return;
    const v = this.values;
    const found = findTransients(audio, v.reverse === 1, sens / 100, v.start / 100, v.end / 100);
    this.ctx.setParams({ [SENSITIVITY]: sens, ...sliceValues(found) }, final);
  }

  private setMode(mode: number): void {
    const v = this.values, audio = this.ctx.samples?.audio?.(zoneSlot(0));
    // passando a Slice ai transienti la prima volta, le fette si trovano da sole
    if (mode === MODE.slice && v.sliceBy === SLICE.transients && !v[SLICE_COUNT] && audio) {
      const found = findTransients(audio, v.reverse === 1, v[SENSITIVITY] / 100, v.start / 100, v.end / 100);
      this.ctx.setParams({ mode, ...sliceValues(found) }, true);
    } else this.ctx.setParams({ mode }, true);
  }

  private menu(x: number, y: number): void {
    const samples = this.ctx.samples, loaded = sampleAt(this.settings, zoneSlot(this.zone));
    const sliced = this.values.mode === MODE.slice, transients = sliced && this.values.sliceBy === SLICE.transients;
    showContextMenu(x, y, [
      { label: 'Carica un sample…', run: () => this.pickFiles(files => this.loadFiles(files), false) },
      { label: 'Togli il sample', disabled: !loaded || !samples, run: () => this.assign(null) },
      ...(sliced ? [] : [{ label: 'Carica in zone nuove…', run: () => this.pickFiles(files => this.newZones(files, this.nextKey())) }]),
      SEPARATOR,
      { label: 'Mostra tutto il sample', run: () => this.wave.zoomAll() },
      ...(transients ? [
        SEPARATOR,
        { label: 'Rileva le fette ai transienti', disabled: !this.audio(), run: () => this.findSlices(this.values[SENSITIVITY], true) },
        { label: 'Togli tutte le fette', disabled: !this.values[SLICE_COUNT], run: () => this.ctx.setParams(sliceValues([]), true) },
      ] : []),
    ]);
  }

  // ---------------------------------------------------------------- inviluppi

  private showEnv(env: number): void {
    view.env = env;
    this.envTabs.forEach((b, i) => b.classList.toggle('on', i + 1 === env));
    for (const id of [...this.controls.keys()]) if (/^e\d[AHDSR]$/.test(id)) this.controls.delete(id);
    this.envKnobs.replaceChildren(...['A', 'H', 'D', 'S', 'R'].map(k => this.control(`e${env}${k}`)));
    this.envView.show(env);
    this.update(this.settings, this.enabled);
    this.ctx.controlsChanged();
  }

  // ---------------------------------------------------------------- controlli

  private card(title: HTMLElement, head: readonly Node[], ...body: Node[]): HTMLElement {
    return el('div', { className: 'smp-card' }, el('div', { className: 'smp-card-head' }, title, ...head), ...body);
  }

  /** Il titolo di una scheda che vale per la zona scelta (con più zone dice quale). */
  private title(name: string): HTMLElement {
    const title = el('span', { className: 'smp-card-title', textContent: name });
    this.soundTitles.push([title, name]);
    return title;
  }

  /** Una fila di controlli. */
  private row(...ids: string[]): HTMLElement {
    return el('div', { className: 'device-controls smp-knobs' }, ...ids.map(id => this.control(id)));
  }

  /** La fila della scheda della zona: un posto per controllo, riempito da buildZoneControls. */
  private zoneRow(keys: readonly ZoneKey[]): HTMLElement {
    return el('div', { className: 'device-controls smp-knobs' }, ...keys.map(key => {
      const slot = el('span', { className: 'smp-slot' });
      this.slots.set(key, slot);
      return slot;
    }));
  }

  /** Il controllo del parametro `id`; `change` al posto del cambio normale (es. il modo). */
  private control(id: string, change?: (v: number) => void, menu = MENUS.has(id), key = id): HTMLElement {
    const spec = paramSpec(this.ctx.type, id)!;
    const onChange = id === SENSITIVITY
      ? (v: number, final: boolean) => this.findSlices(v, final)
      : id === 'sliceBy'
        ? (v: number) => this.setSliceBy(v)
        : change ? (v: number) => change(v) : (v: number, final: boolean) => this.ctx.setParams(this.toZone({ [id]: v }), final);
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

  /** Acceso/spento del filtro, un pulsante nell'intestazione della scheda. */
  private power(id: string): HTMLElement {
    const b = el<HTMLButtonElement>('button', { className: 'mini smp-power', textContent: '⏻', title: 'Accendi/spegni il filtro' });
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
