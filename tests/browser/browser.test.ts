import { describe, expect, it } from 'vitest';
import type { Preset } from '../../src/devices/device-type';
import { DRUMS } from '../../src/devices/instruments/drums/drums';
import { ANALOG } from '../../src/devices/instruments/analog/analog';
import { REVERB } from '../../src/devices/effects/reverb/reverb';
import { DELAY } from '../../src/devices/effects/delay/delay';
import { EFFECT_TYPES, INSTRUMENT_TYPES } from '../../src/devices/registry';
import { BrowserCatalog, standardSources, type FolderPlaces } from '../../src/browser/catalog';
import { deviceSource, kitSource, userPresetsSource, type UserPresetList, type UserRackList } from '../../src/browser/device-sources';
import { FACTORY_RACKS, TORNADO } from '../../src/devices/factory-racks';
import { MACRO_COUNT } from '../../src/model/rack';
import type { RackPreset } from '../../src/model/rack-preset';
import { childrenOf, type BrowserItem } from '../../src/browser/item';
import { duration, folderSource, projectSamplesSource, type FolderEntry, type FolderReader } from '../../src/browser/sample-sources';
import { search, searchSources } from '../../src/browser/search';
import { addSample } from '../../src/store/edits';
import { importSample } from '../../src/store/selection-edits';
import { sampleRef, setup } from '../helpers/fixtures';

const user = (presets: Record<string, Preset[]> = {}): UserPresetList & { fire(): void } => {
  const fns = new Set<() => void>();
  return {
    list: type => [...(presets[type] ?? [])],
    onChange: fn => { fns.add(fn); return () => fns.delete(fn); },
    fire: () => fns.forEach(f => f()),
  };
};

const names = (items: readonly BrowserItem[]) => items.map(i => i.name);

/** Una cartella finta: i nomi che finiscono con "/" sono sottocartelle. */
function folder(name: string, tree: Record<string, unknown>): FolderReader {
  return {
    name,
    entries: async () => Object.entries(tree).map(([n, v]): FolderEntry => (n.endsWith('/')
      ? { kind: 'folder', name: n.slice(0, -1), folder: folder(n.slice(0, -1), v as Record<string, unknown>) }
      : { kind: 'file', name: n, file: async () => new File([], n) })),
  };
}

