import { describe, expect, it } from 'vitest';
import type { PresetStorage } from '../../src/devices/user-presets';
import { StorageRacks, UserRacks, type RackBackend } from '../../src/devices/user-racks';
import { MACRO_COUNT } from '../../src/model/rack';
import type { RackPreset } from '../../src/model/rack-preset';

const memory = (initial: Record<string, string> = {}): PresetStorage & { data: Record<string, string> } => {
  const data = { ...initial };
  return { data, getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};

const empty = { name: null, value: 0, mappings: [] };
const rack = (name: string, mix = 30): RackPreset => ({
  name, instrument: null,
  effects: [{ type: 'delay', preset: null, params: { mix }, enabled: true }],
  macros: Array.from({ length: MACRO_COUNT }, () => empty),
});

describe('user racks', () => {
  it('saves, replaces with the same name, lists in order and deletes; at restart they\'re reread', async () => {
    const storage = memory();
    const racks = new UserRacks(new StorageRacks(storage));
    let changes = 0;
    racks.onChange(() => changes++);
    await racks.save(rack('Zeta'));
    await racks.save(rack('alfa'));
    await racks.save(rack('Zeta', 70));
    expect(racks.list().map(r => r.name)).toEqual(['alfa', 'Zeta']);
    expect(racks.find('Zeta')!.effects[0].params.mix).toBe(70);
    const again = new UserRacks(new StorageRacks(storage));
    await again.load();
    expect(again.list()).toEqual(racks.list());
    await racks.remove('alfa');
    expect(racks.list().map(r => r.name)).toEqual(['Zeta']);
    expect(JSON.parse(storage.data['studiomio.racks']).map((r: RackPreset) => r.name)).toEqual(['Zeta']);
    expect(changes).toBe(4);
    expect(racks.canReveal).toBe(false);
  });

  it('skips what isn\'t a rack; damaged or full local storage breaks nothing', async () => {
    const racks = new UserRacks(new StorageRacks(memory({ 'studiomio.racks': JSON.stringify([rack('Ok'), { name: 'without effects' }, 3, null]) })));
    await racks.load();
    expect(racks.list().map(r => r.name)).toEqual(['Ok']);
    await expect(new StorageRacks(memory({ 'studiomio.racks': '{rotto' })).load()).resolves.toEqual([]);
    const full: PresetStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    await expect(new StorageRacks(full).save(rack('X'))).rejects.toThrow(/full or blocked/);
  });

  it('if saving fails the rack doesn\'t appear', async () => {
    const failing: RackBackend = { load: async () => [], save: () => Promise.reject(new Error('disk full')), remove: async () => {} };
    const racks = new UserRacks(failing);
    await expect(racks.save(rack('X'))).rejects.toThrow('disk full');
    expect(racks.list()).toEqual([]);
    await expect(new UserRacks(null).save(rack('X'))).rejects.toThrow(/isn't available/);
  });
});
