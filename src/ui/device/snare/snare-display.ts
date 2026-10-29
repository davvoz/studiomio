/* Il pannello dello Snare (un pannello a strati, vedi layer-display.ts): il colpo con la piccola
 * caduta d'intonazione della pelle, poi le schede degli strati nell'ordine in cui si sentono
 * (Colpo, Pelle, Cordiera, Stanza), la nota e l'uscita. Colpo e Pelle possono essere un sample. */
import {
  BODY_SLOT, noteHz, ROOT_NOTE, SNAP_SLOT, SNAP_SOURCE, snareNote, SOURCE,
} from '../../../devices/instruments/snare/snare';
import { SnareCore } from '../../../devices/instruments/snare/snare-core';
import type { DisplayContext } from '../displays';
import { LayerDisplay, type LayerLayout } from '../layers/layer-display';

/** Quanto si disegna del colpo, al massimo e al minimo (in secondi). */
const MAX_VIEW = 2;
const MIN_VIEW = 0.2;

export const SNARE_LAYOUT: LayerLayout = {
  name: 'Snare',
  cards: [
    { title: 'Colpo', source: 'snapSource', slot: SNAP_SLOT, params: ['snapLevel', 'snapTone', 'snapTune', 'snapDecay'] },
    {
      title: 'Pelle', source: 'bodySource', slot: BODY_SLOT,
      params: ['bodyLevel', 'pitch', 'pitchTime', 'overtone', 'shape', 'sampleTune', 'sampleStart', 'decay'],
    },
    { title: 'Cordiera', params: ['wiresLevel', 'wiresTone', 'wiresDecay', 'wiresDelay', 'grain'] },
    { title: 'Stanza', source: 'roomOn', params: ['room', 'roomTime', 'roomTone'] },
    { title: 'Nota', params: ['note', 'fine', 'follow'] },
    { title: 'Uscita', params: ['drive', 'driveType', 'lowCut', 'velocity', 'velTone', 'volume'] },
  ],
  // scegliendo un sample, i tempi si allungano quanto basta a sentirlo
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
  /** Fin dove si sente il più lungo degli strati. */
  seconds: v => {
    const room = v.roomOn === 1 && v.room > 0 ? v.roomTime * 0.6 : 0;
    return Math.max(MIN_VIEW, Math.min(MAX_VIEW, Math.max(v.decay * 0.7, v.wiresDecay * 0.7 + v.wiresDelay / 1000, room)));
  },
  pitch: v => {
    if (v.bodySource !== SOURCE.synth) return null;
    const base = noteHz(snareNote(v.note) + v.fine / 100), k = Math.log(1e-3) / (v.pitchTime / 1000);
    return { base, at: t => base * Math.pow(2, (v.pitch * Math.exp(k * t)) / 12) };
  },
  hint: v => (v.follow === 1 ? 'segue le note (D1 = la nota)' : 'clic: suona'),
};

export const snareDisplay = (ctx: DisplayContext) => new LayerDisplay(ctx, SNARE_LAYOUT);