describe('categorie dei dispositivi', () => {
  it('una cartella per dispositivo, che si carica com\'è, con dentro i preset: prima quelli dell\'utente', async () => {
    const source = deviceSource({ id: 'instruments', label: 'Strumenti', kind: 'instrument', types: [ANALOG, DRUMS], user: user({ analog: [{ name: 'Mio', params: { cutoff: 1 } }] }) });
    const items = await source.items();
    expect(names(items)).toEqual([ANALOG.label, DRUMS.label]);
    expect(items[0].payload).toEqual({ kind: 'instrument', type: 'analog', preset: null });
    const presets = await childrenOf(items[0]);
    expect(presets[0]).toMatchObject({ name: 'Mio', icon: 'user-preset', payload: { kind: 'instrument', type: 'analog', preset: { name: 'Mio' } } });
    expect(names(presets.slice(1))).toEqual(ANALOG.presets.map(p => p.name));
    expect(new Set(presets.map(p => p.id)).size).toBe(presets.length);
  });

  it('Batterie: i kit della Drum Machine in fila; gli effetti con i loro preset', async () => {
    const kits = await kitSource('drums', 'Batterie', [DRUMS], user()).items();
    expect(names(kits)).toEqual(DRUMS.presets.map(p => p.name));
    expect(kits.every(k => k.payload?.kind === 'instrument' && k.payload.type === DRUMS.type && !k.children)).toBe(true);
    const fx = await deviceSource({ id: 'effects', label: 'Effetti audio', kind: 'effect', types: [REVERB], user: user() }).items();
    expect((await childrenOf(fx[0]))[0].payload).toMatchObject({ kind: 'effect', type: REVERB.type, preset: REVERB.presets[0] });
  });

  it('le fonti standard sono solo quelle che l\'app ha', () => {
    const sources = standardSources({ instruments: INSTRUMENT_TYPES, effects: EFFECT_TYPES, user: user(), project: setup().store });
    expect(sources.map(s => s.label)).toEqual(['Strumenti', 'Batterie', 'Effetti audio', 'Progetto corrente', 'Preset dell\'utente']);
    expect(sources.map(s => s.section)).toEqual(['categories', 'categories', 'categories', 'places', 'places']);
  });

  it('Batterie ha solo i kit della Drum Machine, non i preset degli altri strumenti (es. il Sampler)', async () => {
    const drums = standardSources({ instruments: INSTRUMENT_TYPES, effects: [], user: user(), project: setup().store })[1];
    const items = await drums.items();
    expect(items.every(i => i.payload?.kind === 'instrument' && i.payload.type === DRUMS.type)).toBe(true);
    expect(names(items)).toEqual(DRUMS.presets.map(p => p.name));
  });

  it('Preset dell\'utente: una cartella per i dispositivi che ne hanno, e si rilegge quando cambiano', async () => {
    const presets: Record<string, Preset[]> = { delay: [{ name: 'Eco', params: {} }] };
    const u = user(presets);
    const source = userPresetsSource([ANALOG], [DELAY], u);
    const items = await source.items();
    expect(names(items)).toEqual([DELAY.label]);
    expect(await childrenOf(items[0])).toMatchObject([{ name: 'Eco', payload: { kind: 'effect', type: 'delay' } }]);
    let changed = 0;
    source.onChange!(() => changed++);
    u.fire();
    expect(changed).toBe(1);
  });

  it('rack salvati: Instrument Rack tra gli strumenti, Audio Effect Rack tra gli effetti e tra i Preset dell\'utente', async () => {
    const macros = Array.from({ length: MACRO_COUNT }, () => ({ name: null, value: 0, mappings: [] }));
    const synth: RackPreset = { name: 'Basso', instrument: { type: 'analog', preset: null, params: {} }, effects: [], macros };
    const eco: RackPreset = { name: 'Eco', instrument: null, effects: [{ type: 'delay', preset: null, params: {}, enabled: true }], macros };
    const fns = new Set<() => void>();
    const racks: UserRackList = { list: () => [synth, eco], onChange: fn => { fns.add(fn); return () => fns.delete(fn); } };
    const sources = standardSources({ instruments: [ANALOG], effects: [DELAY], user: user(), racks, project: setup().store });
    const [instruments, effects] = [await sources[0].items(), await sources[1].items()];
    expect(names(instruments)).toEqual(['Instrument Rack', ANALOG.label]);
    expect(names(effects)).toEqual(['Audio Effect Rack', DELAY.label]);
    expect(await childrenOf(instruments[0])).toMatchObject([{ name: 'Basso', icon: 'rack', payload: { kind: 'rack', rack: synth } }]);
    const mine = sources.find(s => s.id === 'user-presets')!;
    const folders = await mine.items();
    expect(names(folders)).toEqual(['Instrument Rack', 'Audio Effect Rack']);
    // le due cartelle nella stessa fonte: id diversi, ognuna con i suoi rack
    expect(folders[0].id).not.toBe(folders[1].id);
    expect(names(await childrenOf(folders[0]))).toEqual(['Basso']);
    expect(names(await childrenOf(folders[1]))).toEqual(['Eco']);
    expect(new Set((await Promise.all(folders.map(childrenOf))).flat().map(i => i.id)).size).toBe(2);
    // i rack salvati cambiati: le fonti si rileggono
    let changed = 0;
    const off = sources[1].onChange!(() => changed++);
    fns.forEach(f => f());
    off();
    fns.forEach(f => f());
    expect(changed).toBe(1);
    // lo stesso rack in due fonti si trova una volta sola
    const hits = await searchSources(sources, 'eco');
    expect(hits.filter(h => h.item.payload?.kind === 'rack').map(h => h.item.name)).toEqual(['Eco']);
    // senza rack salvati, nessuna cartella
    expect(names(await deviceSource({ id: 'fx', label: 'FX', kind: 'effect', types: [DELAY], user: user(), racks: { list: () => [] } }).items()))
      .toEqual([DELAY.label]);
  });

  it('rack di fabbrica: nella cartella dei rack del loro tipo, dopo quelli salvati; non tra i Preset dell\'utente', async () => {
    const macros = Array.from({ length: MACRO_COUNT }, () => ({ name: null, value: 0, mappings: [] }));
    const eco: RackPreset = { name: 'Eco', instrument: null, effects: [{ type: 'delay', preset: null, params: {}, enabled: true }], macros };
    const sources = standardSources({ instruments: [ANALOG], effects: [DELAY], user: user(), racks: { list: () => [eco] }, factoryRacks: FACTORY_RACKS, project: setup().store });
    const [instruments, effects] = [await sources[0].items(), await sources[1].items()];
    expect(names(instruments)).toEqual(['Instrument Rack', ANALOG.label]);
    expect(names(await childrenOf(instruments[0]))).toEqual(['Acido', 'Nebbia', 'Ringhio', 'Nuova onda', 'Ossigeno', 'Hoover', 'Jump', 'Levare', '303']);
    expect(names(await childrenOf(effects[0]))).toEqual(['Eco', 'Tornado', 'Fade to Grey', 'Dub', 'French Touch', 'Cassetta', 'Muro', 'Acido FX', 'Macchina']);
    expect((await childrenOf(effects[0]))[1].payload).toEqual({ kind: 'rack', rack: TORNADO });
    expect(names(await sources.find(s => s.id === 'user-presets')!.items())).toEqual(['Audio Effect Rack']);
    // senza rack salvati la cartella c'è lo stesso
    const fx = deviceSource({ id: 'fx', label: 'FX', kind: 'effect', types: [DELAY], user: user(), racks: { list: () => [] }, factoryRacks: FACTORY_RACKS });
    expect(names(await fx.items())).toEqual(['Audio Effect Rack', DELAY.label]);
    expect((await searchSources([fx], 'torn')).map(h => h.item.name)).toEqual(['Tornado']);
  });
});

