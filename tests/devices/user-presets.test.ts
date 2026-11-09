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

/** Like the desktop app's files: it also remembers each preset's folder. */
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

describe('user presets', () => {
  it('saves, replaces with the same name, lists in order and deletes', async () => {
    const { backend, saved } = files();
    const presets = new UserPresets(backend, type => type.toUpperCase());
    await presets.save('analog', { name: 'Zeta', params: { a: 1 } });
    await presets.save('analog', { name: 'alfa', params: { a: 2 } });
    await presets.save('analog', { name: 'Zeta', params: { a: 3 } });
    await presets.save('delay', { name: 'Echo', params: {} });
    expect(presets.list('analog')).toEqual([{ name: 'alfa', params: { a: 2 } }, { name: 'Zeta', params: { a: 3 } }]);
    expect(presets.find('delay', 'Echo')).toEqual({ name: 'Echo', params: {} });
    expect(saved.find(p => p.name === 'Echo')?.folder).toBe('DELAY');
    // at restart they're reread from whoever keeps them
    const again = new UserPresets(backend);
    await again.load();
    expect(again.list('analog').map(p => p.name)).toEqual(['alfa', 'Zeta']);
    await presets.remove('delay', 'Echo');
    expect(presets.list('delay')).toEqual([]);
    expect(saved.map(p => p.name)).toEqual(['alfa', 'Zeta']);
  });

  it('skips what isn\'t a preset', async () => {
    const presets = new UserPresets(files([
      { type: 'analog', name: 'Ok', params: { a: 1, b: 'x', c: null, d: Infinity } },
      { type: 'analog', name: '', params: {} }, { name: 'without type', params: {} }, 3, null,
    ]).backend);
    await presets.load();
    expect(presets.list('analog')).toEqual([{ name: 'Ok', params: { a: 1 } }]);
  });

  it('if saving fails the preset doesn\'t appear', async () => {
    const failing: PresetBackend = { ...files().backend, save: () => Promise.reject(new Error('disk full')) };
    const presets = new UserPresets(failing);
    await expect(presets.save('analog', { name: 'X', params: {} })).rejects.toThrow('disk full');
    expect(presets.list('analog')).toEqual([]);
    await expect(new UserPresets(null).save('analog', { name: 'X', params: {} })).rejects.toThrow(/isn't available/);
  });

  it('in the browser they stay in local storage, in a single entry', async () => {
    const storage = memory();
    const presets = new UserPresets(new StoragePresets(storage));
    await presets.save('analog', { name: 'One', params: { a: 1 } });
    await presets.save('eq', { name: 'Two', params: {} });
    await presets.remove('eq', 'Two');
    expect(JSON.parse(storage.data['studiomio.presets'])).toEqual({ analog: [{ name: 'One', params: { a: 1 } }] });
    const again = new UserPresets(new StoragePresets(storage));
    await again.load();
    expect(again.list('analog')).toEqual([{ name: 'One', params: { a: 1 } }]);
    expect(presets.canReveal).toBe(false);
    // entry damaged by hand: no presets, no error
    await expect(new StoragePresets(memory({ 'studiomio.presets': '{rotto' })).load()).resolves.toEqual([]);
    const full: PresetStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    await expect(new StoragePresets(full).save('', { type: 'analog', name: 'X', params: {} })).rejects.toThrow(/full or blocked/);
  });

  it('only the values different from the defaults are saved, and reloaded they play the same', () => {
    const [first, second] = ANALOG.sections.flatMap(s => s.params).flatMap(p => (p.kind === 'number' && p.max > p.min ? [p] : []));
    const changed = first.default === first.max ? first.min : first.max;
    const params = presetParams(ANALOG, { [first.id]: changed, [second.id]: second.default, ignoto: 5 });
    expect(params).toEqual({ [first.id]: changed });
    expect(resolveParams(ANALOG, params)).toEqual(resolveParams(ANALOG, { [first.id]: changed }));
  });
});
