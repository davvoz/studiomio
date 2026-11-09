/* The Snare's panel (a layered panel, see layer-display.ts): the hit with the skin's small
 * pitch drop, then the layer tabs in the order they're heard
 * (Hit, Skin, Wires, Room), the note and the output. Hit and Skin can be a sample. */
import {
  BODY_SLOT, noteHz, ROOT_NOTE, SNAP_SLOT, SNAP_SOURCE, snareNote, SOURCE,
} from '../../../devices/instruments/snare/snare';
import { SnareCore } from '../../../devices/instruments/snare/snare-core';
import type { DisplayContext } from '../displays';
import { LayerDisplay, type LayerLayout } from '../layers/layer-display';

/** How much of the hit is drawn, at most and at least (in seconds). */
const MAX_VIEW = 2;
const MIN_VIEW = 0.2;

export const SNARE_LAYOUT: LayerLayout = {
  name: 'Snare',
  cards: [
    { title: 'Hit', source: 'snapSource', slot: SNAP_SLOT, params: ['snapLevel', 'snapTone', 'snapTune', 'snapDecay'] },
    {
      title: 'Skin', source: 'bodySource', slot: BODY_SLOT,
      params: ['bodyLevel', 'pitch', 'pitchTime', 'overtone', 'shape', 'sampleTune', 'sampleStart', 'decay'],
    },
    { title: 'Snares', params: ['wiresLevel', 'wiresTone', 'wiresDecay', 'wiresDelay', 'grain'] },
    { title: 'Room', source: 'roomOn', params: ['room', 'roomTime', 'roomTone'] },
    { title: 'Note', params: ['note', 'fine', 'follow'] },
    { title: 'Output', params: ['drive', 'driveType', 'lowCut', 'velocity', 'velTone', 'volume'] },
  ],
  // choosing a sample, the times lengthen as much as needed to hear it
  samples: [
    { slot: BODY_SLOT, source: 'bodySource', sample: SOURCE.sample, times: x => ({ ...(x.decay < 0.5 ? { decay: 0.8 } : {}) }) },
    { slot: SNAP_SLOT, source: 'snapSource', sample: SNAP_SOURCE.sample, times: x => ({ ...(x.snapDecay < 120 ? { snapDecay: 250 } : {}) }) },
  ],
  swapped: new Set(['pitch', 'pitchTime', 'overtone', 'shape', 'sampleTune', 'sampleStart', 'snapTone', 'snapTune']),
  menus: new Set(['note', 'driveType', 'snapSource', 'bodySource']),
  audition: new Set(['bodySource', 'snapSource', 'note', 'roomOn']),
  rootNote: ROOT_NOTE,
  lowHz: 60,
  highHz: 2400,
  core: rate => new SnareCore(rate),
  /** How far the longest of the layers is heard. */
  seconds: v => {
    const room = v.roomOn === 1 && v.room > 0 ? v.roomTime * 0.6 : 0;
    return Math.max(MIN_VIEW, Math.min(MAX_VIEW, Math.max(v.decay * 0.7, v.wiresDecay * 0.7 + v.wiresDelay / 1000, room)));
  },
  pitch: v => {
    if (v.bodySource !== SOURCE.synth) return null;
    const base = noteHz(snareNote(v.note) + v.fine / 100), k = Math.log(1e-3) / (v.pitchTime / 1000);
    return { base, at: t => base * Math.pow(2, (v.pitch * Math.exp(k * t)) / 12) };
  },
  hint: v => (v.follow === 1 ? 'follows the notes (D1 = the note)' : 'click: play'),
};

export const snareDisplay = (ctx: DisplayContext) => new LayerDisplay(ctx, SNARE_LAYOUT);