describe('sample', () => {
  it('Progetto corrente: i sample in ordine di nome, con la durata; si rilegge solo se cambiano i sample', async () => {
    const r = setup({ audio: 1 });
    const source = projectSamplesSource(r.store);
    let changed = 0;
    source.onChange!(() => changed++);
    r.store.apply(addSample(sampleRef(r.ids, { name: 'zeta' })));
    r.store.apply(addSample(sampleRef(r.ids, { name: 'alfa', frames: 44100 * 75 })));
    expect(changed).toBe(2);
    const items = await source.items();
    expect(names(items)).toEqual(['alfa', 'zeta']);
    expect(items.map(i => i.hint)).toEqual(['1:15', '4,0 s']);
    expect(items[0].payload).toMatchObject({ kind: 'sample', sample: { name: 'alfa' } });
    r.store.apply(importSample(r.store.project.samples[0], r.track(0), 0)); // un sample già nel progetto si posa senza duplicarlo
    expect(r.store.project.samples).toHaveLength(2);
    expect(changed).toBe(2);
  });

  it('una cartella del disco: prima le sottocartelle, poi solo i file audio, in ordine naturale', async () => {
    const source = folderSource('folder1', folder('Suoni', {
      'loop 10.wav': 0, 'loop 2.wav': 0, 'note.txt': 0, '.nascosta/': {}, 'Kick/': { 'k1.aif': 0, 'leggimi.pdf': 0 },
    }));
    const items = await source.items();
    expect(names(items)).toEqual(['Kick', 'loop 2', 'loop 10']);
    expect(items[1]).toMatchObject({ icon: 'sample', hint: 'wav', payload: { kind: 'file', name: 'loop 2.wav' } });
    expect(names(await childrenOf(items[0]))).toEqual(['k1']);
  });

  it('la durata', () => {
    expect([duration(0.25), duration(9.96), duration(61.4), duration(600)]).toEqual(['0,3 s', '10,0 s', '1:01', '10:00']);
  });
});

