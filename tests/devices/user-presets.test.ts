import { describe, expect, it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import { ANALOG } from '../../src/devices/instruments/analog/analog';
import {
  presetParams, StoragePresets, UserPresets, type PresetBackend, type PresetStorage, type StoredPreset,
} from '../../src/devices/user-presets';

const memory = (initial: Record<string, string> = {}): PresetStorage & { data: Record<string, string> } => {
  const data = { ...initial };
  return { data, getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};

/** Come i file dell'app desktop: ricorda anche la cartella di ogni preset. */
const files = (initial: unknown[] = []) => {
  const saved: (StoredPreset & { folder: string })[] = [];
  const backend: PresetBackend = {
    load: async () => [...initial, ...saved],
    save: async (folder, p) => {
      saved.splice(0, saved.length, ...saved.filter(q => q.type !== p.type || q.name !== p.name), { ...p, folder });
    },
    remove: async (type, name) => {
      saved.splice(0, saved.length, ...saved.filter(q => q.type !== type || q.name !== name));
    },
  };
  return { backend, saved };
};

describe('preset dell\'utente', () => {
  it('salva, sostituisce con lo stesso nome, elenca in ordine ed elimina', async () => {
    const { backend, saved } = files();
    const presets = new UserPresets(backend, type => type.toUpperCase());
    await presets.save('analog', { name: 'Zeta', params: { a: 1 } });
    await presets.save('analog', { name: 'alfa', params: { a: 2 } });
    await presets.save('analog', { name: 'Zeta', params: { a: 3 } });
    await presets.save('delay', { name: 'Eco', params: {} });
    expect(presets.list('analog')).toEqual([{ name: 'alfa', params: { a: 2 } }, { name: 'Zeta', params: { a: 3 } }]);
    expect(presets.find('delay', 'Eco')).toEqual({ name: 'Eco', params: {} });
    expect(saved.find(p => p.name === 'Eco')?.folder).toBe('DELAY');
    // al riavvio si rileggono da chi li conserva
    const again = new UserPresets(backend);
    await again.load();
    expect(again.list('analog').map(p => p.name)).toEqual(['alfa', 'Zeta']);
    await presets.remove('delay', 'Eco');
    expect(presets.list('delay')).toEqual([]);
    expect(saved.map(p => p.name)).toEqual(['alfa', 'Zeta']);
  });

  it('salta ciò che non è un preset', async () => {
    const presets = new UserPresets(files([
      { type: 'analog', name: 'Ok', params: { a: 1, b: 'x', c: null, d: Infinity } },
      { type: 'analog', name: '', params: {} }, { name: 'senza tipo', params: {} }, 3, null,
    ]).backend);
    await presets.load();
    expect(presets.list('analog')).toEqual([{ name: 'Ok', params: { a: 1 } }]);
  });

  it('se il salvataggio non riesce il preset non compare', async () => {
    const failing: PresetBackend = { ...files().backend, save: () => Promise.reject(new Error('disco pieno')) };
    const presets = new UserPresets(failing);
    await expect(presets.save('analog', { name: 'X', params: {} })).rejects.toThrow('disco pieno');
    expect(presets.list('analog')).toEqual([]);
    await expect(new UserPresets(null).save('analog', { name: 'X', params: {} })).rejects.toThrow(/non è disponibile/);
  });

  it('nel browser restano nello spazio locale, in una voce sola', async () => {
    const storage = memory();
    const presets = new UserPresets(new StoragePresets(storage));
    await presets.save('analog', { name: 'Uno', params: { a: 1 } });
    await presets.save('eq', { name: 'Due', params: {} });
    await presets.remove('eq', 'Due');
    expect(JSON.parse(storage.data['studiomio.presets'])).toEqual({ analog: [{ name: 'Uno', params: { a: 1 } }] });
    const again = new UserPresets(new StoragePresets(storage));
    await again.load();
    expect(again.list('analog')).toEqual([{ name: 'Uno', params: { a: 1 } }]);
    expect(presets.canReveal).toBe(false);
    // voce rovinata a mano: nessun preset, nessun errore
    await expect(new StoragePresets(memory({ 'studiomio.presets': '{rotto' })).load()).resolves.toEqual([]);
    const full: PresetStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    await expect(new StoragePresets(full).save('', { type: 'analog', name: 'X', params: {} })).rejects.toThrow(/pieno o bloccato/);
  });

  it('si salvano solo i valori diversi dai predefiniti, e ricaricati suonano uguali', () => {
    const [first, second] = ANALOG.sections.flatMap(s => s.params).flatMap(p => (p.kind === 'number' && p.max > p.min ? [p] : []));
    const changed = first.default === first.max ? first.min : first.max;
    const params = presetParams(ANALOG, { [first.id]: changed, [second.id]: second.default, ignoto: 5 });
    expect(params).toEqual({ [first.id]: changed });
    expect(resolveParams(ANALOG, params)).toEqual(resolveParams(ANALOG, { [first.id]: changed }));
  });
});
