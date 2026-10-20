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

describe('rack dell\'utente', () => {
  it('salva, sostituisce con lo stesso nome, elenca in ordine ed elimina; al riavvio si rileggono', async () => {
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

  it('salta ciò che non è un rack; lo spazio locale rovinato o pieno non rompe niente', async () => {
    const racks = new UserRacks(new StorageRacks(memory({ 'studiomio.racks': JSON.stringify([rack('Ok'), { name: 'senza effetti' }, 3, null]) })));
    await racks.load();
    expect(racks.list().map(r => r.name)).toEqual(['Ok']);
    await expect(new StorageRacks(memory({ 'studiomio.racks': '{rotto' })).load()).resolves.toEqual([]);
    const full: PresetStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    await expect(new StorageRacks(full).save(rack('X'))).rejects.toThrow(/pieno o bloccato/);
  });

  it('se il salvataggio non riesce il rack non compare', async () => {
    const failing: RackBackend = { load: async () => [], save: () => Promise.reject(new Error('disco pieno')), remove: async () => {} };
    const racks = new UserRacks(failing);
    await expect(racks.save(rack('X'))).rejects.toThrow('disco pieno');
    expect(racks.list()).toEqual([]);
    await expect(new UserRacks(null).save(rack('X'))).rejects.toThrow(/non è disponibile/);
  });
});