describe('ricerca', () => {
  it('tutte le parole, in qualsiasi ordine, senza maiuscole e accenti, anche nelle cartelle', async () => {
    const roots = await deviceSource({ id: 'effects', label: 'Effetti', kind: 'effect', types: EFFECT_TYPES, user: user() }).items();
    const hits = await search(roots, REVERB.label.toUpperCase());
    expect(hits[0]).toMatchObject({ item: { name: REVERB.label }, path: [] }); // il dispositivo stesso
    const preset = REVERB.presets[0].name;
    const deep = await search(roots, preset.split(/\s+/).reverse().join(' '));
    expect(deep.some(h => h.item.name === preset && h.path[0] === REVERB.label)).toBe(true);
    const disk = await folderSource('f', folder('x', { 'Città/': { 'Più forte.wav': 0, 'Piano.wav': 0 } })).items();
    expect((await search(disk, 'FORTE piu')).map(h => [h.item.name, h.path])).toEqual([['Più forte', ['Città']]]);
    expect(await search(disk, 'citta')).toEqual([]); // la cartella da sola non si carica
    expect(await search(roots, '   ')).toEqual([]);
  });

  it('le cartelle senza niente da caricare non sono risultati; c\'è un limite', async () => {
    const items = await folderSource('f', folder('x', { 'kick/': { 'kick 1.wav': 0, 'kick 2.wav': 0, 'kick 3.wav': 0 } })).items();
    const hits = await search(items, 'kick');
    expect(hits.map(h => [h.item.name, h.path])).toEqual([['kick 1', ['kick']], ['kick 2', ['kick']], ['kick 3', ['kick']]]);
    expect(await search(items, 'kick', { limit: 2 })).toHaveLength(2);
  });
});

describe('ricerca in tutte le fonti', () => {
  it('prima la fonte scelta, con il suo nome nel percorso; ciò che si ripete compare una volta', async () => {
    const u = user({ drums: [{ name: 'Mio kit', params: {} }] });
    const sources = standardSources({ instruments: [ANALOG, DRUMS], effects: [REVERB], user: u, project: setup().store });
    const [instruments, drums, effects, , mine] = sources;
    const hits = await searchSources([drums, instruments, effects, mine], 'mio kit');
    expect(hits.map(h => h.path)).toEqual([['Batterie']]); // non anche in Strumenti › Drum Machine e nei Preset dell'utente
    const locked = { ...effects, locked: async () => true };
    expect(await searchSources([locked], REVERB.label)).toEqual([]);
    expect((await searchSources([instruments, effects], REVERB.label))[0].path).toEqual(['Effetti audio']);
  });
});

describe('cartelle aggiunte', () => {
  it('si aggiungono una volta sola, si tolgono, si ricordano', async () => {
    let saved: FolderReader[] = [];
    const places: FolderPlaces<FolderReader> = { load: async () => saved, save: async f => { saved = [...f]; } };
    const fixed = standardSources({ instruments: [ANALOG], effects: [], user: user(), project: setup().store });
    const catalog = new BrowserCatalog(fixed, places);
    let changes = 0;
    catalog.onChange(() => changes++);
    const a = folder('Campioni', {});
    const source = await catalog.addFolder(a);
    expect(await catalog.addFolder(a)).toBe(source);
    expect(catalog.sources.at(-1)).toMatchObject({ label: 'Campioni', section: 'places', removable: true });
    expect(saved).toEqual([a]);
    const again = new BrowserCatalog(fixed, places);
    await again.restore();
    expect(again.sources.map(s => s.label).at(-1)).toBe('Campioni');
    await catalog.removeFolder(source.id);
    expect(catalog.sources).toHaveLength(fixed.length);
    expect(saved).toEqual([]);
    expect(changes).toBe(2);
  });
});
