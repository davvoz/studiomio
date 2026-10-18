import { it } from 'vitest';
import { resolveParams } from '../../src/devices/device-type';
import { PRISMA, SRC, WARP } from '../../src/devices/instruments/prisma/prisma';
import { PrismaCore } from '../../src/devices/instruments/prisma/prisma-core';
import { mods } from '../../src/devices/instruments/prisma/prisma-presets';
import { NoteQueue } from '../../src/devices/worklet/note-queue';

const SR = 48000, BLOCK = 128, SECONDS = 2;

/** Quante volte più veloce del tempo reale suona un accordo di 8 note. */
function speed(params: Record<string, number>): number {
  const core = new PrismaCore(SR);
  core.setParams(resolveParams(PRISMA, params));
  const queue = new NoteQueue();
  for (const n of [48, 52, 55, 59, 62, 64, 67, 71]) queue.add(n, 100, 0, SR * 60);
  const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
  // un giro di riscaldamento, poi si misura
  for (let b = 0; b < 100; b++) queue.renderBlock(core, l, r, b * BLOCK);
  const blocks = Math.round((SECONDS * SR) / BLOCK), t0 = performance.now();
  for (let b = 100; b < 100 + blocks; b++) queue.renderBlock(core, l, r, b * BLOCK);
  return (SECONDS * 1000) / (performance.now() - t0);
}

it('Prisma: costo di un accordo di 8 note', () => {
  const cases: [string, Record<string, number>][] = [
    ['Init (una copia)', {}],
    ['unison 7 + filtro 24 dB', { aUnison: 7, f1Type: 1 }],
    ['pesante: due oscillatori a 8 copie con warp, due filtri, sub, rumore, 6 modulazioni', {
      aUnison: 8, aWarp: WARP.sync, aWarpAmt: 30, bOn: 1, bUnison: 8, bWarp: WARP.bendUp, bWarpAmt: 40, f1Type: 1, f2On: 1, f2Type: 2, subOn: 1, nOn: 1,
      ...mods([SRC.lfo1, 'aPos', 30], [SRC.lfo2, 'f1Cutoff', 20, { bi: true }], [SRC.env2, 'f2Cutoff', 40], [SRC.velocity, 'volume', 20],
        [SRC.lfo3, 'bPos', 50], [SRC.env3, 'aWarpAmt', 30]),
    }],
  ];
  for (const [name, params] of cases) console.log(`${name}: ${speed(params).toFixed(1)}× il tempo reale`);
});
